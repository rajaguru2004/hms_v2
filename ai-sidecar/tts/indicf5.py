"""IndicF5 — eleven Indian languages from one model and a few seconds of audio.

AI4Bharat's IndicF5 is a flow-matching TTS trained on Assamese, Bengali,
Gujarati, Hindi, Kannada, Malayalam, Marathi, Odia, Punjabi, Tamil and Telugu.
It is the reason this package exists: Piper publishes voices for two of those
eleven, and the alternative to one model that covers them all was nine
languages a patient simply could not be spoken to in.

It is prompt-based rather than voice-per-language. Each language needs a
*reference pair* — a few seconds of `reference.wav` and exactly what is said in
it in `reference.txt` — and the model speaks the new text in that voice, in
that language. `voices/<code>/` holds those pairs and `voices/README.md` is the
contract for what a valid one is.

## Why this module imports with no torch installed

`import tts` runs at service start, and this file is imported with it. IndicF5
brings torch and transformers, which is a multi-gigabyte install that is being
done separately and may not have finished — or may never happen on a box that
only needs English. Every heavy import in here is therefore **inside a
function**, and [IndicF5TTS.supports] answers False when the runtime is absent
instead of raising. The chain then falls through to Piper and English keeps
working, which is the behaviour a running phone depends on.

`importlib.util.find_spec` is what does the checking: it looks for the module
without executing it, so `/health` stays cheap and does not drag half a
gigabyte of torch into memory just to answer a boolean.

## Why a reference pair is validated rather than trusted

A language whose pair is half-supplied — a WAV that is really an MP3, a
transcript saved as UTF-16, a `.txt` with nothing in it — must fail at load,
loudly, naming the file. The failure it would otherwise have is a 500 from
inside the model's own loader on the first patient request, or, worse, no
failure at all: the model conditions on both the audio and the text, and a
transcript that disagrees with its recording does not raise, it drifts.

And when a pair is absent, this provider declines the language. It never
reaches for another language's reference. That would produce a real human voice
speaking fluently in the wrong language at HTTP 200 — strictly worse than the
bug this package was written to fix, because a patient can hear that an English
voice is not Tamil and cannot hear that fluent Bengali was meant to be Odia.

## Why the model is loaded once, behind a lock

It is roughly a gigabyte resident. Loading it per request is what killed this
service once already, in its Piper incarnation, at a sixteenth of the size.
One instance serves all eleven languages — the language comes from the
reference pair, not from the weights — so the cache is keyed on the resolved
model and device rather than on anything the caller sent.
"""

from __future__ import annotations

import importlib.util
import logging
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from .base import (
    TTSProvider,
    UnsupportedLanguage,
    log_synthesis,
    pcm_from_wav,
    probe_wav,
    read_reference_text,
    rss_mb,
    split_sentences,
    wav_bytes,
)
from .language_config import INDICF5, SUPPORTED_LANGUAGES, get, normalise

logger = logging.getLogger(__name__)

# Keyed on `<model_id>@<device>` — the resolved artefact, the same rule
# `piper.py` follows for voice files. Two configurations pointing at the same
# weights on the same device share one copy; a caller's spelling of a language
# never enters into it.
_models: dict[str, object] = {}
_lock = threading.Lock()

# Set the first time the runtime turns out to be present but unusable, and
# never cleared while the process lives.
#
# `find_spec` answers from the filesystem: it says yes to a package whose
# directory exists, which includes one pip is halfway through writing. That is
# not hypothetical — this package was built while torch and transformers were
# being installed alongside it, and there was a window where `find_spec` found
# transformers and `import transformers` raised. Without this, IndicF5 would
# claim Hindi on every request in that window, fail, and take Hindi away from a
# phone that Piper could have served.
_runtime_failure: str | None = None

