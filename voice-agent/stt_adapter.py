"""faster-whisper, over HTTP, presented to LiveKit as a streaming STT.

This is the hand-rolled part. `livekit.agents.stt.StreamAdapter` already wraps a
non-streaming STT with a VAD and would have been four lines, but it can only
ever emit **final** transcripts: it buffers until the VAD says end-of-speech and
recognises once. The user's decision for this system is audio up, *partial
transcripts back*, and a partial has to come from somewhere.

So [SidecarRecognizeStream] is StreamAdapter's structure with one addition:
while the patient is still speaking, it periodically transcribes the audio
accumulated so far and emits it as `INTERIM_TRANSCRIPT`. The final transcript is
still a clean decode of the whole utterance including the VAD's prefix padding,
so an interim can never become the clinical record — it is a display artifact
and nothing downstream of `user_input_transcribed(is_final=True)` ever sees it.

## What an interim costs, and the two guards on it

Every interim is a full Whisper decode of everything said so far. It is not
incremental: faster-whisper has no partial-decode API, so transcribing 4 seconds
of speech costs what transcribing 4 seconds of speech costs, and doing it every
1.4 seconds during a 12-second answer is roughly five extra decodes on a CPU
that is also holding Ollama. Hence:

  * **One in flight at a time.** If the previous interim has not come back, the
    next tick is skipped rather than queued. On a slow box interims simply get
    sparser, which degrades the display and nothing else.
  * **`MEDIHIVE_INTERIM_TRANSCRIPTS=0` turns them off entirely**, and then the
    audio accumulator is never filled either, so the feature costs nothing at
    all rather than merely not being shown.

## Sample rate

`super().__init__(..., sample_rate=16000)` makes `RecognizeStream.push_frame`
resample every incoming frame before our code sees it. Room audio arrives at
48 kHz; Silero and Whisper both require 16 kHz. That one argument is the whole
downsampling story — see audio.py.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import OrderedDict
from typing import AsyncIterable, Awaitable, Callable

import numpy as np
from livekit import rtc
from livekit.agents import APIConnectOptions, stt, utils, vad
from livekit.agents.types import NOT_GIVEN, NotGivenOr
from livekit.agents.utils import is_given

import timing
from audio import frames_duration, frames_to_wav
from sidecar import SidecarClient, SidecarRefusal, SidecarUnavailable

logger = logging.getLogger(__name__)

# Whisper and Silero both want this and neither will take anything else.
INFERENCE_SAMPLE_RATE = 16000


def _trim_trailing_silence(
    frames: list[rtc.AudioFrame], *, keep_ms: float = 120.0
) -> list[rtc.AudioFrame]:
    """Drop whole trailing frames that are essentially silent.

    Module level, and that placement is not incidental. This function was
    originally written at column 0 *between* two methods of `SidecarSTT`, which
    is legal Python and quietly catastrophic: the class body ended here, and
    `_transcribe` below — still indented as a method — became a nested function
    inside this one, after its `return`. Unreachable, so never defined on the
    class. Every utterance then died on `'SidecarSTT' object has no attribute
    '_transcribe'`, both the final and the interim path, and nothing a patient
    said was ever transcribed or posted. Keep helpers above the class.

    Frame-granular and amplitude-based rather than time-based, deliberately: it
    trims what is actually quiet rather than assuming the endpointer's window
    was exactly `SILERO_MIN_SILENCE_MS`. If the patient's last word runs into
    the window, that frame is not silent and survives.

    `keep_ms` of the quiet is kept on purpose. Whisper is being handed a
    fragment, and a decoder that ends flush against the final consonant is one
    that clips it; a little room after the speech is what a natural end of
    utterance sounds like.

    Never returns an empty list — an all-silent buffer is handed back whole, so
    a caller counting on "frames in, frames out" is never surprised, and the
    silence fixture that measures the fixed cost still measures it.
    """
    if not frames:
        return frames

    threshold = 400  # int16; below this a 20 ms frame carries no speech.
    last_voiced = -1
    for index, frame in enumerate(frames):
        samples = np.frombuffer(frame.data, dtype=np.int16)
        if samples.size and int(np.abs(samples).max()) > threshold:
            last_voiced = index

    if last_voiced < 0:
        return frames

    per_frame_ms = (frames[0].samples_per_channel / frames[0].sample_rate) * 1000.0
    keep = max(1, int(round(keep_ms / per_frame_ms))) if per_frame_ms else 1
    end = min(len(frames), last_voiced + 1 + keep)
    return frames[:end] if end < len(frames) else frames


class SidecarSTT(stt.STT):
    """Presents the sidecar as a streaming, interim-capable STT."""

    def __init__(
        self,
        *,
        client: SidecarClient,
        vad: vad.VAD,
        language: str,
        interim_enabled: bool = True,
        interim_every: float = 1.4,
        interim_min_speech: float = 0.9,
        on_problem: "Callable[[str, str, str], Awaitable[None]] | None" = None,
    ) -> None:
        super().__init__(
            capabilities=stt.STTCapabilities(streaming=True, interim_results=interim_enabled)
        )
        self._client = client
        self._vad = vad
        self._language = language
        self._interim_enabled = interim_enabled
        self._interim_every = interim_every
        self._interim_min_speech = interim_min_speech
        # Called with (kind, language, detail) when /stt cannot return a
        # transcript. `kind` is "refused" (final — no model will ever exist for
        # this language) or "unavailable" (the sidecar is down or restarting,
        # and the next utterance may well work).
        #
        # Without it the refusal ends here. `last_error` is set for /health and
        # a WARNING is logged, and the patient — who has just spoken and is
        # waiting — gets nothing at all: no audio, because there is no engine
        # text to speak, and no text, because nothing publishes it. An Odia
        # session presents as an agent that asks one question and then ignores
        # the patient forever.
        #
        # The sidecar writes that sentence for the patient, not for the log:
        # "We cannot listen in Odia yet. Please type your answer." is an
        # instruction that tells them what to do instead, and it is the only
        # thing standing between them and silence. This hands it back to the
        # agent, which is the only object here that can reach the room. The
        # same shape as the TTS refusal, which already publishes its reason.
        self.on_problem = on_problem
        # Surfaced on /health so an operator can see whether a language was
        # refused without reading the log.
        self.last_error: str | None = None
        self.refused_language: str | None = None
        # Confidence, carried around a gap in livekit-agents.
        #
        # `SpeechData` has a `confidence` field and we fill it with Whisper's
        # exponentiated average log-probability, but `UserInputTranscribedEvent`
        # — the thing `session.on("user_input_transcribed")` actually receives —
        # has only `transcript`, `is_final`, `item_id`, `speaker_id`, `language`
        # and `created_at`. The number is dropped in between.
        #
        # It matters because `SubmitTurnDto.transcriptConfidence` exists for it:
        # the engine is entitled to distrust a transcript, and its DTO calls this
        # "a real measurement, unlike anything a language model reports about
        # itself". Sending 0.0 would tell the engine every transcript is worthless.
        #
        # So the last few finals are parked here by exact text and claimed by the
        # handler. A dict rather than a single slot because two utterances can
        # resolve close together; bounded because this is a cache, not a record.
        self._confidences: OrderedDict[str, float] = OrderedDict()

    @property
    def language(self) -> str:
        return self._language

    @language.setter
    def language(self, code: str) -> None:
        """Change the language a *live* stream transcribes in.

        A setter rather than a plain attribute because the stream must see the
        change. `stream()` is called once, inside `session.start()`, and the
        session's real language is only known afterwards — it comes from
        `GET /sessions/:id`, which the agent reads once it has joined. A stream
        that had captured the language at construction would go on sending the
        old code to `/stt` for the rest of the interview, and for Whisper that
        is not a cosmetic difference: the wrong hint produces a confident
        transcript of the wrong language rather than an error.
        """
        self._language = code

    def remember_confidence(self, text: str, confidence: float) -> None:
        self._confidences[text] = confidence
        while len(self._confidences) > 8:
            self._confidences.popitem(last=False)

    def claim_confidence(self, text: str) -> float:
        """The confidence for this transcript, consumed once.

        Returns 0.0 if the text is not recognised, which happens when a
        transcript reaches the session by some path other than this STT. The
        engine reads 0.0 as "no measurement", which is the honest answer.
        """
        return self._confidences.pop(text, 0.0)

    async def _recognize_impl(
        self,
        buffer: utils.AudioBuffer,
        *,
        language: NotGivenOr[str] = NOT_GIVEN,
        conn_options: APIConnectOptions,
    ) -> stt.SpeechEvent:
        """The offline path. Used by tools/ and by any caller that has a whole
        utterance already; the streaming path below does not go through it."""
        frames = buffer if isinstance(buffer, list) else [buffer]
        code = language if is_given(language) else self._language
        return await self._transcribe(frames, code, final=True)

    def stream(
        self,
        *,
        language: NotGivenOr[str] = NOT_GIVEN,
        conn_options: APIConnectOptions = APIConnectOptions(),
    ) -> "SidecarRecognizeStream":
        return SidecarRecognizeStream(
            stt=self,
            conn_options=conn_options,
            language=language if is_given(language) else None,
        )

    async def _report(self, kind: str, language: str, detail: str, final: bool) -> None:
        """Hand an STT failure to whoever can reach the room.

        Finals only. An interim failure is the same failure arriving earlier,
        and reporting one per interim would put it on the patient's screen four
        times for one utterance.

        Swallowed on failure for the same reason `publish` swallows one: a data
        message that does not arrive must not take down the recogniser, which
        would end the interview outright.
        """
        if not final or self.on_problem is None:
            return
        try:
            await self.on_problem(kind, language, detail)
        except Exception as exc:  # pragma: no cover - diagnostics only
            logger.warning("could not report the STT %s: %s", kind, exc)

    async def _transcribe(
        self, frames: list[rtc.AudioFrame], language: str | None, *, final: bool
    ) -> stt.SpeechEvent:
        # Hop 2: buffered VAD frames -> a WAV body. Pure memory; recorded
        # because "we assumed it was free" is how a budget acquires a hole.
        _t = timing.mark("stt.wav_start", final=final, frames=len(frames))

        # Drop the silence the endpointer waited through before sending it.
        #
        # Silero only declares an utterance over after `SILERO_MIN_SILENCE_MS`
        # of quiet, and that quiet is inside the buffer it hands us. Together
        # with the 900 ms prefix pad it means every utterance was POSTed with
        # **1572 ms of padding**, measured exactly and without exception across
        # 11 turns: a 736 ms "three days" went up as a 2308 ms WAV, and a
        # 416 ms "no" as 1988 ms — 4.8x its own length. One run POSTed 39.6 s
        # of audio for 22.3 s of speech.
        #
        # The trailing part is silence by construction, so trimming it cannot
        # remove a word. The 900 ms PREFIX stays: that one is protecting the
        # first consonant, which Silero clips when it decides speech has begun.
        #
        # Worth ~25-55 ms per turn on CUDA, where `/stt` costs ~35 ms per
        # second of audio. It was worth ~500 ms on CPU, and it is the reason
        # in-flight `/stt` (419 ms) ran above the isolated bench for the same
        # speech (215-240 ms).
        frames = _trim_trailing_silence(frames)
        wav = frames_to_wav(frames)
        timing.span(
            "stt.wav_built",
            _t,
            final=final,
            bytes=len(wav),
            audio_ms=round(frames_duration(frames) * 1000.0, 1),
        )
        event_type = (
            stt.SpeechEventType.FINAL_TRANSCRIPT
            if final
            else stt.SpeechEventType.INTERIM_TRANSCRIPT
        )
        try:
            transcript = await self._client.transcribe(wav, language)
        except SidecarRefusal as refusal:
            # Odia, or an unreadable recording. Final and not retried. The
            # patient-facing sentence is kept so the agent can show it; an
            # empty transcript is returned so nothing is posted to the engine.
            self.last_error = refusal.patient_message
            if language:
                self.refused_language = language
            logger.warning("STT refused (%s): %s", language or "auto", refusal.patient_message)
            await self._report("refused", language or "", refusal.patient_message, final)
            return stt.SpeechEvent(type=event_type, alternatives=[])
        except SidecarUnavailable as exc:
            self.last_error = str(exc)
            logger.error("STT unavailable: %s", exc)
            # Reported for the same reason a refusal is. Measured with the
            # sidecar taken away under a live room: the patient answered, the
            # decode failed at the socket, and they got nothing — no text, no
            # audio, no error — for the fifty seconds until they gave up. The
            # worker itself recovered cleanly and the next answer worked, which
            # is the part that made the silence so misleading: nothing was
            # broken by then except the patient's belief that anyone was there.
            await self._report("unavailable", language or "", str(exc), final)
            return stt.SpeechEvent(type=event_type, alternatives=[])

        self.last_error = None
        if final and transcript.text:
            # Parked for the session handler, which will not receive it on the
            # event. See the note on _confidences above.
            self.remember_confidence(transcript.text, transcript.confidence)
        return stt.SpeechEvent(
            type=event_type,
            alternatives=[
                stt.SpeechData(
                    language=transcript.language or (language or ""),
                    text=transcript.text,
                    confidence=transcript.confidence,
                    end_time=transcript.duration_ms / 1000.0,
                )
            ],
        )


class SidecarRecognizeStream(stt.RecognizeStream):
    def __init__(
        self,
        *,
        stt: SidecarSTT,
        conn_options: APIConnectOptions,
        language: str | None,
    ) -> None:
        # sample_rate=16000: livekit-agents resamples 48 kHz room audio for us.
        super().__init__(stt=stt, conn_options=conn_options, sample_rate=INFERENCE_SAMPLE_RATE)
        self._sidecar_stt = stt
        # None means "whatever the STT's language is right now". Only an
        # explicit per-stream override pins it. See SidecarSTT.language.
        self._override = language

    @property
    def _language(self) -> str:
        return self._override or self._sidecar_stt.language

    async def _metrics_monitor_task(self, event_aiter: AsyncIterable[stt.SpeechEvent]) -> None:
        # Drained, not measured. The default implementation reports per-request
        # STT metrics keyed on a request id the sidecar does not issue, and the
        # useful timing here (`serverTimeMs`, RSS) is reported elsewhere.
        async for _ in event_aiter:
            pass

    async def _run(self) -> None:
        vad_stream = self._sidecar_stt._vad.stream()

        async def _forward_input() -> None:
            async for frame in self._input_ch:
                if isinstance(frame, self._FlushSentinel):
                    vad_stream.flush()
                    continue
                vad_stream.push_frame(frame)
            vad_stream.end_input()

        async def _recognize() -> None:
            interim_task: asyncio.Task | None = None
            # Audio since START_OF_SPEECH, filled only when interims are on.
            accumulated: list[rtc.AudioFrame] = []
            last_interim_at = 0.0

            def _cancel_interim() -> None:
                nonlocal interim_task
                if interim_task is not None and not interim_task.done():
                    # Cancelling the HTTP request does not stop the sidecar
                    # decoding; the dead decode goes on competing with the final
                    # for the same CPU. Counted so the report can say how often.
                    timing.mark("interim.cancelled")
                    interim_task.cancel()
                interim_task = None

            async def _emit_interim(frames: list[rtc.AudioFrame]) -> None:
                started = timing.mark(
                    "interim.start", audio_ms=round(frames_duration(frames) * 1000.0, 1)
                )
                event = await self._sidecar_stt._transcribe(
                    frames, self._language, final=False
                )
                if not event.alternatives or not event.alternatives[0].text:
                    timing.span("interim.empty", started)
                    return
                if self._event_ch.closed:
                    timing.span("interim.dropped", started)
                    return
                self._event_ch.send_nowait(event)
                timing.span(
                    "interim.emitted", started, chars=len(event.alternatives[0].text)
                )

            try:
                async for event in vad_stream:
                    if event.type == vad.VADEventType.START_OF_SPEECH:
                        # The onset, as the worker sees it. Against the probe's
                        # own "I began speaking at T" this is transport + jitter
                        # buffer + SILERO_MIN_SPEECH_MS of confirmation.
                        timing.mark(
                            "vad.start_of_speech",
                            speech_ms=round(event.speech_duration * 1000.0, 1),
                            inference_ms=round(event.inference_duration * 1000.0, 1),
                        )
                        accumulated = []
                        last_interim_at = time.monotonic()
                        self._event_ch.send_nowait(
                            stt.SpeechEvent(type=stt.SpeechEventType.START_OF_SPEECH)
                        )

                    elif event.type == vad.VADEventType.INFERENCE_DONE:
                        if not self._sidecar_stt._interim_enabled or not event.speaking:
                            continue
                        accumulated.extend(event.frames)

                        now = time.monotonic()
                        busy = interim_task is not None and not interim_task.done()
                        long_enough = (
                            frames_duration(accumulated)
                            >= self._sidecar_stt._interim_min_speech
                        )
                        due = now - last_interim_at >= self._sidecar_stt._interim_every
                        if due and long_enough and not busy:
                            last_interim_at = now
                            # A copy: `accumulated` keeps growing while this runs.
                            interim_task = asyncio.create_task(
                                _emit_interim(list(accumulated))
                            )

                    elif event.type == vad.VADEventType.END_OF_SPEECH:
                        # An interim that lands after the final would overwrite
                        # the good transcript with a worse one on the display.
                        _cancel_interim()
                        accumulated = []

                        speech_end_time = (
                            time.time() - event.silence_duration - event.inference_duration
                        )
                        # Hop 1, and the only place the 650 ms design constant is
                        # observable. `silence_duration` is what Silero actually
                        # waited before declaring the utterance over;
                        # `inference_duration` is the ONNX call on the last
                        # window. `speech_end_time` is the worker's estimate of
                        # when the patient actually stopped, in the same wall
                        # clock the probe stamps its own last frame with.
                        timing.mark(
                            "vad.end_of_speech",
                            silence_ms=round(event.silence_duration * 1000.0, 1),
                            inference_ms=round(event.inference_duration * 1000.0, 1),
                            speech_ms=round(event.speech_duration * 1000.0, 1),
                            speech_end_wall=speech_end_time,
                            buffered_ms=round(frames_duration(event.frames) * 1000.0, 1),
                            frames=len(event.frames),
                        )
                        self._event_ch.send_nowait(
                            stt.SpeechEvent(
                                type=stt.SpeechEventType.END_OF_SPEECH,
                                speech_end_time=speech_end_time,
                            )
                        )

                        # `event.frames` is the complete utterance including the
                        # SILERO_PREFIX_PAD_MS of audio from before the VAD
                        # triggered — without it Whisper loses the consonant the
                        # patient started the word with.
                        final = await self._sidecar_stt._transcribe(
                            event.frames, self._language, final=True
                        )
                        timing.mark(
                            "stt.final_ready",
                            chars=len(final.alternatives[0].text) if final.alternatives else 0,
                        )
                        if not final.alternatives or not final.alternatives[0].text:
                            # Silence, noise, or a refusal. Nothing is posted to
                            # the engine: an empty turn is not an answer, and
                            # inventing one here would be this worker making a
                            # clinical decision.
                            continue
                        if self._event_ch.closed:
                            return
                        final.speech_end_time = speech_end_time
                        self._event_ch.send_nowait(final)
            finally:
                _cancel_interim()

        tasks = [
            asyncio.create_task(_forward_input(), name="sidecar-stt-input"),
            asyncio.create_task(_recognize(), name="sidecar-stt-recognize"),
        ]
        try:
            await asyncio.gather(*tasks)
        finally:
            await utils.aio.cancel_and_wait(*tasks)
            await vad_stream.aclose()
