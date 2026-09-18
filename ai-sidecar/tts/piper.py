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

from .base import TTSProvider, UnsupportedLanguage, log_synthesis, rss_mb
from .language_config import normalise

logger = logging.getLogger(__name__)

# Module level rather than per-instance, because what it is protecting is a
# process-wide resource: one file's weights, loaded once, shared by whatever
# asks for them. An instance-level cache would reload on every reconfiguration.
_loaded: dict[str, object] = {}
_lock = threading.Lock()


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
        with wave.open(buffer, "wb") as wav:
            # `synthesize_wav`, not `synthesize`: the latter is a per-sentence
            # chunk generator and leaves the WAV header unwritten, which
            # surfaces later as `wave.Error: # channels not specified` rather
            # than as a bad call. `set_wav_format` lets the voice declare its
            # own rate and width — 22050 Hz for the medium voices on disk.
            voice.synthesize_wav(text, wav, set_wav_format=True)
        audio = buffer.getvalue()
        log_synthesis(self.id, language, text, time.perf_counter() - started, audio)
        return audio
