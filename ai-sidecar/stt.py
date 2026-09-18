"""Patient speech into text.

faster-whisper, on the **GPU** where there is one. This file used to say the
opposite, and the reason it gave — "the GPU has 4 GB and is holding gemma3:4b"
— stopped being true when the interview moved to answering in English and
Ollama became a background translation step off the response path. The GPU was
measured idle (896 MiB of 4096 in use, all of it Windows shell processes), so
the benchmark below was run rather than the assumption kept.

## The measurement that set these defaults

Same eight clips through both, Piper-synthesised via this service's own /tts,
resampled to the 16 kHz mono the worker actually POSTs. Median warm decode,
"audio bytes in hand" to "final transcript" — the whole span /stt covers:

                                    1 s clip   3 s clip   8 s clip   mean RTF
    small / cpu  / int8  / beam 5      2.97 s     3.67 s     4.32 s      1.88   <- was
    small / cuda / int8_float16 / b1   0.21 s     0.30 s     0.40 s      0.16   <- is

Moving to CUDA changed no transcript for the worse: six of the eight clips are
character-identical to the CPU baseline, the Hindi negation is *better* on the
GPU ("लेकिन" where the CPU heard "लेकें"), and the eighth differs only in the
spelling of one Hindi word that neither gets right. Measured end to end
through the live `/stt`, a one-second answer went 2.2-3.0 s -> 0.26 s.

**14x on the case that matters.** Short answers dominate a clinical interview
— "three days", "yes", "the left side" — and those are the answers a fast
model helps least with on a CPU, because Whisper pads every input to 30
seconds before the encoder runs. A one-second answer therefore costs about
*half* an eight-second one rather than an eighth of it: the encoder pass is
fixed and only the decoder scales with what was actually said. That fixed pass
is one large matmul, which is exactly what a GPU is for, and it is why the 1 s
column improves by as much as the 8 s column rather than less.

(`vad_filter` is what keeps this from being a floor on *every* request:
silence is dropped before the encoder, so a fixture of 0.2 s of nothing
returns in 51 ms without a decode at all.)

`beam_size` was 5 and is now 1: 0.31 s -> 0.21 s on GPU, for transcripts that
were character-identical on **seven of the eight clips**. The eighth is the
7-second Hindi one, where beam 5 spells one word closer to the reference
(`सीडिया चरते` against `सीड़ हीजा चरते`) and both are wrong in the same place.
Beam search is buying a spelling on the longest utterance and costing a third
of the decode on every short one, which is the wrong trade for an interview
made of short answers.

## Why `small` and not something smaller, and not something larger

`base` and `tiny` are 2-3x faster again and are *not usable*, for a reason no
speed table shows. In English they are indistinguishable from `small` — all
three return "There is no chest pain, but the headache is on the left side."
exactly. In Hindi they fall apart, and they fall apart quietly:

    reference  मुझे तीन दिन से बुखार और खांसी है।
    small      मुझे 3 दिन से बुखार और खासी है          ok
    base       مجھے تین دین سے بکھار اور کھسی ہے       Urdu script
    tiny       Mohjhe 3 daysа bookar and khasi hai.   romanised

and on "तीन दिन" — three days — `base` answers `10 DINN` and `tiny` answers
`10.`. A wrong *number* on symptom duration, returned at HTTP 200 with no
signal that anything went wrong, is the same failure this file already refuses
Odia to avoid. `base` and `tiny` are therefore not options at any speed.

`large-v3-turbo` is the other direction and is genuinely better at Hindi
(0.94 vs 0.90 similarity to reference; it alone reads "तीन दिन" as words and
not as a digit). It costs 0.61 s instead of 0.21 s and **1173 MB of VRAM
instead of 398 MB**, and that second number is what decides it: gemma3:4b is
3.3 GB on a 4 GB card and already cannot fully offload. Leaving it 2.6 GB
rather than 1.9 GB is worth more than the spelling of "खांसी". A deployment
with a larger card should set `MEDIHIVE_STT_MODEL=large-v3-turbo` and take it.

## Why there is one model and not two

The worker re-decodes everything-said-so-far every 1.4 s to draw interim
transcripts, so a tempting split is `tiny` for interims and `small` for the
final — the interim is a display artifact and never becomes a clinical fact,
so a cheaper model there looks free. It was measured and it is not worth it:

  * An interim on this configuration costs 0.21-0.30 s against a 1.4 s
    cadence with one decode in flight at a time. That is about a fifth of the
    GPU, and the thing a split would relieve is not under pressure.
  * It buys ~0.13 s per interim, on the one output in this service that
    nothing reads back.
  * And it would show Hindi speakers their own words in Urdu script or as
    `Mohjhe 3 daysа bookar and khasi hai.` while they are still talking,
    because that is what `tiny` and `base` return for Hindi.

A second resident model is ~179 MB more VRAM and a second failure mode, to
make a display artifact that is already fast slightly faster and, in half the
languages this service offers, visibly wrong. If interims ever do become the
bottleneck, `MEDIHIVE_INTERIM_TRANSCRIPTS=0` in the worker is the cheaper
lever and it already exists.

Every one of these is an environment variable because the right answer differs
by deployment and by language, and the strategy is to benchmark rather than
assume — which is what the table above is.

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
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import ClassVar

# `tts.language_config` is the single source of truth for which languages this
# service is configured for, speech in and speech out alike. Importing it here
# rather than keeping a second list is the point of the file: two lists is how
# `/health` ended up claiming a language the voice table had never heard of.
from tts.language_config import SUPPORTED_LANGUAGES, get, normalise

logger = logging.getLogger(__name__)

# `small` is the floor that handles accented English reliably AND the floor
# that answers Hindi in Devanagari at all — see the docstring. Below it the
# speed is free and the transcript is wrong.
_MODEL_SIZE = os.environ.get("MEDIHIVE_STT_MODEL", "small")

# `auto` means "the GPU if it can actually run, the CPU otherwise", resolved
# once at first load and logged. An explicit `cpu` or `cuda` is obeyed.
_DEVICE_REQUESTED = os.environ.get("MEDIHIVE_STT_DEVICE", "auto").strip().lower()
_COMPUTE_REQUESTED = os.environ.get("MEDIHIVE_STT_COMPUTE", "auto").strip().lower()


def _flag(name: str, default: str) -> bool:
    return os.environ.get(name, default).strip().lower() not in ("0", "false", "no", "off")


# 1, not 5. Measured: a third of the GPU decode, for transcripts that were
# character-identical on all eight benchmark clips in both languages.
_BEAM = max(1, int(os.environ.get("MEDIHIVE_STT_BEAM", "1") or 1))

# Silero, in front of the decoder. Kept ON. Turning it off is worth about
# 30 ms (0.21 s -> 0.20 s) and removes the thing that stops Whisper inventing
# a sentence out of the VAD's silent prefix padding — the classic "Thank you."
# hallucination. Thirty milliseconds is not worth a fabricated clinical fact.
_VAD = _flag("MEDIHIVE_STT_VAD", "1")

# OFF, and it is not the lever it looks like: a clinical utterance is under 30
# seconds, so there is only ever one decode window for this to condition
# across, and it measured 0.20 s vs 0.21 s. It is off because when it does
# engage — on a long recording — it is the setting that lets one bad segment
# seed a repeating hallucination through the rest of the audio.
_CONDITION = _flag("MEDIHIVE_STT_CONDITION", "0")

# Load the model at startup rather than on the first patient's first answer.
# Cold is model load plus a first decode that is itself ~0.9 s slower than
# warm: 4.66 s + 1.14 s on CUDA, against 0.21 s once warm. Without this the
# first question of every interview pays ~5.8 s.
_PREWARM = _flag("MEDIHIVE_STT_PREWARM", "1")

_model = None
_model_lock = threading.Lock()
# Resolved at first load, reported by /health so an operator can tell whether
# this box is actually on the GPU or silently fell back.
_resolved: dict[str, object] = {"device": None, "compute": None, "detail": ""}


def _preload_cuda_libs() -> list[str]:
    """Make the pip-wheel CUDA DLLs loadable by ctranslate2 (Windows only).

    ctranslate2 delay-loads `cublas64_12.dll` by **bare name**, and a bare-name
    LoadLibrary does not consult `os.add_dll_directory`. The wheel unpacks to
    `site-packages/nvidia/cublas/bin`, which is on no search path at all, so
    the GPU loads the model fine and then dies at the first GEMM with

        RuntimeError: Library cublas64_12.dll is not found or cannot be loaded

    Loading each DLL here by full path puts the module in the process, and the
    later bare-name resolution matches it. `cublasLt` must precede `cublas`,
    which links against it. This is the same trick ctranslate2's own
    `__init__` uses for the DLLs it ships beside itself.
    """
    if os.name != "nt":
        # Linux wheels drop .so files that ctranslate2 finds via RPATH/ldconfig.
        return []
    import ctypes
    import glob
    import site

    loaded: list[str] = []
    roots = [p for p in (list(site.getsitepackages()) + [site.getusersitepackages()]) if p]
    for root in roots:
        for directory in sorted(glob.glob(os.path.join(root, "nvidia", "*", "bin"))):
            try:
                os.add_dll_directory(directory)
            except OSError:
                pass
            for name in ("cublasLt64_12.dll", "cublas64_12.dll"):
                path = os.path.join(directory, name)
                if not os.path.exists(path):
                    continue
                try:
                    ctypes.CDLL(path)
                    loaded.append(name)
                except OSError as exc:
                    logger.warning("CUDA library %s present but not loadable: %s", name, exc)
    return loaded


def _cuda_usable() -> tuple[bool, str]:
    """Whether ctranslate2 can *run* on a GPU, not merely see one.

    Both halves matter. `get_cuda_device_count()` answers 1 on this box with no
    cuBLAS installed at all, and the model then loads successfully and fails at
    the first encode — i.e. mid-interview, not at startup. So the libraries are
    probed here too, while falling back is still free.
    """
    try:
        import ctranslate2
    except Exception as exc:  # pragma: no cover - ctranslate2 is a hard dep
        return False, f"ctranslate2 did not import: {exc}"
    try:
        if ctranslate2.get_cuda_device_count() < 1:
            return False, "no CUDA device visible to ctranslate2"
    except Exception as exc:
        return False, f"CUDA device count unavailable: {exc}"
    if os.name == "nt" and "cublas64_12.dll" not in _preload_cuda_libs():
        return False, (
            "CUDA device present but cublas64_12.dll is not loadable; "
            "install it with: pip install --no-deps nvidia-cublas-cu12"
        )
    return True, ""


def _resolve_device() -> tuple[str, str, str]:
    """(device, compute_type, detail) for this box, decided once."""
    requested = _DEVICE_REQUESTED
    if requested == "cpu":
        compute = "int8" if _COMPUTE_REQUESTED == "auto" else _COMPUTE_REQUESTED
        return "cpu", compute, "cpu requested"

    usable, why = _cuda_usable()
    if usable:
        # int8_float16 over float16: measured faster (0.21 s vs 0.23 s) on
        # nearly half the VRAM (398 MB vs 722 MB), with identical transcripts.
        compute = "int8_float16" if _COMPUTE_REQUESTED == "auto" else _COMPUTE_REQUESTED
        return "cuda", compute, "cuda"

    compute = "int8" if _COMPUTE_REQUESTED == "auto" else _COMPUTE_REQUESTED
    if requested == "cuda":
        # Explicitly asked for, and not available. Falling back rather than
        # refusing to start, because a sidecar that boots and transcribes
        # slowly is a working interview and a sidecar that does not boot is
        # not — but at ERROR, because somebody configured this on purpose.
        logger.error("MEDIHIVE_STT_DEVICE=cuda but CUDA is unusable (%s); falling back to CPU", why)
        return "cpu", compute, f"cuda requested but unusable: {why}"
    logger.info("speech recognition on CPU: %s", why)
    return "cpu", compute, why


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

                device, compute, detail = _resolve_device()
                started = time.perf_counter()
                try:
                    model = WhisperModel(_MODEL_SIZE, device=device, compute_type=compute)
                except Exception as exc:
                    if device != "cuda":
                        raise
                    # The probe passed and the load still failed — a driver
                    # mismatch, or something else took the last of the VRAM.
                    # One retry on the CPU, for the same reason as above.
                    logger.error(
                        "%s failed to load on CUDA (%s); retrying on CPU", _MODEL_SIZE, exc
                    )
                    device, compute, detail = "cpu", "int8", f"cuda load failed: {exc}"
                    model = WhisperModel(_MODEL_SIZE, device=device, compute_type=compute)
                _resolved.update(
                    device=device, compute=compute, detail=detail, model=_MODEL_SIZE
                )
                logger.info(
                    "speech recognition ready: %s on %s/%s, beam=%d vad=%s in %.2fs",
                    _MODEL_SIZE, device, compute, _BEAM, _VAD, time.perf_counter() - started,
                )
                _model = model
    return _model


def describe() -> dict:
    """What actually resolved, for `/health`.

    Reported because the fallbacks above are silent by design: an operator who
    set `MEDIHIVE_STT_DEVICE=cuda` and got CPU needs somewhere to see that
    other than a log line from an hour ago.
    """
    return {
        "model": _MODEL_SIZE,
        "device": _resolved["device"] or f"{_DEVICE_REQUESTED} (not loaded yet)",
        "compute": _resolved["compute"] or f"{_COMPUTE_REQUESTED} (not loaded yet)",
        "beamSize": _BEAM,
        "vadFilter": _VAD,
        "conditionOnPreviousText": _CONDITION,
        "loaded": _model is not None,
        "detail": _resolved["detail"],
    }


def warm() -> None:
    """Load the model, and pay the first-decode cost, before a patient does.

    The first decode in a process is ~0.9 s slower than every one after it on
    CUDA — kernels are compiled and workspaces allocated on demand. Loading
    without decoding would move only half the cost off the first answer, so
    this runs one second of silence through the whole path.
    """
    try:
        import numpy as np

        model = _get_model()
        segments, _ = model.transcribe(
            np.zeros(16000, dtype=np.float32),
            language="en",
            beam_size=_BEAM,
            vad_filter=_VAD,
            condition_on_previous_text=_CONDITION,
        )
        for _ in segments:  # the generator is where the work happens
            pass
    except Exception as exc:
        # Never fatal. A sidecar that cannot prewarm still transcribes; it just
        # pays the cost on the first request, which is the old behaviour.
        logger.warning("speech recognition prewarm failed: %s", exc)


def prewarm_enabled() -> bool:
    return _PREWARM


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
            vad_filter=_VAD,
            beam_size=_BEAM,
            condition_on_previous_text=_CONDITION,
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
