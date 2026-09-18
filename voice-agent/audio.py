"""PCM in both directions, and the sample rates at each hop.

There are three rates in this system and it is worth naming them once:

    48 000 Hz   what the phone publishes into the LiveKit room (Opus decodes
                to whatever the track negotiated; on WebRTC this is 48 kHz).
    16 000 Hz   what Silero VAD and faster-whisper want. Neither is optional:
                Silero's ONNX graph is built for 8 k or 16 k and nothing else,
                and Whisper's mel front-end assumes 16 k.
    22 050 Hz   what Piper's English voice emits. Its own native rate.

The downward conversion (48 k -> 16 k) is not done here. `RecognizeStream` is
constructed with `sample_rate=16000` and livekit-agents resamples every frame
pushed into it before our code sees it — see stt_adapter.py. Doing it ourselves
would be a second resampler doing the same work with worse quality.

The upward conversion (22 050 -> 48 k) is **deliberately not done at all**.
[wav_to_frames] emits `rtc.AudioFrame` at whatever rate the WAV says, and
LiveKit's audio source resamples on the way into the track. This mirrors the
reference implementation. Resampling 22 050 -> 48 000 in numpy before handing
it over would be a non-integer ratio done badly, one extra copy of every
utterance in memory on a box with ~1 GB free, and it would throw away the
higher-quality resampler already sitting in the native SDK.
"""

from __future__ import annotations

import io
import wave
from typing import AsyncIterator, Iterable

import numpy as np
from livekit import rtc

import timing


def wav_to_frames(data: bytes, *, frame_ms: int = 20) -> list[rtc.AudioFrame]:
    """A WAV body from the sidecar's /tts, as frames at its own sample rate.

    `frame_ms` is a duration, not a sample count, so the same 20 ms holds
    whether Piper answered at 22 050 Hz (English) or some other voice's rate.
    A voice whose rate changed would otherwise silently halve or double the
    playback speed, which is the kind of bug that reaches a patient as a
    chipmunk reading their symptoms back.
    """
    if not data:
        return []

    with wave.open(io.BytesIO(data), "rb") as wf:
        sample_rate = wf.getframerate()
        channels = wf.getnchannels()
        sample_width = wf.getsampwidth()
        raw = wf.readframes(wf.getnframes())

    if sample_width == 2:
        samples = np.frombuffer(raw, dtype=np.int16)
    elif sample_width == 4:
        # 32-bit PCM, taken to int16 by keeping the high word. Piper does not
        # produce this; a substituted voice might.
        samples = (np.frombuffer(raw, dtype=np.int32) >> 16).astype(np.int16)
    elif sample_width == 1:
        # 8-bit WAV is unsigned with a 128 bias, not signed. Reading it as int8
        # inverts the waveform's polarity and shifts it, which is audible.
        samples = ((np.frombuffer(raw, dtype=np.uint8).astype(np.int16) - 128) << 8).astype(
            np.int16
        )
    else:
        raise ValueError(f"unsupported WAV sample width: {sample_width} bytes")

    if channels > 1:
        # Mean across channels in int32 so a loud stereo pair cannot wrap.
        samples = (
            samples.reshape(-1, channels).astype(np.int32).mean(axis=1).astype(np.int16)
        )

    frame_len = max(1, int(sample_rate * frame_ms / 1000))
    frames: list[rtc.AudioFrame] = []
    for i in range(0, len(samples), frame_len):
        chunk = samples[i : i + frame_len]
        if not chunk.size:
            continue
        frames.append(
            rtc.AudioFrame(
                data=chunk.tobytes(),
                # Piper's native rate, passed straight through. LiveKit converts.
                sample_rate=sample_rate,
                num_channels=1,
                samples_per_channel=int(chunk.shape[0]),
            )
        )
    return frames


