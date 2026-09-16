"""Hops 3 and 5 on their own: what `/stt` and `/tts` cost, by utterance length.

The end-to-end probe (tools/latency_probe.py) measures the whole turn, but a
number from the whole turn cannot tell you *why* it is what it is. This isolates
the two model calls and varies the one input that matters — how long the patient
spoke — because a budget derived from one 10-second utterance is a budget that
does not describe the system. Short clinical answers dominate a real interview:
"three days", "yes", "on the left side".

    python tools/bench_sidecar.py --runs 5

## What it measures, and what it subtracts

Everything here crosses `http://127.0.0.1:8801`. Loopback plus FastAPI plus
multipart parsing is not zero, so the run starts by timing a request that
reaches no handler at all — a 404 — on the same client, and reports that as
`http_floor`. The decode figures are reported raw *and* with the floor taken
off, so "Whisper cost 1.9 s" cannot quietly include 4 ms of framework.

`GET /health` is measured too, and separately, because it is **not** a floor:
it probes Ollama, which is not running on this box, and the connection attempt
costs it seconds. Using it as the control is how this bench first reported a
"2.3 second HTTP floor" that did not exist.

The `silence` fixture is a fifth of a second of nothing. Whisper pads every
input to 30 seconds before the encoder runs, so its encoder cost does not vary
with how long the patient spoke; this fixture is what makes that visible rather
than asserted, and it is the single most important row in the output.

## Where the fixtures come from

Piper, via the sidecar's own `/tts`, resampled to 16 kHz mono — byte for byte
the shape the worker POSTs. That is deliberate: this bench and the end-to-end
probe must feed Whisper the same thing, or the two sets of numbers cannot be
subtracted from each other. It also means the audio is cleaner than any phone
will deliver, so these decode times are a **floor**, not a typical case.

Synthesised fixtures are cached under the system temp dir, so a second run does
not re-synthesise and the /tts figures come from a cold call each time.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import io
import json
import statistics
import sys
import tempfile
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402

from config import Settings, load_env_file  # noqa: E402
from httpclient import async_client  # noqa: E402

# What Whisper and Silero want, and therefore what the worker sends.
INFERENCE_RATE = 16000

# The interview's real traffic. The first five are the answers that actually
# dominate a clinical interview — a duration, a yes, a side, a severity — and
# the last two are the long-tail story a patient tells when asked what brought
# them in. A budget built only on the last two is a budget that flatters itself.
UTTERANCES: list[tuple[str, str]] = [
    # Not speech: 200 ms of digital silence, to price Whisper's fixed cost.
    ("silence", ""),
    ("yes", "yes"),
    ("short_duration", "three days"),
    ("short_side", "on the left side"),
    ("short_severity", "about seven out of ten"),
    ("short_onset", "since yesterday morning"),
    (
        "sentence",
        "I have had a throbbing headache on the left side of my head for about "
        "three days now.",
    ),
    (
        "long",
        "It started on Saturday morning when I woke up, a throbbing pain on the "
        "left side of my head that gets worse when I bend forward or cough, and "
        "since yesterday I have also felt sick and the light in the kitchen has "
        "been bothering my eyes quite a lot.",
    ),
]

CACHE = Path(tempfile.gettempdir()) / "medihive-timing" / "fixtures"


def _resample_to_16k_mono(wav_bytes: bytes) -> tuple[bytes, float]:
    """A Piper WAV as the 16 kHz mono PCM the worker would POST. Returns (wav, seconds)."""
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        rate, channels, width = wf.getframerate(), wf.getnchannels(), wf.getsampwidth()
        raw = wf.readframes(wf.getnframes())
    if width != 2:
        raise ValueError(f"expected 16-bit PCM from the sidecar, got {width * 8}-bit")
    samples = np.frombuffer(raw, dtype=np.int16)
    if channels > 1:
        samples = samples.reshape(-1, channels).astype(np.int32).mean(axis=1).astype(np.int16)
    if rate != INFERENCE_RATE:
        # Linear interpolation. Same resampler as tools/speak_into_room.py uses,
        # and honest about being a test fixture's resampler rather than the
        # product's: livekit-agents does the real one on the live path.
        n = int(samples.size / rate * INFERENCE_RATE)
        samples = np.interp(
            np.linspace(0, samples.size - 1, n),
            np.arange(samples.size, dtype=np.float64),
            samples.astype(np.float64),
        ).astype(np.int16)

    out = io.BytesIO()
    with wave.open(out, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(INFERENCE_RATE)
        wf.writeframes(samples.tobytes())
    return out.getvalue(), samples.size / INFERENCE_RATE


def _silence_wav(seconds: float) -> bytes:
    """Digital silence at the inference rate. Not speech; a cost probe."""
    out = io.BytesIO()
    with wave.open(out, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(INFERENCE_RATE)
        wf.writeframes(np.zeros(int(INFERENCE_RATE * seconds), dtype=np.int16).tobytes())
    return out.getvalue()


async def _synthesise(client, base: str, text: str) -> tuple[bytes, float]:
    """One /tts call. Returns (wav bytes, milliseconds)."""
    started = time.perf_counter()
    response = await client.post(f"{base}/tts", json={"text": text, "language": "en"}, timeout=120)
    elapsed = (time.perf_counter() - started) * 1000.0
    response.raise_for_status()
    return response.content, elapsed


async def _stt(client, base: str, wav: bytes) -> tuple[dict, float]:
    started = time.perf_counter()
    response = await client.post(
        f"{base}/stt",
        files={"file": ("utterance.wav", wav, "audio/wav")},
        data={"language": "en"},
        timeout=120,
    )
    elapsed = (time.perf_counter() - started) * 1000.0
    response.raise_for_status()
    return response.json(), elapsed


def _stats(values: list[float]) -> dict:
    if not values:
        return {"n": 0}
    ordered = sorted(values)
    return {
        "n": len(ordered),
        "min": round(ordered[0], 1),
        "median": round(statistics.median(ordered), 1),
        "max": round(ordered[-1], 1),
        "mean": round(statistics.fmean(ordered), 1),
    }


async def cancel_test(client, base: str, wav: bytes, runs: int) -> dict:
    """What a cancelled `/stt` costs the request behind it.

    stt_adapter.py cancels an in-flight interim the moment the VAD endpoints,
    and its own comment says why that is not free: "cancelling the HTTP request
    does not stop the sidecar decoding". This measures the size of "not free",
    because the end-to-end run showed turns whose interim was cancelled taking
    **ten times** as long to get their final transcript as turns whose interim
    had already landed — and correlation on four turns is not a mechanism.

    Two conditions, alternated so that drift and any other load on the box hit
    both equally:

      cold  a single POST /stt, nothing else in flight. The control.
      after a POST /stt started and cancelled ~200 ms in, then immediately a
            second POST /stt timed from the moment it is issued.

    If the sidecar's `/stt` were `async` over a thread, `after` would match
    `cold`. It is not: `main.py` calls `stt.transcribe(...)` synchronously
    inside an `async def`, so the decode blocks uvicorn's event loop and the
    next request is not merely queued behind it — it cannot be read off the
    socket until the abandoned decode returns.
    """
    cold: list[float] = []
    after: list[float] = []
    for _ in range(runs):
        _, ms = await _stt(client, base, wav)
        cold.append(ms)

        doomed = asyncio.create_task(_stt(client, base, wav))
        await asyncio.sleep(0.2)
        doomed.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await doomed
        _, ms = await _stt(client, base, wav)
        after.append(ms)
    return {"coldMs": _stats(cold), "afterCancelledMs": _stats(after)}


async def run(args: argparse.Namespace) -> int:
    settings = Settings.load()
    base = settings.sidecar_url
    CACHE.mkdir(parents=True, exist_ok=True)
    client = async_client(120.0)

    print(f"sidecar: {base}")
    print(f"runs per utterance: {args.runs}\n")

    # ── The floor: a request that reaches no handler at all ──────────────────
    floor: list[float] = []
    for _ in range(args.runs * 3):
        t = time.perf_counter()
        await client.get(f"{base}/__latency_floor__", timeout=30)
        floor.append((time.perf_counter() - t) * 1000.0)
    floor_stats = _stats(floor)
    print(f"http_floor (404, same client): {json.dumps(floor_stats)}")
    floor_median = floor_stats["median"]

    # /health for comparison only, and it is NOT the floor: it opens a socket
    # to Ollama, which is not running on this box, so what it measures is a
    # dead TCP connect. Reported because the worker's startup calls it and
    # because using it as the control is how this bench first invented a
    # "2.3 second HTTP floor" that does not exist.
    health: list[float] = []
    for _ in range(3):
        t = time.perf_counter()
        (await client.get(f"{base}/health", timeout=60)).raise_for_status()
        health.append((time.perf_counter() - t) * 1000.0)
    health_stats = _stats(health)
    print(f"GET /health (probes Ollama; NOT a floor): {json.dumps(health_stats)}\n")

    results: list[dict] = []
    for name, text in UTTERANCES:
        if args.only and name not in args.only:
            continue

        # ── /tts, hop 5 ──────────────────────────────────────────────────────
        tts_ms: list[float] = []
        if text:
            for _ in range(args.runs):
                wav_raw, ms = await _synthesise(client, base, text)
                tts_ms.append(ms)
            wav16, seconds = _resample_to_16k_mono(wav_raw)
        else:
            wav16, seconds = _silence_wav(0.2), 0.2

        fixture = CACHE / f"{name}.wav"
        fixture.write_bytes(wav16)

        # ── /stt, hop 3 ──────────────────────────────────────────────────────
        stt_ms: list[float] = []
        transcripts: list[str] = []
        for _ in range(args.runs):
            payload, ms = await _stt(client, base, wav16)
            stt_ms.append(ms)
            transcripts.append((payload.get("text") or "").strip())

        row = {
            "name": name,
            "chars": len(text),
            "audio_s": round(seconds, 2),
            "wav_kb": round(len(wav16) / 1024, 1),
            "tts_ms": _stats(tts_ms),
            "http_floor_ms": floor_median,
            "stt_ms": _stats(stt_ms),
            "stt_ms_net_of_http": round(_stats(stt_ms)["median"] - floor_median, 1),
            # Realtime factor: seconds of CPU per second of audio. The number
            # that says whether a faster model or a shorter utterance helps more.
            "stt_xrt": round(_stats(stt_ms)["median"] / 1000.0 / max(seconds, 1e-6), 2),
            "transcript": transcripts[-1],
            "text": text,
        }
        results.append(row)
        print(
            f"{name:<16} audio={row['audio_s']:>5.2f}s  "
            f"stt median={row['stt_ms']['median']:>7.1f}ms  max={row['stt_ms']['max']:>7.1f}ms  "
            f"xRT={row['stt_xrt']:>5.2f}   "
            f"tts median={row['tts_ms'].get('median', 0):>7.1f}ms  "
            f"max={row['tts_ms'].get('max', 0):>7.1f}ms"
        )
        print(f"{'':<16} heard: {row['transcript']!r}")

    # ── What a cancelled interim costs the final behind it ───────────────────
    cancellation = {}
    if not args.no_cancel_test:
        fixture = CACHE / "sentence.wav"
        if fixture.exists():
            cancellation = await cancel_test(client, base, fixture.read_bytes(), args.runs)
            print("")
            print(f"/stt alone                        : "
                  f"{json.dumps(cancellation['coldMs'])}")
            print(f"/stt right after a cancelled /stt : "
                  f"{json.dumps(cancellation['afterCancelledMs'])}")

    await client.aclose()

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "httpFloorMs": floor_stats,
                "healthMs": health_stats,
                "rows": results,
                "cancellation": cancellation,
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
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--only", nargs="*", default=None, help="fixture names to run")
    parser.add_argument(
        "--no-cancel-test",
        action="store_true",
        help="skip the cancelled-/stt probe (it costs three extra decodes a run)",
    )
    parser.add_argument(
        "--out",
        default=str(Path(tempfile.gettempdir()) / "medihive-timing" / "bench_sidecar.json"),
    )
    raise SystemExit(asyncio.run(run(parser.parse_args())))


if __name__ == "__main__":
    main()