# The same idea for the *weights*, remembered for the same reason.
#
# `_weights_problem` below can only check whether a token exists, not whether
# the hub will honour it, because it runs on the `/health` path and a network
# round trip every fifteen seconds is traffic rather than a health check. So the
# one case it cannot see is a token that authenticates and is not authorised:
#
#     403 Client Error. Cannot access gated repo for url .../config.json
#     Access to model ai4bharat/IndicF5 is restricted and you are not in the
#     authorized list.
#
# Measured with a valid fine-grained token that had no "read access to public
# gated repos" permission: `/health` reported all eleven Indic languages ready,
# every one of them 503'd on use, and each attempt paid a fresh failed round
# trip to huggingface.co — an unbounded external dependency on the path a
# patient is waiting on. That is the exact failure the note on
# `_weights_problem` says this provider exists to avoid; it just could not see
# this shape of it.
#
# So the first real load failure is remembered and the provider stands down for
# the life of the process. Cleared by a restart, which is what a deployment does
# after fixing the token anyway.
_weights_failure: str | None = None

_REFERENCE_AUDIO = "reference.wav"
_REFERENCE_TEXT = "reference.txt"

# What the model generates at, and therefore what a reference is best recorded
# at. Anything from 16 kHz up is resampled and usable; below that is warned
# about and audibly poor.
_NATIVE_RATE = 24000
_MINIMUM_RATE = 16000

# Outside this a pair still works and is still offered — it is a quality
# problem, not a correctness one, and refusing a usable language over half a
# second of audio helps nobody. The log says so once, at load.
_SHORTEST_SECONDS = 2.0
_LONGEST_SECONDS = 20.0


@dataclass(frozen=True)
class Reference:
    """A validated reference pair. Its existence is what makes a language work."""

    language: str
    audio: Path
    text: str
    sample_rate: int
    channels: int
    seconds: float