class PcmFramer:
    """Raw PCM arriving in whatever sizes the engine chose, out in 20 ms frames.

    `/tts/stream` yields a chunk per synthesised piece — one Piper sentence is
    about 48 KB, one IndicF5 sentence rather more — and `rtc.AudioFrame` wants
    a fixed, small frame so that a barge-in is noticed between two of them
    rather than after a whole sentence. So the chunks are concatenated into a
    rolling buffer and cut at frame boundaries.

    The leftover matters. A chunk almost never divides evenly into 20 ms of
    samples, and it is not guaranteed to contain a whole number of samples
    either: a tail of one byte, dropped, shifts the parity of the entire rest of
    the stream by a byte and every sample after it is noise. It is carried
    instead, and [flush] emits what is left at the end of the utterance.
    """

    def __init__(self, sample_rate: int, *, frame_ms: int = 20) -> None:
        self.sample_rate = sample_rate
        # Two bytes per sample, mono. The frame length is derived from the rate
        # rather than fixed, so 22050 Hz (Piper) and 24000 Hz (IndicF5) both
        # produce 20 ms of audio rather than 20 ms of one and 18 of the other.
        self._frame_bytes = max(2, int(sample_rate * frame_ms / 1000)) * 2
        self._buffer = bytearray()

    def push(self, chunk: bytes) -> list[rtc.AudioFrame]:
        """Every whole frame this chunk completes. Possibly none."""
        self._buffer.extend(chunk)
        frames: list[rtc.AudioFrame] = []
        while len(self._buffer) >= self._frame_bytes:
            frames.append(self._frame(bytes(self._buffer[: self._frame_bytes])))
            del self._buffer[: self._frame_bytes]
        return frames

    def flush(self) -> list[rtc.AudioFrame]:
        """The tail, padded to a whole sample. Called once, at end of stream."""
        if len(self._buffer) < 2:
            self._buffer.clear()
            return []
        # An odd byte is a truncated sample and there is nothing to pair it
        # with; dropping one byte at the very end costs nothing audible.
        usable = len(self._buffer) - (len(self._buffer) % 2)
        frame = self._frame(bytes(self._buffer[:usable]))
        self._buffer.clear()
        return [frame]

    def _frame(self, payload: bytes) -> rtc.AudioFrame:
        return rtc.AudioFrame(
            data=payload,
            sample_rate=self.sample_rate,
            num_channels=1,
            samples_per_channel=len(payload) // 2,
        )


async def frames_stream(frames: Iterable[rtc.AudioFrame]) -> AsyncIterator[rtc.AudioFrame]:
    """Hand frames to `session.say` as fast as it will take them.

    No per-frame `sleep(frame_ms)` pacing. LiveKit's audio source buffers these
    and plays them at exact realtime, applying backpressure when its queue
    fills. Pacing them by hand on Windows means sleeping on a ~15 ms timer
    granularity for a 20 ms frame, which underruns the playout buffer and comes
    out as choppy speech. `sleep(0)` yields to the event loop so a barge-in
    cancellation is noticed between frames.
    """
    first = True
    count = 0
    started = 0.0
    for frame in frames:
        if first:
            # Hop 6 starts here: the first frame of the reply handed to
            # livekit-agents. Everything after this mark and before the probe
            # hears audio is resampling, Opus, and the wire.
            started = timing.mark("say.first_frame_out")
            first = False
        yield frame
        count += 1
        await asyncio_sleep_zero()
    if not first:
        timing.span("say.frames_drained", started, frames=count)


async def asyncio_sleep_zero() -> None:
    import asyncio

    await asyncio.sleep(0)


def frames_to_wav(frames: Iterable[rtc.AudioFrame]) -> bytes:
    """Buffered speech from the VAD, as a WAV the sidecar's /stt can open.

    The frames arriving here are already 16 kHz mono int16 — `RecognizeStream`
    was constructed with `sample_rate=16000`, so livekit-agents resampled them
    before the VAD ever saw them. The rate is taken from the frames rather than
    hardcoded so that a future caller at a different rate produces a correct
    header instead of a fast one.

    faster-whisper reads a path, and the sidecar writes what it receives to a
    temp file, so WAV is the right container: no decode, no codec negotiation,
    and PyAV opens it without opinion.
    """
    frames = list(frames)
    if not frames:
        return b""

    sample_rate = frames[0].sample_rate
    channels = frames[0].num_channels
    payload = b"".join(bytes(f.data) for f in frames)

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)  # int16; everything upstream of here is int16 PCM
        wf.setframerate(sample_rate)
        wf.writeframes(payload)
    return buffer.getvalue()


def frames_duration(frames: Iterable[rtc.AudioFrame]) -> float:
    """Seconds of audio in a frame list. Used to decide whether to bother."""
    total = 0.0
    for f in frames:
        if f.sample_rate:
            total += f.samples_per_channel / f.sample_rate
    return total
