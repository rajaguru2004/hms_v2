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

## The streaming half, and why it is a second method rather than a replacement

[TTSProvider.synthesize_stream] yields raw 16-bit mono PCM in pieces, with no
container at all, for the one caller that wants audio *before* the sentence has
finished synthesising: the LiveKit worker, which pushes each piece into the room
as it arrives. It is deliberately not the only method:

  * The phone still wants a file. `speech_player.dart` is handed bytes and hands
    them to a decoder; a chunked PCM body would reach it as something it cannot
    open. `/tts` therefore keeps returning a whole WAV and keeps calling
    [TTSProvider.synthesize].
  * The sample rate has to be knowable *before* the first chunk, because the
    HTTP layer puts it in a response header and the worker builds its
    `rtc.AudioFrame`s from it. That is [TTSProvider.sample_rate], and it must
    answer without loading anything heavy.

The default [TTSProvider.synthesize_stream] is the honest fallback for an engine
with no streaming API of its own: split the text into sentences, synthesise each
one whole, strip its header and yield the samples. That is not true streaming —
the first chunk still costs one whole sentence — but it is bounded by a sentence
rather than by a paragraph, it starts playback while the rest is still being
generated, and the interface is already the right shape for the day an engine
grows a real token-by-token API. IndicF5 uses exactly this; Piper overrides it
because `PiperVoice.synthesize` is genuinely a generator.
"""

from __future__ import annotations

import io
import logging
import os
import re
import wave
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, ClassVar, Iterator

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

    def sample_rate(self, language: str) -> int:
        """The rate [synthesize_stream] will emit for this language.

        Answered *before* anything is synthesised, because the HTTP layer sends
        it as a header and the worker builds every `rtc.AudioFrame` from it. A
        provider whose rate is a property of a voice file on disk has to be able
        to read it without generating audio; one whose rate is fixed just states
        it. Getting this wrong is not a failure, it is a pitch shift — the
        samples play back at the wrong speed and nothing raises.
        """
        raise NotImplementedError

    def synthesize_stream(self, text: str, language: str) -> Iterator[bytes]:
        """Raw 16-bit mono PCM at [sample_rate], in pieces, as it is made.

        The default is sentence-at-a-time via [synthesize]. See the note at the
        top of this file for why that counts as streaming for our purposes and
        where it stops counting.

        Chunks are whatever size the engine produced; the worker re-frames them
        to 20 ms before they reach LiveKit, so a provider must not try to hit a
        frame boundary. It must, however, yield **whole samples** — a chunk with
        an odd byte count splits an int16 down the middle, and every sample
        after it in the stream is noise.
        """
        for sentence in split_sentences(text):
            yield pcm_from_wav(self.synthesize(sentence, language))

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


def pcm_from_wav(data: bytes) -> bytes:
    """The sample bytes out of a RIFF/WAVE body, mono 16-bit, header discarded.

    Used by the default [TTSProvider.synthesize_stream] to un-wrap what an
    engine that only knows how to make files just made. The width and channel
    handling mirrors `voice-agent/audio.py:wav_to_frames` rather than assuming
    every engine emits mono int16, because the two are the same conversion at
    opposite ends of the same wire and a disagreement between them is audible.
    """
    if not data:
        return b""

    import numpy as np

    with wave.open(io.BytesIO(data), "rb") as handle:
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        raw = handle.readframes(handle.getnframes())

    if width == 2:
        samples = np.frombuffer(raw, dtype=np.int16)
    elif width == 4:
        samples = (np.frombuffer(raw, dtype=np.int32) >> 16).astype(np.int16)
    elif width == 1:
        samples = ((np.frombuffer(raw, dtype=np.uint8).astype(np.int16) - 128) << 8).astype(
            np.int16
        )
    else:
        raise ValueError(f"unsupported WAV sample width: {width} bytes")

    if channels > 1:
        samples = (
            samples.reshape(-1, channels).astype(np.int32).mean(axis=1).astype(np.int16)
        )
    return samples.tobytes()


# Sentence-ending punctuation for every script this service speaks: the Latin
# stops, the Devanagari danda and double danda (Hindi, Marathi), and the
# fullwidth stop that turns up in text pasted from an IME. Tamil, Telugu,
# Kannada, Malayalam, Bengali, Gujarati, Punjabi, Assamese and Odia all use the
# Latin full stop or the danda, so there is nothing further to add for them.
_SENTENCE_END = re.compile(r"(?<=[.!?।॥。？！])\s+")

# A ceiling, not a target. A "sentence" with no terminal punctuation — which is
# most of what a 4B model streams before it reaches one — must still become
# audio at some point, and 240 characters is roughly ten seconds of speech: long
# enough that a real clinical question is never cut in half, short enough that a
# runaway generation cannot hold the first audio chunk hostage.
_LONGEST_CHUNK = 240


def split_sentences(text: str, *, max_chars: int = _LONGEST_CHUNK) -> list[str]:
    """Text into synthesisable pieces, at sentence boundaries where there are any.

    The pieces are the streaming granularity: each one is a separate call into
    the engine and a separate chunk on the wire, so this is the knob that trades
    time-to-first-audio against how stilted the result sounds. Every seam is a
    join between two independently generated pieces, and most engines pad both
    ends of what they make with a little silence.
    """
    text = " ".join((text or "").split())
    if not text:
        return []

    pieces: list[str] = []
    current = ""
    for sentence in _SENTENCE_END.split(text):
        if not sentence:
            continue
        if current and len(current) + 1 + len(sentence) > max_chars:
            pieces.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        pieces.append(current)

    out: list[str] = []
    for piece in pieces:
        while len(piece) > max_chars:
            # At a word boundary. Breaking mid-word gives the engine half a word
            # to phonemise, and it will confidently pronounce the half.
            cut = piece.rfind(" ", 0, max_chars)
            cut = cut if cut > 0 else max_chars
            out.append(piece[:cut].strip())
            piece = piece[cut:].strip()
        if piece:
            out.append(piece)
    return out


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
    "pcm_from_wav",
    "split_sentences",
    "wav_bytes",
    "resolve_dir",
    "rss_mb",
    "log_synthesis",
    "read_reference_text",
    "probe_wav",
]
