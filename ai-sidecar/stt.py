"""Patient speech into text.

faster-whisper, held on the **CPU** deliberately. The GPU has 4 GB and is
holding gemma3:4b; a transcription that takes two seconds instead of one costs
a patient nothing, whereas an interview that stalls because the model got
evicted costs them the thread of what they were saying.

The model size is an environment variable because the right answer differs by
deployment and by language, and the spec's own development strategy is to
benchmark rather than assume.

## The provider seam, and the language it exists for

There is one engine here and there is a small interface in front of it, which
is usually a smell. It is here for a specific, known gap: **faster-whisper
cannot hear Odia.** Whisper's tokenizer has exactly 100 languages and `or` is
not among them — checked against `faster_whisper.tokenizer._LANGUAGE_CODES`,
not assumed — while `tts/` can *speak* all eleven. So one of the languages this
service is configured for needs a different engine before it can be listened
to, and [STTProvider] is where that engine plugs in without the routes or the
Nest client changing.

Until then Odia is refused by name, with a sentence a patient can act on. The
two alternatives were both worse: passing `or` to Whisper raises deep in the
decoder and reaches the patient as a bare failure, and dropping the language
hint lets Whisper auto-detect, which returns *a* transcript — in Hindi or
Bengali, labelled Odia, at HTTP 200. A wrong-language transcript that confident
is a clinical record of something the patient did not say.
"""

from __future__ import annotations

import logging
import os
import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import ClassVar

# `tts.language_config` is the single source of truth for which languages this
# service is configured for, speech in and speech out alike. Importing it here
# rather than keeping a second list is the point of the file: two lists is how
# `/health` ended up claiming a language the voice table had never heard of.
from tts.language_config import SUPPORTED_LANGUAGES, get, normalise

logger = logging.getLogger(__name__)

# `small` is the floor that handles accented English reliably. Indian-language
# work wants `medium` and should be benchmarked before it is promised.
_MODEL_SIZE = os.environ.get("MEDIHIVE_STT_MODEL", "small")
_DEVICE = os.environ.get("MEDIHIVE_STT_DEVICE", "cpu")
_COMPUTE = os.environ.get("MEDIHIVE_STT_COMPUTE", "int8")

_model = None
_model_lock = threading.Lock()


class LanguageNotSupported(LookupError):
    """This service is configured for the language but cannot listen in it.

    Carries the sentence the patient is shown, because the alternative is the
    route inventing one from a status code. `main.py` answers 400 rather than
    500: the request is the problem, not the service, and a 5xx counts against
    the circuit breaker that STT and OCR share — one Odia request would edge
    document reading towards being switched off for everybody.
    """

    def __init__(self, language: str, patient_message: str) -> None:
        super().__init__(f"no speech recognition for language {language!r}")
        self.language = language
        self.patient_message = patient_message


def _get_model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                from faster_whisper import WhisperModel

                _model = WhisperModel(_MODEL_SIZE, device=_DEVICE, compute_type=_COMPUTE)
    return _model


@dataclass
class Segment:
    start: float
    end: float
    text: str
    confidence: float


class STTProvider(ABC):
    """One engine that can turn recorded speech into text.

    Deliberately the same shape as `tts.base.TTSProvider` — [supports] before
    [transcribe], a refusal rather than a substitution — because they are the
    same problem pointed in opposite directions and two seams that differ only
    in vocabulary are two seams somebody has to read twice.
    """

    id: ClassVar[str] = "base"

    @abstractmethod
    def available(self) -> bool:
        """Whether the runtime is installed at all. Must not load the model."""

    @abstractmethod
    def supports(self, language: str) -> bool:
        """Whether this engine can hear this language.

        `None` — let the engine detect — is asked about as the empty string and
        is a capability of the engine, not of a language.
        """

    @abstractmethod
    def transcribe(self, audio_path: str, language: str | None) -> dict:
        """One utterance, with the confidence the caller needs to distrust it."""


