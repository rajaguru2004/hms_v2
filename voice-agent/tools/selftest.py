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

from audio import frames_duration, frames_to_wav, wav_to_frames  # noqa: E402
from config import Settings, load_env_file  # noqa: E402
from sidecar import (  # noqa: E402
    SidecarClient,
    SidecarRefusal,
    SidecarUnavailable,
    split_for_speech,
)

PHRASE = "The patient has had a headache for three days."

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

    # ── TTS refusals: a language with no voice must NOT be substituted ──────
    #
    # Which languages those are is **asked, not assumed**. `ta` used to be on
    # this list as a must-refuse, and it stopped being one the day somebody
    # dropped `ta_IN-ValluvarNeural-medium.onnx` into ai-sidecar/voices —
    # PiperTTS._index rescans the directory per request precisely so that
    # works without a restart. The hard-coded list then failed a correct
    # system, which is the worst thing a pre-deploy check can do: the next
    # person reads "SUBSTITUTED by piper — serious", finds nothing wrong, and
    # learns to ignore the whole file.
    #
    # So /health names the languages that have a voice right now, and this
    # checks the two halves of the contract against it: everything it lists
    # speaks, everything it does not list refuses with a 503.
    print("\n=== TTS: /health's list is the contract ===")
    spoken_languages = [str(code) for code in (health.get("ttsLanguages") or [])]
    print(f"  /health reports ttsLanguages={spoken_languages or '(none)'}")

    probe = {
        "en": PHRASE,
        "hi": "आपको कब से दर्द है?",
        "ta": "உங்களுக்கு எவ்வளவு நாட்களாக வலி இருக்கிறது?",
        "bn": "আপনার কতদিন ধরে ব্যথা?",
        "or": PHRASE,
    }
    for code, phrase in probe.items():
        expected_to_speak = code in spoken_languages
        try:
            wav, provider = await client.speak(phrase, code)
            check(
                f"/tts {code} speaks" if expected_to_speak else f"/tts {code} refuses",
                expected_to_speak and len(wav) > 1000,
                f"{len(wav)} bytes via {provider}"
                if expected_to_speak
                else f"SUBSTITUTED by {provider} — serious",
            )
        except SidecarRefusal as refusal:
            check(
                f"/tts {code} speaks" if expected_to_speak else f"/tts {code} refuses",
                not expected_to_speak and refusal.status == 503,
                f"{refusal.status}: {refusal.patient_message}",
            )
        except SidecarUnavailable as exc:
            check(f"/tts {code}", False, f"transport: {exc}")

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
