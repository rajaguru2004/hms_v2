"""Piper — the fallback, and the only engine here with an English voice.

Piper is small, fast on a CPU, and has one `.onnx` file per voice. It is the
fallback rather than the default because `rhasspy/piper-voices` publishes
nothing for most of the eleven Indian languages this service now claims: there
is no `ta` tree at all. What it does have is English and Hindi, which are the
two languages a real phone is asking for today, so this provider is also the
backward-compatibility guarantee. `POST /tts {"language":"en"}` goes through
here and comes back the same 22050 Hz WAV it always did.

## Two invariants this file exists to keep

**A voice is never substituted.** [PiperTTS.voice_path] answers None for a
language it has no file for, and nothing downstream turns None into English.
The version that did read Tamil questions aloud in English at HTTP 200.

**The loaded-voice cache is keyed on the resolved file, never on the request
string.** Keyed on the request, `ta-IN`, `ta_IN` and `TA` each loaded their own
~63 MB copy of the same weights — and while `voice_path` was still falling back
to English, *any* string at all did. Seven ordinary `/tts` calls exhausted
memory and killed the process: a remotely reachable denial of service needing
no special input, just seven spellings of a language.
"""

from __future__ import annotations

import io
import logging
import threading
import time
import wave
from pathlib import Path
from typing import Iterator

from .base import TTSProvider, UnsupportedLanguage, log_synthesis, rss_mb
from .language_config import normalise

logger = logging.getLogger(__name__)

# Module level rather than per-instance, because what it is protecting is a
# process-wide resource: one file's weights, loaded once, shared by whatever
# asks for them. An instance-level cache would reload on every reconfiguration.
_loaded: dict[str, object] = {}
_lock = threading.Lock()

# One synthesis at a time, process-wide, whatever the voice.
#
# ## The bug this exists for
#
# Piper phonemises through espeak-ng, a C library that keeps the *current voice*
# in a process-wide global and switches it with `espeak_SetVoiceByName`. Two
# synthesis calls in flight at once therefore share one voice setting, and the
# loser gets its text phonemised by the other one's language. For Devanagari
# handed to `en-us` that produces **no phonemes at all**, which produces no
# audio, which surfaces two frames later and nowhere near the cause as
#
#     File "/app/tts/piper.py", line 160, in synthesize
#       with wave.open(buffer, "wb") as wav:
#     wave.Error: # channels not specified
#
# — the WAV complaining that nothing was ever written to it. The route turns
# that into `503 This voice is unavailable.`, so from outside it looks exactly
# like a missing voice file, and it comes and goes with the order requests
# happen to arrive in. Measured against the live sidecar: `/tts` English
# succeeded, the Hindi call immediately after it failed, and the identical call
# in a fresh process — where only one voice is ever selected — succeeded every
# time.
#
# ## Why it appeared now
#
# It did not appear, it became reachable. `/tts` used to be an `async def` doing
# blocking work directly on the event loop, so synthesis was serialised by
# accident: nothing else in the process could run during it. Moving it to
# `run_in_threadpool` — so a decode could no longer stall a live call — removed
# that accident and let two syntheses overlap for the first time.
#
# ## Why a lock rather than one voice per process
#
# A worker per language is the shape that actually scales, and this service is
# one uvicorn holding one Whisper on a 16 GB box. Serialising costs a queue on
# the rare overlap; the alternative costs a second copy of every model.
#
# ## Held per call into espeak, never across a yield
#
# `synthesize` takes it for the whole of `synthesize_wav`, which has no
# consumer to wait on. `synthesize_stream` takes it around each `next()` and
# releases it before handing the chunk over, because its consumer reads at
# realtime playback speed — see the long note there.
_espeak_lock = threading.Lock()


