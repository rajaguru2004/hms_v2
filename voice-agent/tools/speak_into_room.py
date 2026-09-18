"""A fake patient: joins the room and says something out loud. **Development only.**

The worker is the thing being tested, and testing it needs a second participant
with a microphone. Rather than hold a phone up to a laptop, this joins the same
LiveKit Cloud room and publishes a synthesised utterance as a real audio track —
the sidecar's own `/tts` produces the speech, so the round trip is
Piper -> LiveKit Cloud -> the worker's Silero VAD -> the worker's Whisper.

That makes it a genuine end-to-end test of everything except a human larynx: the
audio really crosses the WebRTC transport, really gets resampled by the SDK,
really gets endpointed by VAD and really gets transcribed. What it does not
prove is microphone behaviour — no room noise, no AGC, no packet loss, and
Piper's output is cleaner than any phone will ever deliver.

    python tools/speak_into_room.py --room case-demo \
        --say "I have had a headache for three days"

It also listens: any audio the worker publishes back is received, and with
`--record out.wav` it is written to disk so the reply can be checked by ear.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import sys
import time
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402
from livekit import rtc  # noqa: E402

from audio import wav_to_frames  # noqa: E402
from config import Settings, load_env_file  # noqa: E402
from sidecar import SidecarClient  # noqa: E402
from tools.mint_token import mint  # noqa: E402

# What we publish the test utterance at. Piper's English voice is 22 050 Hz and
# `rtc.AudioSource` wants one fixed rate for the life of the track, so unlike
# the worker's playback path (which hands LiveKit mixed rates and lets it
# convert per-utterance) this one resamples once, here, to a rate the source
# was opened with. 48 kHz because that is what WebRTC negotiates anyway.
PUBLISH_RATE = 48000


def _resample_linear(samples: np.ndarray, src_rate: int, dst_rate: int) -> np.ndarray:
    """Good enough for a test fixture, and honest about being no better.

    Linear interpolation, not a windowed sinc. This is the test harness's
    microphone, not the product's audio path; anything Whisper can read is
    sufficient, and pulling in scipy for it would add a native wheel to a venv
    that is carefully pinned against Smart App Control.
    """
    if src_rate == dst_rate or samples.size == 0:
        return samples
    duration = samples.size / src_rate
    dst_n = int(duration * dst_rate)
    src_x = np.arange(samples.size, dtype=np.float64)
    dst_x = np.linspace(0, samples.size - 1, dst_n, dtype=np.float64)
    return np.interp(dst_x, src_x, samples.astype(np.float64)).astype(np.int16)


async def _publish_wav(source: rtc.AudioSource, wav: bytes) -> float:
    """Push a WAV into the track at realtime. Returns seconds published."""
    frames = wav_to_frames(wav, frame_ms=20)
    if not frames:
        return 0.0

    src_rate = frames[0].sample_rate
    samples = np.concatenate(
        [np.frombuffer(bytes(f.data), dtype=np.int16) for f in frames]
    )
    samples = _resample_linear(samples, src_rate, PUBLISH_RATE)

    frame_len = PUBLISH_RATE * 20 // 1000
    published = 0.0
    for i in range(0, samples.size, frame_len):
        chunk = samples[i : i + frame_len]
        if chunk.size < frame_len:
            # The source wants full frames; pad the tail with silence.
            chunk = np.pad(chunk, (0, frame_len - chunk.size))
        await source.capture_frame(
            rtc.AudioFrame(
                data=chunk.tobytes(),
                sample_rate=PUBLISH_RATE,
                num_channels=1,
                samples_per_channel=frame_len,
            )
        )
        published += frame_len / PUBLISH_RATE
    return published


async def run(args: argparse.Namespace) -> int:
    settings = Settings.load()
    sidecar = SidecarClient(settings.sidecar_url)

    print(f"synthesising via {settings.sidecar_url}/tts ...")
    wav, provider = await sidecar.speak(args.say, args.language)
    print(f"  {len(wav)} bytes of WAV from provider={provider}")

    room = rtc.Room()
    received: list[rtc.AudioFrame] = []
    transcripts: list[str] = []
    data_messages: list[dict] = []

    @room.on("data_received")
    def _on_data(packet: rtc.DataPacket) -> None:
        try:
            payload = json.loads(bytes(packet.data).decode("utf-8"))
        except Exception:
            return
        data_messages.append(payload)
        print(f"  [data {packet.topic}] {json.dumps(payload)[:300]}")

    @room.on("transcription_received")
    def _on_transcription(segments, participant, publication) -> None:  # type: ignore[no-untyped-def]
        for segment in segments:
            marker = "FINAL " if segment.final else "partial"
            transcripts.append(f"{marker}: {segment.text}")
            print(f"  [{marker}] {segment.text}")

    @room.on("track_subscribed")
    def _on_track(track, publication, participant) -> None:  # type: ignore[no-untyped-def]
        if track.kind != rtc.TrackKind.KIND_AUDIO:
            return
        print(f"  subscribed to audio from {participant.identity}")

        async def _drain() -> None:
            stream = rtc.AudioStream(track)
            async for event in stream:
                received.append(event.frame)

        asyncio.create_task(_drain())

    token = mint(args.room, args.identity, ttl_minutes=30)
    print(f"connecting to {settings.livekit_url} room={args.room} as {args.identity} ...")
    await room.connect(settings.livekit_url, token)
    print(f"  connected. participants already here: "
          f"{[p.identity for p in room.remote_participants.values()]}")

    source = rtc.AudioSource(PUBLISH_RATE, 1)
    track = rtc.LocalAudioTrack.create_audio_track("patient-mic", source)
    await room.local_participant.publish_track(
        track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
    )
    print("  published microphone track")

    # Let the worker notice us and subscribe before we start talking. Without
    # this the first second of the utterance is published into a room where
    # nobody has subscribed yet, and the VAD never sees the onset.
    await asyncio.sleep(args.warmup)

    print(f'speaking: "{args.say}"')
    started = time.monotonic()
    seconds = await _publish_wav(source, wav)
    print(f"  published {seconds:.2f}s of audio in {time.monotonic() - started:.2f}s wall")

    # Silence after the utterance so the VAD's min_silence_duration elapses and
    # it actually endpoints. Without trailing silence the turn never closes.
    silence = np.zeros(PUBLISH_RATE * 20 // 1000, dtype=np.int16)
    for _ in range(int(args.trailing_silence * 50)):
        await source.capture_frame(
            rtc.AudioFrame(
                data=silence.tobytes(),
                sample_rate=PUBLISH_RATE,
                num_channels=1,
                samples_per_channel=silence.size,
            )
        )

    if args.then_say:
        # Barge-in. The agent is expected to be mid-question by now: the first
        # utterance has been transcribed, posted and answered, and the answer is
        # being played out. Speaking over it should cut it off within
        # BARGE_MIN_SEC — about one word — rather than waiting for the whole
        # question to finish. `--then-after` is the dial for lining that up.
        print(f"waiting {args.then_after}s, then barging in ...")
        await asyncio.sleep(args.then_after)
        barge_wav, _ = await sidecar.speak(args.then_say, args.language)
        print(f'barging in: "{args.then_say}"')
        barge_started = time.monotonic()
        await _publish_wav(source, barge_wav)
        print(f"  barge audio published in {time.monotonic() - barge_started:.2f}s")
        for _ in range(int(args.trailing_silence * 50)):
            await source.capture_frame(
                rtc.AudioFrame(
                    data=silence.tobytes(),
                    sample_rate=PUBLISH_RATE,
                    num_channels=1,
                    samples_per_channel=silence.size,
                )
            )

    print(f"listening for {args.listen}s ...")
    await asyncio.sleep(args.listen)

    print("\n--- result ---")
    print(f"transcription events : {len(transcripts)}")
    for line in transcripts:
        print(f"    {line}")
    print(f"data messages        : {len(data_messages)}")
    print(f"audio frames received: {len(received)}")
    if received:
        total = sum(f.samples_per_channel / f.sample_rate for f in received)
        print(f"audio received       : {total:.2f}s at {received[0].sample_rate} Hz")

    if args.record and received:
        payload = b"".join(bytes(f.data) for f in received)
        with wave.open(args.record, "wb") as wf:
            wf.setnchannels(received[0].num_channels)
            wf.setsampwidth(2)
            wf.setframerate(received[0].sample_rate)
            wf.writeframes(payload)
        print(f"wrote {args.record}")

    await room.disconnect()
    await sidecar.aclose()
    return 0 if received else 1


def main() -> None:
    load_env_file()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--room", required=True)
    parser.add_argument("--identity", default="patient-test")
    parser.add_argument("--say", default="I have had a headache for three days")
    parser.add_argument("--language", default="en")
    parser.add_argument("--warmup", type=float, default=2.0)
    parser.add_argument("--trailing-silence", type=float, default=2.0)
    parser.add_argument("--listen", type=float, default=25.0)
    parser.add_argument(
        "--then-say", default=None, help="a second utterance, to test barge-in"
    )
    parser.add_argument(
        "--then-after",
        type=float,
        default=6.0,
        help="seconds to wait before --then-say; aim for mid-question",
    )
    parser.add_argument("--record", default=None, help="write received audio to this WAV")
    args = parser.parse_args()

    with contextlib.suppress(KeyboardInterrupt):
        raise SystemExit(asyncio.run(run(args)))


if __name__ == "__main__":
    main()