class IndicF5TTS(TTSProvider):
    id = INDICF5

    def __init__(
        self,
        reference_dir: Path,
        model_id: str,
        device: str = "cpu",
        sample_rate: int = _NATIVE_RATE,
        requires: tuple[str, ...] = ("torch", "transformers"),
    ) -> None:
        self._reference_dir = reference_dir
        self._model_id = model_id
        self._device = device
        self._sample_rate = sample_rate
        self._requires = tuple(requires)
        # Keyed on the resolved files and their fingerprints, so a pair dropped
        # in while the service runs is picked up, and a pair that has not
        # changed is not re-read on every /health poll.
        self._examined: dict[str, tuple[object, Reference | None, str]] = {}
        self._examine_lock = threading.Lock()

    # ── What it can do right now ──────────────────────────────────

    def runtime_problem(self) -> str:
        """Why this provider cannot run at all, or "" when it can.

        A sentence rather than a boolean so `/health` can say *which* import is
        missing. "torch is not installed" and "transformers is not installed"
        are the same symptom and different afternoons.

        Checked with `find_spec`, which looks for the module without executing
        it — `/health` is polled every fifteen seconds and must not drag half a
        gigabyte of torch into memory to answer a boolean. The cost of that
        cheapness is that it cannot tell a working install from a half-written
        one, which is what `_runtime_failure` is for: the first real import
        that fails is remembered, and this provider stands down for the life of
        the process rather than failing one request per patient.
        """
        if _runtime_failure:
            return _runtime_failure
        # Before the import probe, because a gated repo is not something a
        # second attempt fixes and the patient is the one paying for the retry.
        if _weights_failure:
            return _weights_failure
        missing = []
        for module in self._requires:
            try:
                if importlib.util.find_spec(module) is None:
                    missing.append(module)
            except (ImportError, ValueError):
                # find_spec raises rather than answering for a package whose
                # parent is itself broken or half-installed. Half-installed is
                # not installed.
                missing.append(module)
        if missing:
            return f"not installed: {', '.join(missing)}"
        return self._weights_problem()

    def _weights_problem(self) -> str:
        """Why the weights cannot be fetched, without importing anything heavy.

        The runtime importing is not the same as the model being obtainable,
        and reporting the first as though it were the second is a false
        capability advertisement with a patient on the other end of it.
        Measured with this check absent: `/health` listed all eleven Indic
        languages as ready while every one of them ended in
        `OSError: You are trying to access a gated repo ... 401`. The app builds
        its picker from that list, so a patient was offered a speaker button
        that could never work — and each press paid a failed HuggingFace round
        trip on the clinical path, 0.65 s to 12.6 s against 0.10 s for English.
        An unbounded external network dependency, on a loopback service.

        Checked against the cache on disk rather than by asking the hub,
        because this runs on the `/health` path: a network round trip every
        fifteen seconds is not a health check, it is traffic. The case that
        actually bites here is a gated model with no token — `ai4bharat/IndicF5`
        is `gated: auto`, so without `HF_TOKEN` the download 401s however
        healthy everything else is.

        Deliberately conservative: it reports a problem only when it is certain
        there is one. A cached model with a stale token still fails at load,
        and `_runtime_failure` catches that the first time it happens.
        """
        if self._cached_weights_exist():
            return ""
        if not any(
            os.environ.get(name, "").strip()
            for name in (
                "HF_TOKEN",
                "HUGGING_FACE_HUB_TOKEN",
                "HUGGINGFACEHUB_API_TOKEN",
            )
        ):
            return (
                f"{self._model_id} is not in the local cache and no Hugging Face "
                "token is set; it is a gated repo, so the download will be refused"
            )
        return ""

    def _cached_weights_exist(self) -> bool:
        """Whether this model id already has a snapshot in the HF cache."""
        home = os.environ.get("HF_HOME", "").strip()
        roots = [Path(home) / "hub"] if home else []
        roots.append(Path.home() / ".cache" / "huggingface" / "hub")

        folder = "models--" + self._model_id.replace("/", "--")
        for root in roots:
            snapshots = root / folder / "snapshots"
            try:
                if snapshots.is_dir() and any(snapshots.iterdir()):
                    return True
            except OSError:
                # An unreadable cache directory is not a cached model.
                continue
        return False

    def _fingerprint(self, directory: Path) -> object:
        """What has to change before a pair is examined again.

        Size and modification time of both halves. A transcript corrected in
        place is a different pair and has to be re-read; the same two files
        untouched between two health checks are not.
        """
        marks = []
        for name in (_REFERENCE_AUDIO, _REFERENCE_TEXT):
            try:
                stat = (directory / name).stat()
                marks.append((stat.st_size, stat.st_mtime_ns))
            except OSError:
                marks.append(None)
        return tuple(marks)

    def _examine(self, code: str) -> tuple[Reference | None, str]:
        """Validate the pair on disk. Returns the reference, or why there is none.

        Logged here rather than by the caller, because this runs exactly once
        per version of a pair: `/health` polls every fifteen seconds and a
        problem that logged on each poll would be noise nobody reads.
        """
        directory = self._reference_dir / code
        audio = directory / _REFERENCE_AUDIO
        transcript = directory / _REFERENCE_TEXT

        if not audio.exists() and not transcript.exists():
            # The ordinary state of a language nobody has recorded yet. Not a
            # defect and not logged as one — but still, emphatically, not
            # available.
            logger.info("indicf5 %s: no reference pair yet (%s)", code, directory)
            return None, "no reference pair"

        try:
            probe = probe_wav(audio)
            text = read_reference_text(transcript)
        except ValueError as problem:
            # Half a pair. Loud, by name, at load: the alternative is finding
            # out from a patient's failed request three days from now.
            logger.warning("indicf5 %s is unusable: %s", code, problem)
            return None, str(problem)

        reference = Reference(
            language=code,
            audio=audio,
            text=text,
            sample_rate=int(probe["sampleRate"]),
            channels=int(probe["channels"]),
            seconds=float(probe["seconds"]),
        )

        for note in _quality_notes(reference):
            logger.warning("indicf5 %s: %s", code, note)
        logger.info(
            "indicf5 %s ready: %.1fs %dHz %dch, %d characters of transcript",
            code,
            reference.seconds,
            reference.sample_rate,
            reference.channels,
            len(reference.text),
        )
        return reference, ""

    def reference(self, language: str) -> Reference | None:
        """The validated pair for this language, or None if there is not one."""
        code = normalise(language)
        if not code:
            return None
        fingerprint = self._fingerprint(self._reference_dir / code)
        cached = self._examined.get(code)
        if cached is not None and cached[0] == fingerprint:
            return cached[1]
        with self._examine_lock:
            cached = self._examined.get(code)
            if cached is None or cached[0] != fingerprint:
                found, problem = self._examine(code)
                cached = (fingerprint, found, problem)
                self._examined[code] = cached
        return cached[1]

    def problems(self) -> dict[str, str]:
        """Per language, why it is not available. Empty string means it is."""
        report: dict[str, str] = {}
        for code, language in SUPPORTED_LANGUAGES.items():
            if language.tts != self.id:
                continue
            self.reference(code)
            report[code] = self._examined.get(code, (None, None, "not examined"))[2]
        return report

    def validate_all(self) -> None:
        """Examine every language's pair now, so the log tells the truth at boot.

        Called when the provider chain is built rather than on first request.
        A half-supplied language is meant to be visible in the startup log of
        the deployment that supplied it, not in the 500 a patient gets.
        """
        problems = self.problems()
        ready = sorted(code for code, problem in problems.items() if not problem)
        logger.info(
            "indicf5 references under %s: %d of %d ready (%s)",
            self._reference_dir,
            len(ready),
            len(problems),
            ", ".join(ready) or "none",
        )

    def supports(self, language: str) -> bool:
        entry = get(language)
        # `entry.tts` is the gate that keeps English out of here. IndicF5 was
        # not trained on it, and a model asked for a language it does not have
        # produces something — it does not refuse. This is the only place that
        # decision is made, and it is made from the table rather than from a
        # code comparison.
        if entry is None or entry.tts != self.id:
            return False
        if self.runtime_problem():
            return False
        return self.reference(language) is not None

    def status(self) -> dict:
        blocked = self.runtime_problem()
        problems = {code: why for code, why in self.problems().items() if why}
        if blocked:
            return {
                "id": self.id,
                "ready": False,
                # Named rather than "unavailable": this provider being absent
                # is the expected state on a box that only speaks English, and
                # an operator needs to tell that apart from one that is broken.
                "detail": blocked,
                "languages": [],
                "problems": problems,
            }
        languages = self.languages()
        return {
            "id": self.id,
            "ready": bool(languages),
            "detail": "" if languages else f"no reference pairs under {self._reference_dir}",
            "languages": languages,
            "problems": problems,
        }

    # ── Doing it ──────────────────────────────────────────────────

    def _model(self):
        """The one loaded model, loading it on first use.

        Double-checked under the lock: two patients tapping the speaker at the
        same moment is the ordinary case, not the rare one, and without this
        both of them start a gigabyte-sized load.
        """
        key = f"{self._model_id}@{self._device}"
        if key not in _models:
            with _lock:
                if key not in _models:
                    _models[key] = self._load()
        return _models[key]

    def _build(self, started: float):
        """The model object, however this version of transformers will give it.

        ## Why there are two ways

        `AutoModel.from_pretrained` is the documented entry point and is what
        AI4Bharat's model card shows. On transformers 4.x it works. On
        transformers 5.x it does not, and the failure is not obviously about
        transformers at all:

            RuntimeError: Tensor on device cpu is not on the expected device meta!
            (transformers_modules/.../model.py line 43, in INF5Model.__init__)

        transformers 5 initialises a model under a meta-device context and
        materialises the weights afterwards, which is the right thing for a
        model whose `__init__` only declares layers. `INF5Model.__init__` is not
        that: it builds a vocoder and a DiT on a **real** device and loads its
        own checkpoint through `f5_tts.load_model`, and the line in the upstream
        file that would have loaded a state dict from `model.safetensors` is
        commented out. So `from_pretrained`'s weight machinery contributes
        nothing here except the meta context that breaks the constructor.

        Constructing the class directly skips exactly that and nothing else.
        The config still comes from the hub, the class still comes from the
        hub's own `model.py`, and `trust_remote_code` is still what makes both
        legal — the trust decision below is unchanged.

        `from_pretrained` is still tried first, so a deployment pinned to
        transformers 4.x keeps the documented path and this fallback stays
        unused. Only the meta failure falls through; every other error is the
        caller's to remember.
        """
        from transformers import AutoConfig, AutoModel

        # `trust_remote_code=True` executes the modelling code published with
        # the weights. It is how AI4Bharat distributes IndicF5 and there is no
        # other entry point — but it means the pinned `model_id` in config.yaml
        # is a trust decision, not a version preference, and a model id taken
        # from a request would be remote code execution. It comes from config
        # and only from config.
        try:
            return AutoModel.from_pretrained(self._model_id, trust_remote_code=True)
        except RuntimeError as error:
            if "meta" not in str(error):
                raise
            logger.info(
                "indicf5: from_pretrained hit transformers' meta-device init "
                "(%.1fs in); constructing the model directly instead",
                time.perf_counter() - started,
            )

        config = AutoConfig.from_pretrained(self._model_id, trust_remote_code=True)
        # The same class `AutoModel` would have resolved, from the same
        # `auto_map` in the same config — resolved by hand only because the
        # wrapper that normally does it is the thing that cannot be used.
        from transformers.dynamic_module_utils import get_class_from_dynamic_module

        reference = (getattr(config, "auto_map", {}) or {}).get("AutoModel")
        if not reference:
            raise RuntimeError(
                f"{self._model_id} config has no auto_map.AutoModel to construct"
            )
        model_class = get_class_from_dynamic_module(reference, self._model_id)
        return model_class(config)

    @staticmethod
    def _register_ffmpeg() -> None:
        """Put `MEDIHIVE_FFMPEG_DIR` on Windows' DLL search path, if it is set.

        IndicF5 reads its reference recording through `f5_tts` ->
        `torchaudio.load`, and torchaudio 2.11 dropped its own backends: every
        load now goes through TorchCodec, which is a thin wrapper over FFmpeg's
        shared libraries. Without them the failure is two layers from the cause:

            OSError: Could not load this library: ...\\libtorchcodec_core4.dll
            RuntimeError: Failed to create AudioDecoder for .../reference.wav

        On Linux this never comes up — the sidecar's Dockerfile installs ffmpeg
        and the loader finds it. On Windows there is nothing to find unless
        somebody put it there, and **PATH is not enough**: since Python 3.8 the
        interpreter no longer searches PATH for extension-module dependencies,
        so a directory full of av*.dll on PATH is invisible to the DLL that
        wants them. Measured both ways on this box — PATH alone fails, this
        call succeeds.

        A no-op when the variable is unset, which keeps every other deployment
        exactly as it was: the failure it prevents only affects IndicF5, and a
        box without the variable is a box that either has FFmpeg installed
        properly or is not running IndicF5 at all.
        """
        directory = os.environ.get("MEDIHIVE_FFMPEG_DIR", "").strip()
        if not directory or not hasattr(os, "add_dll_directory"):
            return
        path = Path(directory)
        if not path.is_dir():
            logger.warning("MEDIHIVE_FFMPEG_DIR %s is not a directory; ignoring", path)
            return
        try:
            os.add_dll_directory(str(path))  # type: ignore[attr-defined]
            logger.info("indicf5: ffmpeg libraries registered from %s", path)
        except OSError as error:
            logger.warning("could not register %s for DLL loading: %s", path, error)

    def _load(self):
        global _runtime_failure
        self._register_ffmpeg()
        try:
            # Imported here, not at module scope: this file must import on a
            # box with no torch. See the note at the top.
            import torch  # noqa: F401
            from transformers import AutoModel  # noqa: F401
        except Exception as error:
            # An install that `find_spec` can see and Python cannot import.
            # Remembered process-wide so the chain stops offering IndicF5
            # instead of discovering this again on the next patient's question.
            _runtime_failure = f"{type(error).__name__} importing the runtime: {error}"
            logger.error("indicf5 runtime is present but unusable: %s", error)
            raise

        before = rss_mb()
        started = time.perf_counter()

        global _weights_failure
        try:
            model = self._build(started)
        except Exception as error:
            # Remembered process-wide. The cases that reach here — a gated repo
            # the token is not authorised for, a revoked token, a disk with no
            # room for several gigabytes — are none of them fixed by the next
            # patient trying again, and retrying puts a network round trip to
            # huggingface.co on the clinical path. See `_weights_failure`.
            #
            # The message is kept to one line: it goes into `/health.detail`,
            # which an operator reads, and the hub's own error is a paragraph
            # with a request id in it.
            first = str(error).strip().splitlines()
            _weights_failure = (
                f"{self._model_id} could not be fetched: "
                f"{first[0] if first else type(error).__name__}"
            )
            logger.error(
                "indicf5 weights unavailable; standing down for this process: %s",
                _weights_failure,
            )
            raise

        # `.to(device)` on the model rather than a device_map, because the
        # device here is nearly always `cpu` on purpose: this box has 4 GB of
        # VRAM and Ollama is holding it. See config.yaml.
        if hasattr(model, "to"):
            model = model.to(self._device)
        if hasattr(model, "eval"):
            model.eval()

        after = rss_mb()
        logger.info(
            "indicf5 loaded %s on %s in %.1fs rss=%s (+%s)",
            self._model_id,
            self._device,
            time.perf_counter() - started,
            f"{after:.0f}MB" if after is not None else "?",
            f"{after - before:.0f}MB" if after is not None and before is not None else "?",
        )
        return model

    def synthesize(self, text: str, language: str) -> bytes:
        code = normalise(language)
        reference = self.reference(code) if self.supports(code) else None
        if reference is None:
            # Never a substitution, never the nearest language with a reference
            # pair on disk. `main.py` has already answered 503 in the ordinary
            # case; this is the guard for the caller that did not ask first.
            raise UnsupportedLanguage(self.id, code)

        model = self._model()
        started = time.perf_counter()
        # Positional text, keyword reference: the signature published with the
        # weights. The path goes in rather than samples because the model's own
        # code opens and resamples it, and doing that here would be a second
        # opinion about the format.
        samples = model(text, ref_audio_path=str(reference.audio), ref_text=reference.text)
        audio = wav_bytes(samples, self._sample_rate)
        log_synthesis(self.id, code, text, time.perf_counter() - started, audio)
        return audio

    def sample_rate(self, language: str) -> int:
        """24000 Hz, from config, for every language.

        Fixed rather than read off anything, because IndicF5 generates at one
        rate regardless of which reference pair conditions it — the reference
        may be 16 kHz or 48 kHz and the model resamples it on the way in. The
        value comes from `config.yaml` so a deployment that pins a different
        build of the weights can say so; see the note beside it there.
        """
        return self._sample_rate

    def synthesize_stream(self, text: str, language: str) -> Iterator[bytes]:
        """Sentence at a time, queued. Not true streaming, and the shape is the point.

        IndicF5 is flow-matching over a whole utterance: it has no incremental
        API and no partial output, so the smallest thing it can hand back is one
        finished sentence. There is nothing to be gained by pretending otherwise
        inside this method.

        What there is to gain is *starting*. A three-sentence red-flag message
        synthesised whole is thirty seconds of silence on this box before the
        patient hears anything; synthesised a sentence at a time, the first one
        plays while the second is still generating, and the patient is already
        being spoken to. The generator is also what makes it cancellable — the
        worker abandoning it on a barge-in stops the next sentence from being
        generated at all, rather than throwing away audio that was paid for.
        Both fall straight out of the base class's default, so this method is
        the base class's default plus the log line that says which engine and
        how long each piece took.

        When AI4Bharat ships an incremental decoder, this is the one method that
        changes and nothing above it moves.
        """
        code = normalise(language)
        pieces = split_sentences(text)
        for index, sentence in enumerate(pieces):
            started = time.perf_counter()
            pcm = pcm_from_wav(self.synthesize(sentence, code))
            logger.info(
                "indicf5 %s piece %d/%d in %.2fs (%d chars)",
                code,
                index + 1,
                len(pieces),
                time.perf_counter() - started,
                len(sentence),
            )
            if pcm:
                yield pcm


def _quality_notes(reference: Reference) -> list[str]:
    """Things wrong with a usable pair. None of them make it unusable.

    Split out from the refusals above on purpose: a 30-second reference makes
    every synthesis slower and a stereo one wastes half the file, but refusing
    a language over either would take a working voice away from a patient to
    make a point. They are logged once, at load, and that is all.
    """
    notes = []
    if reference.channels != 1:
        notes.append(f"{reference.channels} channels; mono is expected")
    if reference.sample_rate < _MINIMUM_RATE:
        notes.append(
            f"{reference.sample_rate} Hz is below {_MINIMUM_RATE} Hz and will sound like it"
        )
    elif reference.sample_rate != _NATIVE_RATE:
        notes.append(
            f"{reference.sample_rate} Hz will be resampled to {_NATIVE_RATE} Hz"
        )
    if reference.seconds < _SHORTEST_SECONDS:
        notes.append(f"{reference.seconds:.1f}s is too short to establish a voice")
    elif reference.seconds > _LONGEST_SECONDS:
        notes.append(f"{reference.seconds:.1f}s is longer than the model uses")
    return notes