class PiperTTS(TTSProvider):
    id = "piper"

    def __init__(self, voice_dir: Path, overrides: dict[str, str] | None = None) -> None:
        self._voice_dir = voice_dir
        self._overrides = {normalise(k): v for k, v in (overrides or {}).items()}

    def _index(self) -> dict[str, Path]:
        """Language code to voice file, read off the disk each time.

        Rebuilt per call rather than cached, and that is a deliberate trade: the
        directory holds a handful of entries, so the scan is a few dirents,
        and in exchange a voice file copied in while the service is running
        becomes available without a restart. Reference audio and voices are
        being sourced by hand right now; a cache would mean "it says Tamil is
        still missing" every time somebody dropped a file in.

        Piper reads `<voice>.onnx.json` beside the weights for its phoneme
        table and sample rate, so a voice without one is not a voice yet — most
        often a download still in flight. Skipped rather than offered, because
        offering it means a 500 at synthesis instead of a 503 up front.
        """
        index: dict[str, Path] = {}
        try:
            candidates = sorted(self._voice_dir.glob("*.onnx"))
        except OSError:
            # A voice directory that does not exist is the ordinary state of a
            # fresh checkout, not an error: the weights are gitignored.
            candidates = []

        for path in candidates:
            if not Path(str(path) + ".json").exists():
                continue
            # `en_US-lessac-medium.onnx` -> `en_US` -> `en`. The upstream naming
            # convention is `<locale>-<speaker>-<quality>`, and the locale is
            # BCP-47 enough for `normalise` to reduce.
            code = normalise(path.name.split("-", 1)[0])
            # `setdefault`, over a sorted listing: with both `en_GB-…` and
            # `en_US-…` present the choice has to be *stable*, or a restart
            # silently changes the voice a patient hears.
            index.setdefault(code, path)

        for code, filename in self._overrides.items():
            index[code] = self._voice_dir / filename
        return index

    def voice_path(self, language: str) -> Path | None:
        """The voice file for this language, or None if there is not one.

        **None, never a fallback.** See the note at the top of this file.
        """
        path = self._index().get(normalise(language))
        return path if path is not None and path.exists() else None

    def supports(self, language: str) -> bool:
        try:
            import piper  # noqa: F401
        except Exception:
            return False
        return self.voice_path(language) is not None

    def status(self) -> dict:
        try:
            import piper  # noqa: F401
        except Exception:
            return {
                "id": self.id,
                "ready": False,
                "detail": "piper-tts is not installed",
                "languages": [],
            }
        languages = self.languages()
        return {
            "id": self.id,
            "ready": bool(languages),
            "detail": "" if languages else f"no voice files in {self._voice_dir}",
            "languages": languages,
        }

    def _voice(self, language: str):
        path = self.voice_path(language)
        if path is None:
            # Reached only if a caller skipped `supports()`. `main.py` checks
            # first and answers 503 with a written sentence; this is the guard
            # for everything else, and it refuses rather than substituting.
            raise UnsupportedLanguage(self.id, normalise(language))

        # Keyed on the **resolved file**, not on the requested language. The
        # comment at the top of this file is the whole reason.
        key = str(path)
        if key not in _loaded:
            with _lock:
                if key not in _loaded:
                    from piper import PiperVoice

                    started = time.perf_counter()
                    _loaded[key] = PiperVoice.load(key)
                    rss = rss_mb()
                    logger.info(
                        "piper loaded %s in %.2fs rss=%s",
                        path.name,
                        time.perf_counter() - started,
                        f"{rss:.0f}MB" if rss is not None else "?",
                    )
        return _loaded[key]

    def synthesize(self, text: str, language: str) -> bytes:
        """One WAV, whole. Streaming would be better for a long summary; it is
        not better enough to justify a second transport before the first one
        works."""
        voice = self._voice(language)
        started = time.perf_counter()
        buffer = io.BytesIO()
        with _espeak_lock, wave.open(buffer, "wb") as wav:
            # `synthesize_wav`, not `synthesize`: the latter is a per-sentence
            # chunk generator and leaves the WAV header unwritten, which
            # surfaces later as `wave.Error: # channels not specified` rather
            # than as a bad call. `set_wav_format` lets the voice declare its
            # own rate and width — 22050 Hz for the medium voices on disk.
            voice.synthesize_wav(text, wav, set_wav_format=True)
        audio = buffer.getvalue()
        log_synthesis(self.id, language, text, time.perf_counter() - started, audio)
        return audio

    def sample_rate(self, language: str) -> int:
        """The voice's own rate, off its config — 22050 Hz for the medium voices.

        Read from the loaded voice rather than from a constant. The two files on
        disk are both 22050 Hz and a third could be 16000 or 48000; a hardcoded
        rate would play it back at the wrong speed rather than fail, which is
        the failure mode `audio.py` spends a paragraph on at the other end.

        This loads the voice if it is not loaded, which is the point at which
        this differs from [supports]: the rate is a property of the weights.
        Callers ask it once per utterance, immediately before streaming, so the
        load it may trigger is one the next line was going to trigger anyway.
        """
        voice = self._voice(language)
        rate = getattr(getattr(voice, "config", None), "sample_rate", None)
        return int(rate) if rate else 22050

    def synthesize_stream(self, text: str, language: str) -> Iterator[bytes]:
        """Real streaming: `PiperVoice.synthesize` is a per-sentence generator.

        The base class would have worked — split, synthesise each piece whole,
        strip the header — and this is the same thing minus two round trips
        through a WAV container per sentence, using the API [synthesize] avoids
        precisely *because* it yields chunks instead of writing a header.

        No `set_wav_format` and no `wave` module here: `AudioChunk` carries raw
        int16 already, which is exactly what the caller wants and what the
        `/tts/stream` body is. `sample_rate` is not read off the chunks because
        the header has already been sent by then — it comes from [sample_rate]
        above, and the two agree because both come off the same voice config.
        """
        voice = self._voice(language)
        started = time.perf_counter()
        first = True
        total = 0
        # The lock is taken around each `next()` and released before the yield.
        #
        # NOT held across the whole generator, and that distinction is the
        # difference between a lock and an outage. The consumer here is the
        # LiveKit worker, which pushes frames into a room that plays them at
        # realtime and applies backpressure — so it reads this generator at
        # **speaking speed**, not as fast as it can. A lock spanning the yields
        # is therefore held for the entire spoken duration of the utterance, and
        # every other synthesis in the process queues behind a patient
        # listening to a sentence. Measured, with the lock held across the
        # loop:
        #
        #     piper en first chunk in 78456 ms (74 chars)
        #
        # — 78 seconds to start a two-second question, and a `/tts` caller that
        # timed out at 60 s waiting for it.
        #
        # Per-`next()` is the right granularity because it is espeak's:
        # `PiperVoice.phonemize` sets the voice and phonemises inside one call,
        # so one call is the unit that must not interleave. Two utterances
        # alternating a sentence at a time is fine; two utterances inside one
        # `phonemize_espeak` is the bug the lock exists for.
        chunks = voice.synthesize(text)
        while True:
            with _espeak_lock:
                try:
                    chunk = next(chunks)
                except StopIteration:
                    break
            pcm = chunk.audio_int16_bytes
            if not pcm:
                continue
            if first:
                logger.info(
                    "piper %s first chunk in %.0f ms (%d chars)",
                    normalise(language),
                    (time.perf_counter() - started) * 1000.0,
                    len(text),
                )
                first = False
            total += len(pcm)
            yield pcm
        if total == 0:
            # Nothing at all came back. The commonest cause is text in a script
            # the selected voice cannot phonemise, and it is worth a line here
            # because the alternative is a 200 with an empty body — which the
            # worker reads as a question that was spoken and heard.
            logger.error(
                "piper %s produced no audio for %d characters; "
                "is the text in this voice's script?",
                normalise(language),
                len(text),
            )
        logger.debug(
            "piper %s streamed %d bytes in %.2fs",
            normalise(language),
            total,
            time.perf_counter() - started,
        )
