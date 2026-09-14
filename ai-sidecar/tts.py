"""Questions read aloud.

Piper, with the voice files kept outside the repo in MEDIHIVE_VOICE_DIR. A
voice is ~60 MB of weights per language and belongs with the deployment, not
in git.

TTS is the one part of this service allowed to be simply absent. A patient who
cannot hear the question can still read it and tap the answer, so a missing
voice degrades the experience and never blocks a case. `available()` says so
honestly rather than raising at the first request.
"""

from __future__ import annotations

import io
import os
import threading
import wave
from pathlib import Path

_VOICE_DIR = Path(os.environ.get("MEDIHIVE_VOICE_DIR", "voices"))

# Language to voice filename. Only English is wired now; the other two are
# listed so that adding them in the language phase is a download, not a patch.
_VOICES = {
    "en": "en_US-lessac-medium.onnx",
    "ta": "ta_IN-unknown-medium.onnx",
    "hi": "hi_IN-pratham-medium.onnx",
}

_loaded: dict[str, object] = {}
_lock = threading.Lock()


def voice_path(language: str) -> Path:
    return _VOICE_DIR / _VOICES.get(language, _VOICES["en"])


def available(language: str = "en") -> bool:
    """Whether this language can actually be spoken right now."""
    try:
        import piper  # noqa: F401
    except Exception:
        return False
    return voice_path(language).exists()


def _get_voice(language: str):
    key = language if voice_path(language).exists() else "en"
    if key not in _loaded:
        with _lock:
            if key not in _loaded:
                from piper import PiperVoice

                _loaded[key] = PiperVoice.load(str(voice_path(key)))
    return _loaded[key]


def speak(text: str, language: str = "en") -> bytes:
    """One WAV, whole. Streaming would be better for a long summary; it is not
    better enough to justify a second transport before the first one works."""
    voice = _get_voice(language)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        voice.synthesize(text, wav)
    return buffer.getvalue()
