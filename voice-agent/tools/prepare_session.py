"""A real session and a real patient token, for a measured run. **Development only.**

The worker needs three things before a turn can be posted: a session id, a
bearer token scoped to the patient who owns it, and a room named after the
session. In production Nest mints the token and attaches all of it to the job
dispatch. Here there is no dispatch, so this logs in as the demo patient, opens
(or resumes) their interview, records consent if it has not been given, and
prints what `run.ps1` needs:

    python tools/prepare_session.py --shell bash > /tmp/session.env
    source /tmp/session.env

`--shell powershell` prints `$env:` assignments instead.

It prints the token. That is the point of it and also why it is development
only: the thing holding a patient's bearer token should be Nest, not a shell.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import Settings, load_env_file  # noqa: E402
from httpclient import async_client  # noqa: E402


def _unwrap(payload: dict) -> dict:
    """Nest's global envelope, off. See engine.TurnResult.from_payload."""
    if isinstance(payload.get("data"), dict) and "success" in payload:
        return payload["data"]
    return payload


async def run(args: argparse.Namespace) -> int:
    settings = Settings.load()
    client = async_client(30.0)

    response = await client.post(
        f"{settings.api_url}/auth/login",
        json={"email": args.email, "password": args.password},
    )
    response.raise_for_status()
    token = _unwrap(response.json())["accessToken"]
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    response = await client.post(
        f"{settings.api_url}/case-taking/sessions",
        json={"kind": "new_consultation", "language": args.language},
        headers=headers,
    )
    response.raise_for_status()
    session = _unwrap(response.json())
    session_id = session["id"]

    consent = session.get("consent") or {}
    if not consent.get("given"):
        await client.post(
            f"{settings.api_url}/case-taking/sessions/{session_id}/consent",
            json={
                "consentVersion": consent.get("requiredVersion") or "2026.09.1",
                "accepted": True,
            },
            headers=headers,
        )

    question = (session.get("currentQuestion") or {}).get("prompt") or "(none)"
    room = f"{settings.room_prefix}{session_id}"

    if args.shell == "powershell":
        print(f'$env:MEDIHIVE_SESSION_ID = "{session_id}"')
        print(f'$env:MEDIHIVE_API_TOKEN = "{token}"')
        print(f'$env:PROBE_ROOM = "{room}"')
    else:
        print(f"export MEDIHIVE_SESSION_ID='{session_id}'")
        print(f"export MEDIHIVE_API_TOKEN='{token}'")
        print(f"export PROBE_ROOM='{room}'")
    print(f"# progress: {(session.get('progress') or {}).get('percent')}%  asking: {question[:80]}")

    await client.aclose()
    return 0


def main() -> None:
    load_env_file()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", default="patient@hms.local")
    parser.add_argument("--password", default="Demo@HMS2024!")
    parser.add_argument("--language", default="en")
    parser.add_argument("--shell", choices=["bash", "powershell"], default="bash")
    raise SystemExit(asyncio.run(run(parser.parse_args())))


if __name__ == "__main__":
    main()
