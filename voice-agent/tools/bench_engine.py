"""Hop 4 on its own: what `POST /turns` actually costs, and where the cost is.

The claim in the design is that the engine answers in about fifteen
milliseconds because question selection, presence derivation and the safety
rules are all pure and synchronous. That claim is checkable, and it has two
parts that are worth separating:

  * `serverTimeMs` — what the **handler** says it cost. The engine's own view.
  * the HTTP round trip from this process — the same work plus Nest's guards,
    the validation pipe, the JSON envelope, the logging interceptor and a
    loopback socket.

A budget that reports only the first will under-count the turn; a budget that
reports only the second cannot tell you whether to optimise the engine or the
framework around it. So both are reported, and so is the difference.

    python tools/bench_engine.py --runs 10

It authenticates as the demo patient and posts real turns to a real session, so
it writes real rows to the case-taking tables. That is deliberate — a benchmark
against a stub measures the stub — but it is also why this is a development
tool and says so.

## A thing this script found

Nest wraps every successful response in `{success, message, data, timestamp}`
via the global `ResponseInterceptor`, with no per-controller opt-out. Anything
reading `nextQuestion` off the top level of the body gets `None`. The worker's
engine.py did exactly that, and now unwraps; see the comment in
`TurnResult.from_payload`.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import Settings, load_env_file  # noqa: E402
from httpclient import async_client  # noqa: E402

# Short clinical answers, which is what an interview is mostly made of. Cycled
# rather than randomised so a re-run posts the same sequence.
ANSWERS = [
    "yes",
    "no",
    "three days",
    "on the left side",
    "about seven out of ten",
    "since yesterday morning",
    "not sure",
]


def _stats(values: list[float]) -> dict:
    if not values:
        return {"n": 0}
    ordered = sorted(values)
    return {
        "n": len(ordered),
        "min": round(ordered[0], 2),
        "median": round(statistics.median(ordered), 2),
        "p90": round(ordered[min(len(ordered) - 1, int(len(ordered) * 0.9))], 2),
        "max": round(ordered[-1], 2),
    }


def _unwrap(payload: dict) -> dict:
    if isinstance(payload.get("data"), dict) and "success" in payload:
        return payload["data"]
    return payload


async def run(args: argparse.Namespace) -> int:
    settings = Settings.load()
    base = settings.api_url
    client = async_client(30.0)

    # ── Authenticate ─────────────────────────────────────────────────────────
    login: list[float] = []
    token = ""
    for _ in range(3):
        t = time.perf_counter()
        response = await client.post(
            f"{base}/auth/login", json={"email": args.email, "password": args.password}
        )
        login.append((time.perf_counter() - t) * 1000.0)
        response.raise_for_status()
        token = _unwrap(response.json())["accessToken"]
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    print(f"POST /auth/login       : {json.dumps(_stats(login))}")

    # ── Session ──────────────────────────────────────────────────────────────
    t = time.perf_counter()
    response = await client.post(
        f"{base}/case-taking/sessions",
        json={"kind": "new_consultation", "language": args.language},
        headers=headers,
    )
    start_ms = (time.perf_counter() - t) * 1000.0
    response.raise_for_status()
    session = _unwrap(response.json())
    session_id = session["id"]
    print(f"POST /sessions         : {start_ms:.1f} ms  -> {session_id}")

    consent = session.get("consent") or {}
    if not consent.get("given"):
        await client.post(
            f"{base}/case-taking/sessions/{session_id}/consent",
            json={
                "consentVersion": consent.get("requiredVersion") or "2026.09.1",
                "accepted": True,
            },
            headers=headers,
        )
        print("  consent recorded")

    # ── GET /sessions/:id, the join path's engine call ───────────────────────
    get_ms: list[float] = []
    for _ in range(args.runs):
        t = time.perf_counter()
        response = await client.get(
            f"{base}/case-taking/sessions/{session_id}", headers=headers
        )
        get_ms.append((time.perf_counter() - t) * 1000.0)
        response.raise_for_status()
    print(f"GET  /sessions/:id     : {json.dumps(_stats(get_ms))}")

    # ── POST /turns, the hot path ────────────────────────────────────────────
    http_ms: list[float] = []
    server_ms: list[float] = []
    rows: list[dict] = []
    for i in range(args.runs):
        text = ANSWERS[i % len(ANSWERS)]
        body = {
            "modality": "voice",
            "text": text,
            # A real Whisper number, not 1.0: the engine is entitled to weigh it.
            "transcriptConfidence": 0.82,
        }
        t = time.perf_counter()
        response = await client.post(
            f"{base}/case-taking/sessions/{session_id}/turns", json=body, headers=headers
        )
        elapsed = (time.perf_counter() - t) * 1000.0
        if response.status_code >= 400:
            print(f"  turn {i}: HTTP {response.status_code} {response.text[:200]}")
            continue
        payload = _unwrap(response.json())
        http_ms.append(elapsed)
        server_ms.append(float(payload.get("serverTimeMs") or 0.0))
        question = payload.get("nextQuestion") or {}
        rows.append(
            {
                "text": text,
                "httpMs": round(elapsed, 2),
                "serverTimeMs": payload.get("serverTimeMs"),
                "status": payload.get("interviewStatus"),
                "promptChars": len(question.get("prompt") or ""),
                "messageChars": len(payload.get("patientMessage") or ""),
            }
        )
        if payload.get("nextQuestion") is None:
            print(f"  interview reached {payload.get('interviewStatus')}; stopping at turn {i}")
            break

    print(f"POST /turns (HTTP)     : {json.dumps(_stats(http_ms))}")
    print(f"POST /turns (serverTimeMs): {json.dumps(_stats(server_ms))}")
    if http_ms and server_ms:
        overhead = [h - s for h, s in zip(http_ms, server_ms)]
        print(f"  Nest overhead around the engine: {json.dumps(_stats(overhead))}")

    prompts = [r["promptChars"] for r in rows if r["promptChars"]]
    if prompts:
        print(
            f"  next-question prompt length: median {statistics.median(prompts):.0f} chars, "
            f"max {max(prompts)} — this is the input to hop 5"
        )

    await client.aclose()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "sessionId": session_id,
                "loginMs": _stats(login),
                "getSessionMs": _stats(get_ms),
                "turnHttpMs": _stats(http_ms),
                "turnServerMs": _stats(server_ms),
                "rows": rows,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nwrote {out}")
    return 0


def main() -> None:
    load_env_file()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=int, default=10)
    parser.add_argument("--email", default="patient@hms.local")
    parser.add_argument("--password", default="Demo@HMS2024!")
    parser.add_argument("--language", default="en")
    parser.add_argument(
        "--out",
        default=str(Path(tempfile.gettempdir()) / "medihive-timing" / "bench_engine.json"),
    )
    raise SystemExit(asyncio.run(run(parser.parse_args())))


if __name__ == "__main__":
    main()
