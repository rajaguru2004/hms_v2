"""What a text-to-speech provider is, and the two rules it may not break.

A provider is an engine plus its weights: Piper with an `.onnx` voice, IndicF5
with a reference recording. They have nothing in common at the Python level —
different runtimes, different sample rates, different ideas of what a "voice"
is — so this file states the small contract the rest of the service is written
against and leaves the engines alone.

## Rule one: say no

[TTSProvider.supports] exists so a provider can decline a language *before*
anything is loaded and before a single sample is generated. A provider that
cannot do Tamil must answer False for Tamil, and [TTSProvider.synthesize] must
raise [UnsupportedLanguage] if it is called anyway. It must never fall back to
a language it does have.

This is not a style preference. The version of this code that fell back to
English on an unrecognised code read a Tamil question aloud, in English, at
HTTP 200, with nothing in the logs to say it had happened — and a patient has
no way to tell a wrong-language question from their own hearing. Silence is a
degradation somebody can act on. Confident nonsense is not.

## Rule two: hand back a finished WAV

[TTSProvider.synthesize] returns the complete bytes of a RIFF/WAVE file,
header included, because the HTTP layer stamps `audio/wav` on whatever it is
given and the Flutter player is handed bytes rather than a URL (see
`speech_player.dart`). Raw PCM would reach the phone as a file it cannot open.
[wav_bytes] is here so no provider has to get the header right twice.
"""

from __future__ import annotations

import io
import logging
import os
import wave
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, ClassVar

from .language_config import SUPPORTED_LANGUAGES, normalise

logger = logging.getLogger(__name__)


class UnsupportedLanguage(LookupError):
    """A provider was asked for a language it cannot do.

    A `LookupError` rather than a `ValueError` because that is what the caller
    it replaces raised, and because it is genuinely a miss in a table. The
    routes turn it into a written sentence and a 503 — see `main.py`.
    """

    def __init__(self, provider: str, language: str) -> None:
        super().__init__(f"{provider} has no voice for language {language!r}")
        self.provider = provider
        self.language = language


class TTSProvider(ABC):
    """One engine that can turn text into a WAV for some set of languages."""

    id: ClassVar[str] = "base"
    """Matches the ids in `language_config` and in config.yaml's provider order."""

    @abstractmethod
    def supports(self, language: str) -> bool:
        """Whether this provider can speak this language **right now**.

        Right now, not in principle: the weights have to be on disk and the
        runtime has to import. Called on every `/health` and before every
        `/tts`, so it must be cheap and must not load a model.
        """

    @abstractmethod
    def synthesize(self, text: str, language: str) -> bytes:
        """One complete WAV, whole.

        Raises [UnsupportedLanguage] when [supports] would have said no. It is
        the second lock on the same door: the chain checks first, and this
        catches the caller that did not.
        """

    def languages(self) -> list[str]:
        """Every configured language this provider can speak right now."""
        return sorted(code for code in SUPPORTED_LANGUAGES if self.supports(code))

    def status(self) -> dict[str, Any]:
        """What `/health` says about this provider.

        `detail` is for the engineer reading a health check at 2am — "torch is
        not installed" is a different morning's work from "no reference audio
        for ta". Neither is ever shown to a patient.
        """
        return {"id": self.id, "ready": bool(self.languages()), "detail": "", "languages": self.languages()}


def wav_bytes(samples: Any, sample_rate: int) -> bytes:
    """16-bit mono PCM in a RIFF container, from whatever the model handed over.

    Models are inconsistent about amplitude in a way that is silent until you
    listen: IndicF5's own README shows its output arriving both as `int16` and
    as float, and the float path is sometimes already scaled to the int16 range
    rather than to ±1. Dividing by 32768 unconditionally gives audio 90 dB down
    — which plays as silence and reads as "TTS is broken" — and not dividing at
    all gives clipping on every sample. The peak decides, because it is the one
    thing that distinguishes the two cases.
    """
    import numpy as np

    array = np.asarray(samples)
    if array.dtype == np.int16:
        pcm = array
    else:
        array = array.astype(np.float32)
        peak = float(np.max(np.abs(array))) if array.size else 0.0
        if peak > 1.5:
            # Floats in the int16 range, not in ±1. See above.
            array = array / 32768.0
        # Clipping rather than normalising: a loud sample is the model's
        # decision and rescaling the whole utterance to fit it would change the
        # volume of every question the patient hears.
        pcm = (np.clip(array, -1.0, 1.0) * 32767.0).astype(np.int16)

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(sample_rate)
        out.writeframes(pcm.reshape(-1).tobytes())
    return buffer.getvalue()


def resolve_dir(relative: str, package_dir: Path, env_var: str | None = None) -> Path:
    """A directory from config, resolved against the package rather than the CWD.

    config.yaml holds relative paths only, on purpose: an absolute path in a
    committed file is right on exactly one machine, and this service runs from
    a venv on Windows, from `run.sh` on the demo box and from `/app` in a
    container. Relative to the *package* rather than to the process's working
    directory, because uvicorn is started from wherever the operator happened
    to be standing.

    The environment variable wins when it is set, which is how the deployment
    keeps ~123 MB of weights outside the tree — `MEDIHIVE_VOICE_DIR` already
    does this in run.sh, run.ps1 and docker-compose.demo.yml, so it keeps
    working exactly as it did.
    """
    if env_var:
        override = os.environ.get(env_var, "").strip()
        if override:
            return Path(override)
    return (package_dir / relative).resolve()


