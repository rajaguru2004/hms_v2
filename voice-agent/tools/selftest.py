"""Everything except LiveKit, checked in one pass.

The full round trip needs a LiveKit Cloud room and a second participant
(tools/speak_into_room.py). This checks the half that does not: the sidecar
routes, the audio conversions at every rate this system uses, Silero VAD
endpointing, and — the part most worth a test — that the two language refusals
are passed through rather than papered over.

    .venv\\Scripts\\python.exe tools\\selftest.py

Exits non-zero if anything fails, so it can gate a deploy.
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402
from livekit import rtc  # noqa: E402

from audio import (  # noqa: E402
    PcmFramer,
    frames_duration,
    frames_to_wav,
    wav_to_frames,
)
from config import Settings, load_env_file  # noqa: E402
from sidecar import (  # noqa: E402
    SidecarClient,
    SidecarRefusal,
    SidecarUnavailable,
    split_for_speech,
)

PHRASE = "The patient has had a headache for three days."

# Two sentences, for the streaming checks only. See the note beside them.
TWO_SENTENCES = (
    "The patient has had a headache for three days. "
    "It has not improved with rest."
)

results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f" — {detail}" if detail else ""))
    return ok


def _resample_linear(samples: np.ndarray, src: int, dst: int) -> np.ndarray:
    if src == dst or samples.size == 0:
        return samples
    n = int(samples.size / src * dst)
    return np.interp(
        np.linspace(0, samples.size - 1, n), np.arange(samples.size), samples.astype(np.float64)
    ).astype(np.int16)


async def main() -> int:
    load_env_file()
    settings = Settings.load()
    client = SidecarClient(settings.sidecar_url)

    print(f"\n=== sidecar at {settings.sidecar_url} ===")
    try:
        health = await client.health()
    except SidecarUnavailable as exc:
        print(f"  FAIL  sidecar unreachable: {exc}")
        print("        start it with ..\\ai-sidecar\\run.ps1")
        return 1
    check("sidecar /health", True, f"stt={health['stt']} ttsLanguages={health['ttsLanguages']}")

    # ── TTS: English, at Piper's own rate ───────────────────────────────────
    print("\n=== TTS (en) ===")
    t0 = time.monotonic()
    wav, provider = await client.speak(PHRASE, "en")
    tts_ms = (time.monotonic() - t0) * 1000
    check("POST /tts en", len(wav) > 1000, f"{len(wav)} bytes via {provider} in {tts_ms:.0f} ms")

    frames = wav_to_frames(wav, frame_ms=20)
    rate = frames[0].sample_rate if frames else 0
    check(
        "wav_to_frames keeps the native rate",
        rate == 22050,
        f"{len(frames)} frames at {rate} Hz, {frames_duration(frames):.2f}s",
    )
    check(
        "20 ms frames at that rate",
        bool(frames) and frames[0].samples_per_channel == rate * 20 // 1000,
        f"{frames[0].samples_per_channel if frames else 0} samples/frame",
    )

    # ── Streaming TTS: the same audio, arriving before it is finished ───────
    #
    # The check that matters is the last one. A streaming route that is
    # collected into a buffer somewhere in the middle — by a proxy, by an
    # `aread()` left in by accident — still returns correct audio and still
    # passes every other assertion here, while delivering none of the latency
    # it exists for. Comparing first-audio against whole-utterance is the only
    # thing that catches it.
    #
    # `TWO_SENTENCES`, not `PHRASE`, and that is the whole reason this constant
    # exists. The streaming granularity is a *sentence* — Piper's generator
    # yields one chunk per sentence and IndicF5 is chunked the same way — so a
    # single-sentence utterance streams in exactly one piece and its first audio
    # legitimately arrives at the same moment as its last. Measured: `PHRASE`
    # gives 1079 ms of 1079 ms, which looks like a broken stream and is not.
    print("\n=== TTS streaming (en) ===")
    t0 = time.monotonic()
    first_audio_ms: float | None = None
    total_frames = 0
    chunks = 0
    provider_id = ""
    stream_rate = 0
    async with client.speak_stream(TWO_SENTENCES, "en") as stream:
        provider_id = stream.provider
        stream_rate = stream.sample_rate
        framer = PcmFramer(stream.sample_rate, frame_ms=20)
        async for chunk in stream.chunks:
            chunks += 1
            produced = framer.push(chunk)
            if produced and first_audio_ms is None:
                first_audio_ms = (time.monotonic() - t0) * 1000
            total_frames += len(produced)
        total_frames += len(framer.flush())
    stream_ms = (time.monotonic() - t0) * 1000

    check(
        "POST /tts/stream en",
        total_frames > 0 and provider_id == "piper",
        f"{chunks} chunks, {total_frames} frames via {provider_id} in {stream_ms:.0f} ms",
    )
    check(
        "the stream reports its sample rate",
        stream_rate == 22050,
        f"X-TTS-Sample-Rate: {stream_rate}",
    )
    # One chunk per sentence, so two sentences must not arrive as one blob.
    # This is what fails if `synthesize_stream` is ever quietly replaced by the
    # base class's whole-text fallback.
    check(
        "the stream arrives in pieces",
        chunks >= 2,
        f"{chunks} chunks for 2 sentences",
    )
    # Deliberately NOT an exact frame-count comparison against `/tts` for the
    # same text. Piper pads the start and end of every chunk with a little
    # silence, so N sentences streamed is legitimately a few frames longer than
    # N sentences synthesised as one — measured at 121 vs 117 for one sentence.
    # A strict equality here fails on correct behaviour; what is worth checking
    # is that the duration is in the right place at all.
    streamed_seconds = total_frames * 0.02
    check(
        "streamed audio is a plausible length",
        2.0 < streamed_seconds < 12.0,
        f"{streamed_seconds:.2f}s of audio in {total_frames} frames",
    )
    check(
        "first audio arrives before the utterance is finished",
        first_audio_ms is not None and first_audio_ms < stream_ms * 0.9,
        f"first audio {first_audio_ms:.0f} ms of {stream_ms:.0f} ms total"
        if first_audio_ms is not None
        else "no audio at all",
    )

    # A refusal must look the same on both transports, or the streaming route
    # becomes the way a Tamil session quietly gets an English voice.
    try:
        async with client.speak_stream(TWO_SENTENCES, "ta") as bad:
            async for _ in bad.chunks:
                break
        check("/tts/stream ta refused", False, "SUBSTITUTED — serious")
    except SidecarRefusal as refusal:
        check(
            "/tts/stream ta refused",
            refusal.status == 503,
            f"{refusal.status}: {refusal.patient_message}",
        )
    except SidecarUnavailable as exc:
        check("/tts/stream ta refused", False, f"transport: {exc}")

    # ── TTS refusals: a language with no voice must NOT be substituted ──────
    print("\n=== TTS refusals (must not substitute) ===")
    for code, name in (("ta", "Tamil"), ("or", "Odia"), ("bn", "Bengali")):
        try:
            _, sub = await client.speak(PHRASE, code)
            check(f"/tts {code} ({name}) refused", False, f"SUBSTITUTED by {sub} — serious")
        except SidecarRefusal as refusal:
            check(
                f"/tts {code} ({name}) refused",
                refusal.status == 503,
                f"{refusal.status}: {refusal.patient_message}",
            )
        except SidecarUnavailable as exc:
            check(f"/tts {code} ({name}) refused", False, f"transport: {exc}")

    # Hindi is the other language Piper does serve; it must NOT refuse.
    try:
        hi_wav, hi_provider = await client.speak("आपको कब से दर्द है?", "hi")
        check("/tts hi speaks", len(hi_wav) > 1000, f"{len(hi_wav)} bytes via {hi_provider}")
    except SidecarRefusal as refusal:
        check("/tts hi speaks", False, f"refused: {refusal.patient_message}")

    # ── The 22050 -> 16000 hop, and STT ────────────────────────────────────
    print("\n=== STT (en) ===")
    samples = np.concatenate([np.frombuffer(bytes(f.data), dtype=np.int16) for f in frames])
    at_16k = _resample_linear(samples, rate, 16000)
    frames_16k = [
        rtc.AudioFrame(
            data=at_16k[i : i + 320].tobytes(),
            sample_rate=16000,
            num_channels=1,
            samples_per_channel=int(at_16k[i : i + 320].size),
        )
        for i in range(0, at_16k.size, 320)
        if at_16k[i : i + 320].size
    ]
    wav_16k = frames_to_wav(frames_16k)
    check(
        "frames_to_wav writes a 16 kHz mono header",
        wav_16k[24:28] == (16000).to_bytes(4, "little"),
        f"{len(wav_16k)} bytes",
    )

    t0 = time.monotonic()
    transcript = await client.transcribe(wav_16k, "en")
    stt_ms = (time.monotonic() - t0) * 1000
    heard = transcript.text.lower()
    check(
        "POST /stt transcribes it back",
        "headache" in heard and "three days" in heard,
        f'"{transcript.text}" confidence={transcript.confidence:.3f} in {stt_ms:.0f} ms',
    )

    # ── The Odia refusal, which is the one that must never 200 ─────────────
    print("\n=== STT refusal (Odia has no Whisper model) ===")
    try:
        odia = await client.transcribe(wav_16k, "or")
        check("/stt or refused", False, f'returned "{odia.text}" at 200 — serious')
    except SidecarRefusal as refusal:
        check(
            "/stt or refused",
            refusal.status == 400,
            f"{refusal.status}: {refusal.patient_message}",
        )

    # ── Silero VAD endpoints the utterance ─────────────────────────────────
    print("\n=== Silero VAD ===")
    from livekit.plugins import silero

    t0 = time.monotonic()
    vad = silero.VAD.load(
        sample_rate=16000,
        force_cpu=True,
        min_speech_duration=settings.silero_min_speech,
        min_silence_duration=settings.silero_min_silence,
        prefix_padding_duration=settings.silero_prefix_pad,
        activation_threshold=settings.silero_activation,
        deactivation_threshold=settings.silero_deactivation,
    )
    check("silero.VAD.load", True, f"{(time.monotonic() - t0) * 1000:.0f} ms, CPU")

    stream = vad.stream()
    starts = ends = 0
    endpointed: list[rtc.AudioFrame] = []

    async def _drain() -> None:
        nonlocal starts, ends, endpointed
        async for event in stream:
            if event.type.value == "start_of_speech":
                starts += 1
            elif event.type.value == "end_of_speech":
                ends += 1
                endpointed = event.frames

    drain = asyncio.create_task(_drain())
    for frame in frames_16k:
        stream.push_frame(frame)
    # Trailing silence so min_silence_duration elapses and it endpoints.
    silence = np.zeros(320, dtype=np.int16)
    for _ in range(100):  # 2 s
        stream.push_frame(
            rtc.AudioFrame(
                data=silence.tobytes(), sample_rate=16000, num_channels=1, samples_per_channel=320
            )
        )
    stream.end_input()
    await asyncio.wait_for(drain, timeout=30)

    check("VAD found speech", starts >= 1, f"{starts} start_of_speech")
    check("VAD endpointed it", ends >= 1, f"{ends} end_of_speech")
    check(
        "endpointed audio includes prefix padding",
        frames_duration(endpointed) >= frames_duration(frames_16k) * 0.8,
        f"{frames_duration(endpointed):.2f}s buffered vs {frames_duration(frames_16k):.2f}s spoken",
    )

    # The endpointed buffer is what the worker sends to Whisper. Prove it is
    # transcribable, not merely present.
    if endpointed:
        again = await client.transcribe(frames_to_wav(endpointed), "en")
        check(
            "VAD buffer transcribes",
            "headache" in again.text.lower(),
            f'"{again.text}"',
        )

    # ── Chunking ────────────────────────────────────────────────────────────
    print("\n=== split_for_speech ===")
    long_text = " ".join([PHRASE] * 20)
    pieces = split_for_speech(long_text)
    check(
        "long text splits under the cap",
        all(len(p) <= 400 for p in pieces) and len(pieces) > 1,
        f"{len(pieces)} pieces, longest {max(len(p) for p in pieces)}",
    )
    check("a single question stays whole", len(split_for_speech(PHRASE)) == 1)

    await client.aclose()

    failed = [name for name, ok, _ in results if not ok]
    print(f"\n=== {len(results) - len(failed)}/{len(results)} passed ===")
    for name in failed:
        print(f"  FAILED: {name}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
