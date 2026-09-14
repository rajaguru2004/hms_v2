"""Patient speech into text.

faster-whisper, held on the **CPU** deliberately. The GPU has 4 GB and is
holding gemma3:4b; a transcription that takes two seconds instead of one costs
a patient nothing, whereas an interview that stalls because the model got
evicted costs them the thread of what they were saying.

The model size is an environment variable because the right answer differs by
deployment and by language, and the spec's own development strategy is to
benchmark rather than assume.
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass

# `small` is the floor that handles accented English reliably. Indian-language
# work wants `medium` and should be benchmarked before it is promised.
_MODEL_SIZE = os.environ.get("MEDIHIVE_STT_MODEL", "small")
_DEVICE = os.environ.get("MEDIHIVE_STT_DEVICE", "cpu")
_COMPUTE = os.environ.get("MEDIHIVE_STT_COMPUTE", "int8")

_model = None
_model_lock = threading.Lock()


def _get_model():
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                from faster_whisper import WhisperModel

                _model = WhisperModel(_MODEL_SIZE, device=_DEVICE, compute_type=_COMPUTE)
    return _model


def available() -> bool:
    try:
        import faster_whisper  # noqa: F401

        return True
    except Exception:
        return False


@dataclass
class Segment:
    start: float
    end: float
    text: str
    confidence: float


def transcribe(audio_path: str, language: str | None = None) -> dict:
    """One utterance, with the confidence the caller needs to distrust it.

    `language=None` lets Whisper detect, which is the right default for a
    patient who code-switches mid-sentence — Tanglish is named in the spec as a
    case that must survive. A caller that knows the session language passes it
    and gets a better result.
    """
    model = _get_model()
    segments, info = model.transcribe(
        audio_path,
        language=language,
        vad_filter=True,
        beam_size=5,
    )

    collected: list[Segment] = []
    for segment in segments:
        # Whisper reports average log-probability per token. Exponentiating it
        # gives a 0–1 number the rest of the system already speaks.
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
