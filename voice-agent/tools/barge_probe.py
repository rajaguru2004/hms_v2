"""Barge-in: from the patient starting to talk over the agent, to silence.

`BARGE_MIN_SEC` is 0.2 — about one word — and that is the configured *detection*
threshold, not the latency. The latency a patient experiences is longer than the
threshold by definition, and by an amount nobody has measured:

    patient's first sample leaves the wire
      + WebRTC up + the receiver's jitter buffer
      + BARGE_MIN_SEC of speech before Silero will call it an interruption
      + livekit-agents noticing and flushing its output
      + whatever is already in flight or in the patient's own jitter buffer,
        which will play out no matter what the worker does

Only the last three are the worker's, and only the sum is what the patient hears.
So this measures the sum, at the ear, and reports the worker's own view beside
it from the timing log.

    python tools/barge_probe.py --room case-<sessionId> --runs 5

## Method

Ask something that makes the agent talk, wait until its reply has been audible
for `--after` seconds so it is unambiguously mid-sentence, then start speaking.
`t_barge_wire` is corrected by `AudioSource.queued_duration` exactly as in
tools/latency_probe.py, because a frame that has been *queued* has not been
sent. `t_agent_quiet` is the last received frame above the noise floor.

The difference is reported raw. It is **not** corrected for the one-way audio
delay that tools/probe_transport.py measures, because the patient does not
experience a corrected number — but that delay is printed alongside so the
worker's share can be separated from the wire's.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import statistics
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402
from livekit import rtc  # noqa: E402

from config import Settings, load_env_file  # noqa: E402
from sidecar import SidecarClient  # noqa: E402
from tools.latency_probe import (  # noqa: E402
    AUDIBLE_PEAK,
    FRAME,
    PUBLISH_RATE,
    Probe,
    _pcm_from_wav,
    _resample,
    _silence,
    _speak,
    _stats,
    _trim_trailing_silence,
)


async def _fixture(sidecar: SidecarClient, text: str, language: str) -> np.ndarray:
    wav, _ = await sidecar.speak(text, language)
    samples, rate = _pcm_from_wav(wav)
    return _trim_trailing_silence(_resample(samples, rate, PUBLISH_RATE))


async def run(args: argparse.Namespace) -> int:
    settings = Settings.load()
    sidecar = SidecarClient(settings.sidecar_url)

    opener = await _fixture(sidecar, args.say, args.language)
    interrupt = await _fixture(sidecar, args.interrupt, args.language)
    print(
        f"opener {opener.size / PUBLISH_RATE:.2f}s, "
        f"interruption {interrupt.size / PUBLISH_RATE:.2f}s"
    )

    room = rtc.Room()
    probe = Probe(room, identity=args.identity)
    probe.attach()
    await room.connect(settings.livekit_url, __import__("tools.mint_token", fromlist=["mint"]).mint(
        args.room, args.identity, ttl_minutes=30
    ))
    source = rtc.AudioSource(PUBLISH_RATE, 1, queue_size_ms=1000)
    track = rtc.LocalAudioTrack.create_audio_track("patient-mic", source)
    await room.local_participant.publish_track(
        track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
    )
    print(f"joined {args.room}; waiting for the agent ...")

    deadline = time.perf_counter() + args.join_timeout
    while time.perf_counter() < deadline and probe.last_audible() is None:
        await _silence(source, 0.2)
    # Let the greeting play out. `last_audible`, not `heard[-1]`: a subscribed
    # track keeps delivering silent frames, so waiting for frames to stop waits
    # for ever.
    while True:
        last = probe.last_audible()
        if last is None or time.perf_counter() - last >= 0.8:
            break
        await _silence(source, 0.4)

    rows: list[dict] = []
    for index in range(args.runs):
        await _silence(source, 0.8)
        mark = len(probe.heard)
        await _speak(source, opener)  # (start, end); only the reply matters here

        # Wait until the agent's reply is unmistakably playing.
        deadline = time.perf_counter() + args.wait
        speaking_since = None
        while time.perf_counter() < deadline:
            await _silence(source, 0.05)
            recent = [h for h in probe.heard[mark:] if h[1] >= AUDIBLE_PEAK]
            if recent:
                speaking_since = recent[0][0]
                break
        if speaking_since is None:
            print(f"[{index}] the agent never spoke; skipping")
            continue

        # Let it get properly under way before interrupting.
        while time.perf_counter() - speaking_since < args.after:
            await _silence(source, 0.05)

        # ── The interruption ────────────────────────────────────────────────
        first = interrupt[:FRAME]
        if first.size < FRAME:
            first = np.pad(first, (0, FRAME - first.size))
        await source.capture_frame(rtc.AudioFrame(first.tobytes(), PUBLISH_RATE, 1, FRAME))
        # Everything queued ahead of that frame, minus the frame itself: when
        # its first sample actually goes out.
        ahead = max(0.0, source.queued_duration - (FRAME / PUBLISH_RATE))
        t_barge_wire = time.perf_counter() + ahead
        await _speak(source, interrupt[FRAME:])

        # ── When the agent actually went quiet ──────────────────────────────
        last_audible = None
        quiet_deadline = time.perf_counter() + args.quiet_timeout
        while time.perf_counter() < quiet_deadline:
            await _silence(source, 0.05)
            audible = [h for h in probe.heard if h[0] > t_barge_wire and h[1] >= AUDIBLE_PEAK]
            if audible:
                last_audible = audible[-1][0]
            if last_audible and time.perf_counter() - last_audible > args.quiet_for:
                break

        row = {
            "index": index,
            "bargeWireMono": t_barge_wire,
            "agentStartedAt": speaking_since,
            "agentIntoReplyMs": round((t_barge_wire - speaking_since) * 1000, 1),
            "bargeToSilenceMs": (
                round((last_audible - t_barge_wire) * 1000, 1) if last_audible else None
            ),
        }
        rows.append(row)
        print(
            f"[{index}] interrupted {row['agentIntoReplyMs']:.0f} ms into the reply; "
            f"agent audio stopped {row['bargeToSilenceMs']} ms later"
        )

        # Let the turn that the interruption caused settle.
        settle = time.perf_counter()
        while time.perf_counter() - settle < args.settle:
            await _silence(source, 0.2)
            if probe.heard and probe.heard[-1][1] >= AUDIBLE_PEAK:
                settle = time.perf_counter()

    await room.disconnect()
    await sidecar.aclose()

    values = [r["bargeToSilenceMs"] for r in rows]
    print(f"\nbarge-in, speech start -> agent silent (at the ear): {json.dumps(_stats(values))}")
    print(f"configured BARGE_MIN_SEC: {settings.barge_min_sec}s = {settings.barge_min_sec * 1000:.0f} ms")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps({"bargeMinSec": settings.barge_min_sec, "rows": rows}, indent=2),
        encoding="utf-8",
    )
    print(f"wrote {out}")
    return 0


def main() -> None:
    load_env_file()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--room", required=True)
    parser.add_argument("--identity", default="patient-barge")
    parser.add_argument("--language", default="en")
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--say", default="three days")
    parser.add_argument("--interrupt", default="wait, actually it was five days")
    parser.add_argument("--after", type=float, default=0.7, help="seconds into the reply")
    parser.add_argument("--wait", type=float, default=30.0)
    parser.add_argument("--settle", type=float, default=2.0)
    parser.add_argument("--quiet-for", type=float, default=0.8)
    parser.add_argument("--quiet-timeout", type=float, default=15.0)
    parser.add_argument("--join-timeout", type=float, default=45.0)
    parser.add_argument(
        "--out",
        default=str(Path(tempfile.gettempdir()) / "medihive-timing" / "barge_probe.json"),
    )
    args = parser.parse_args()
    with contextlib.suppress(KeyboardInterrupt):
        raise SystemExit(asyncio.run(run(args)))


if __name__ == "__main__":
    main()