def rss_mb() -> float | None:
    """Resident set size of this process, in MB, or None if it cannot be read.

    Logged around every model load and every synthesis because the failure this
    service actually had was a memory one: a cache keyed on the request string
    loaded a fresh ~63 MB copy of the same voice for every spelling of a
    language, and seven ordinary `/tts` calls killed the process. A number in
    the log is what turns "it died again" into "it grew 63 MB per call".

    psutil is not a dependency and will not be added for one number, so this
    goes to the platform and gives up quietly if it cannot get there.
    """
    try:
        import psutil  # type: ignore[import-not-found]

        return psutil.Process().memory_info().rss / (1024 * 1024)
    except Exception:
        pass

    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes

            class _Counters(ctypes.Structure):
                _fields_ = [
                    ("cb", wintypes.DWORD),
                    ("PageFaultCount", wintypes.DWORD),
                    ("PeakWorkingSetSize", ctypes.c_size_t),
                    ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                    ("PagefileUsage", ctypes.c_size_t),
                    ("PeakPagefileUsage", ctypes.c_size_t),
                ]

            counters = _Counters()
            counters.cb = ctypes.sizeof(_Counters)
            handle = ctypes.windll.kernel32.GetCurrentProcess()
            if ctypes.windll.psapi.GetProcessMemoryInfo(
                handle, ctypes.byref(counters), counters.cb
            ):
                return counters.WorkingSetSize / (1024 * 1024)
        except Exception:
            return None
        return None

    try:
        import resource

        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # Linux reports kilobytes, macOS bytes. A process over a gigabyte of
        # "kilobytes" is macOS, which is a more reliable tell than a platform
        # check that has to be kept in step with the platforms.
        return peak / (1024 * 1024) if peak > 1024 * 1024 else peak / 1024
    except Exception:
        return None


def log_synthesis(provider: str, language: str, text: str, seconds: float, audio: bytes) -> None:
    """One line per utterance, in the shape every provider logs it.

    Latency and RSS together, because on this box they are the same question:
    it has 4 GB of VRAM that Ollama is holding and not much more system memory
    to spare, and a synthesis that got slower is usually one that started
    swapping.
    """
    rss = rss_mb()
    logger.info(
        "tts %s lang=%s chars=%d %.2fs %.0fkB rss=%s",
        provider,
        normalise(language),
        len(text),
        seconds,
        len(audio) / 1024,
        f"{rss:.0f}MB" if rss is not None else "?",
    )


def read_reference_text(path: Path) -> str:
    """The reference transcript, trimmed. Raises ValueError if there is none.

    Raising rather than returning "": a transcript that is missing, empty, or
    not decodable is a half-supplied language, and the caller has to be able to
    say *which* so the load log names the reason. A pair whose `.txt` is empty
    makes the model condition on no text at all, which does not fail — it
    drifts, fluently, sometimes into another language.

    ## The BOM

    Decoded as `utf-8-sig`, so a byte-order mark is consumed rather than
    becoming `U+FEFF` glued to the front of the first word. Three invisible
    bytes at the head of a file are how a transcript silently stops matching
    its audio: the model conditions on a first token nobody wrote. Editors on
    Windows add them without asking — Windows PowerShell 5.1's `-Encoding utf8`
    writes one — so this strips it and says so, rather than trusting eleven
    files to have been saved carefully.
    """
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        raise ValueError(f"{path.name} is missing")
    except OSError as error:
        raise ValueError(f"{path.name} cannot be read ({error.strerror})")

    if raw.startswith(b"\xef\xbb\xbf"):
        logger.warning(
            "%s starts with a UTF-8 BOM; stripping it. Save it as UTF-8 without BOM.",
            path,
        )
    try:
        text = raw.decode("utf-8-sig").strip()
    except UnicodeDecodeError:
        # Almost always a file saved as UTF-16 or as a Windows code page, which
        # would otherwise reach the model as mojibake in the right script's
        # place — unreadable to the model and invisible in a diff.
        raise ValueError(f"{path.name} is not valid UTF-8")

    if not text:
        raise ValueError(f"{path.name} is empty")
    return text


def probe_wav(path: Path) -> dict[str, Any]:
    """Channels, sample rate and duration of a WAV. Raises ValueError if not one.

    Read with the standard library rather than by trusting the extension,
    because the thing that actually turns up in a voice directory is an MP3 or
    an m4a that somebody renamed. That file would import fine and fail at the
    first patient request, deep inside the model's own loader, as a 500. Here
    it is a refusal at load with a sentence saying what is wrong with it.
    """
    try:
        with wave.open(str(path), "rb") as source:
            channels = source.getnchannels()
            width = source.getsampwidth()
            rate = source.getframerate()
            frames = source.getnframes()
    except FileNotFoundError:
        raise ValueError(f"{path.name} is missing")
    except (wave.Error, EOFError, OSError) as error:
        raise ValueError(f"{path.name} is not a readable WAV ({error})")

    if width != 2:
        # 16-bit is what the model's loader and every reference in the IndicF5
        # examples use. A 24-bit file is a real WAV that produces wrong audio
        # rather than an error, which is the worst of both.
        raise ValueError(f"{path.name} is {width * 8}-bit; 16-bit PCM is required")
    if frames == 0:
        raise ValueError(f"{path.name} contains no audio")

    return {
        "channels": channels,
        "sampleRate": rate,
        "seconds": frames / float(rate or 1),
    }


__all__ = [
    "TTSProvider",
    "UnsupportedLanguage",
    "wav_bytes",
    "resolve_dir",
    "rss_mb",
    "log_synthesis",
    "read_reference_text",
    "probe_wav",
]