class WhisperSTT(STTProvider):
    id = "whisper"

    def available(self) -> bool:
        try:
            import faster_whisper  # noqa: F401

            return True
        except Exception:
            return False

    def _codes(self) -> frozenset[str] | None:
        """Whisper's own language list, or None if it cannot be read.

        Read from `faster_whisper.tokenizer._LANGUAGE_CODES` — a private name,
        used knowingly. It is the exact set the decoder validates against, and
        the only alternative is to paste 100 codes into this file, where they
        would be a second copy that drifts the first time faster-whisper adds a
        language. If a future version moves it, this answers None and the
        validation below stands down rather than refusing everything.
        """
        try:
            from faster_whisper.tokenizer import _LANGUAGE_CODES

            return frozenset(_LANGUAGE_CODES)
        except Exception:
            logger.warning("faster-whisper language list unreadable; not validating codes")
            return None

    def supports(self, language: str) -> bool:
        code = normalise(language)
        if not code:
            # Auto-detection. The right default for a patient who code-switches
            # mid-sentence — Tanglish is named in the spec as a case that must
            # survive — and something Whisper does for any language it knows.
            return True
        codes = self._codes()
        return True if codes is None else code in codes

    def transcribe(self, audio_path: str, language: str | None) -> dict:
        code = normalise(language) or None
        model = _get_model()
        segments, info = model.transcribe(
            audio_path,
            language=code,
            vad_filter=True,
            beam_size=5,
        )

        collected: list[Segment] = []
        for segment in segments:
            # Whisper reports average log-probability per token. Exponentiating
            # it gives a 0–1 number the rest of the system already speaks.
            import math

            collected.append(
                Segment(
                    start=float(segment.start),
                    end=float(segment.end),
                    text=segment.text.strip(),
                    confidence=float(math.exp(segment.avg_logprob)),
                )
            )

        text = " ".join(s.text for s in collected).strip()
        confidence = (
            sum(s.confidence for s in collected) / len(collected) if collected else 0.0
        )

        return {
            "text": text,
            "confidence": round(confidence, 4),
            "language": info.language,
            "languageConfidence": round(float(info.language_probability), 4),
            "durationMs": int(float(info.duration) * 1000),
            "segments": [
                {
                    "start": s.start,
                    "end": s.end,
                    "text": s.text,
                    "confidence": round(s.confidence, 4),
                }
                for s in collected
            ],
        }


# One engine today, in a list, so adding the one that covers Odia is an append
# rather than a rewrite of everything below it.
_providers: list[STTProvider] = [WhisperSTT()]


def providers() -> list[STTProvider]:
    return _providers


def provider_for(language: str | None) -> STTProvider | None:
    """The first installed engine that can hear this language, or None."""
    code = normalise(language)
    if code and code not in SUPPORTED_LANGUAGES:
        # An unconfigured code is refused before any engine is asked. Whisper
        # knows `fr`; this service does not offer it, and answering in it would
        # mean a case conducted in a language nothing else here handles.
        return None
    for provider in _providers:
        if provider.available() and provider.supports(code):
            return provider
    return None


def available() -> bool:
    """Whether speech recognition could run at all, without loading a model."""
    return any(provider.available() for provider in _providers)


def languages() -> list[str]:
    """Every configured language some engine can actually hear.

    Today: all of them except Odia. `/health` reports it so a caller can grey
    out the microphone for `or` instead of discovering it at the first tap.
    """
    return sorted(code for code in SUPPORTED_LANGUAGES if provider_for(code) is not None)


def transcribe(audio_path: str, language: str | None = None) -> dict:
    """One utterance, with the confidence the caller needs to distrust it.

    `language=None` lets Whisper detect, which is the right default for a
    patient who code-switches mid-sentence. A caller that knows the session
    language passes it and gets a better result — unless no engine here can
    hear that language, in which case it is told so rather than handed a
    fluent transcript of the wrong one.
    """
    provider = provider_for(language)
    if provider is None:
        entry = get(language)
        name = entry.english_name if entry else "that language"
        raise LanguageNotSupported(
            normalise(language),
            f"We cannot listen in {name} yet. Please type your answer.",
        )
    return provider.transcribe(audio_path, language)
