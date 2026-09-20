"""Questions read aloud, in the language they were asked in.

This package replaced the single `tts.py` that spoke English and Hindi through
Piper. It keeps that module's public surface exactly — `normalise`,
`voice_path`, `available`, `languages`, `speak` — because a Flutter build on a
real phone is calling `POST /tts {"language":"en"}` right now and gets the same
22050 Hz WAV back as it always has. What is new is underneath: a chain of
providers, tried in the order config.yaml lists them, each one free to say it
cannot do a language.

TTS is the one part of this service allowed to be simply absent. A patient who
cannot hear the question can still read it and tap the answer, so a missing
voice degrades the experience and never blocks a case. [available] says so
honestly rather than raising at the first request.

## The chain, and the one thing it will not do

`providers.order` in config.yaml is `[indicf5, piper]`. For a given language
each provider is asked [TTSProvider.supports] in turn and the first yes
speaks. IndicF5 declines English, because it was not trained on it; Piper
declines anything it has no `.onnx` for. When every provider declines, the
answer is a refusal — a 503 and a written sentence — and **never a substituted
language**.

That last clause is the whole design. The code this replaced resolved an
unknown language to the English voice, so a Tamil question was read aloud in
English at HTTP 200 with nothing in the logs. A patient cannot tell a
wrong-language question from their own hearing; they can tell silence.

## Why the configuration is data

Which engine speaks which language is a deployment fact — it changes when
somebody finishes sourcing reference audio, or when a box turns out to have a
GPU to spare. config.yaml holds it, `language_config.py` holds the languages,
and neither of them is code anybody has to redeploy to edit.
"""

from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any

from .base import TTSProvider, UnsupportedLanguage
from .base import resolve_dir as _resolve_dir
from .indicf5 import IndicF5TTS
from .language_config import SUPPORTED_LANGUAGES, Language, get, is_supported, normalise
from .piper import PiperTTS

logger = logging.getLogger(__name__)

_PACKAGE_DIR = Path(__file__).resolve().parent

# Overridable so a deployment can hold its own config outside the tree, the
# same way MEDIHIVE_VOICE_DIR holds the weights outside it.
_CONFIG_PATH = Path(
    os.environ.get("MEDIHIVE_TTS_CONFIG", "").strip() or _PACKAGE_DIR / "config.yaml"
)

# What the service runs on when config.yaml is missing or unparseable.
#
# Not a convenience: a YAML file with a tab in it must not be able to take
# English off a phone that is mid-interview. The defaults are the shipped
# config, so a broken file degrades to the documented behaviour and says so in
# the log rather than refusing to start.
_DEFAULTS: dict[str, Any] = {
    "providers": {"order": ["indicf5", "piper"]},
    "indicf5": {
        "model_id": "ai4bharat/IndicF5",
        "device": "cpu",
        "reference_dir": "voices",
        "sample_rate": 24000,
        "requires": ["torch", "transformers"],
    },
    "piper": {"voice_dir": "../voices", "voices": {}},
}


def _load_config() -> dict[str, Any]:
    merged = {section: dict(values) for section, values in _DEFAULTS.items()}
    try:
        import yaml

        loaded = yaml.safe_load(_CONFIG_PATH.read_text(encoding="utf-8")) or {}
        if not isinstance(loaded, dict):
            raise ValueError("config.yaml must be a mapping")
        for section, values in loaded.items():
            if isinstance(values, dict):
                merged.setdefault(section, {}).update(values)
            else:
                merged[section] = values
    except Exception as error:
        logger.warning("tts config %s unusable (%s); using defaults", _CONFIG_PATH, error)
    return merged


_config = _load_config()

_chain: list[TTSProvider] | None = None
_chain_lock = threading.Lock()


def _build_chain() -> list[TTSProvider]:
    indicf5_config = _config.get("indicf5", {})
    piper_config = _config.get("piper", {})

    # NOTE (unresolved): idle eviction of the loaded IndicF5 model is NOT
    # implemented. This line used to call `configure_idle(...)` in indicf5.py,
    # which no longer defines it — the import of a name that is not there took
    # the whole service down, because `main.py` imports `tts` before uvicorn
    # binds a port. The call is removed here to restore startup, deliberately
    # WITHOUT re-inventing the eviction it configured.
    #
    # What that costs, stated plainly: `_models` in indicf5.py is a module
    # level dict with no eviction, so once IndicF5 loads it stays resident for
    # the life of the process. That is invisible on a box where IndicF5 cannot
    # load at all (`ai4bharat/IndicF5` is a gated repo and needs a Hugging Face
    # token), which is this one, and it is a multi-gigabyte resident model on a
    # box that has the token. `idle_seconds` in config.yaml is read by nothing.
    #
    # Reinstating eviction is a deliberate change somebody should make on
    # purpose, with the memory measurement to go with it — not something to
    # restore silently from a comment.

    built: dict[str, TTSProvider] = {
        IndicF5TTS.id: IndicF5TTS(
            reference_dir=_resolve_dir(
                str(indicf5_config.get("reference_dir", "voices")),
                _PACKAGE_DIR,
                "MEDIHIVE_TTS_REFERENCE_DIR",
            ),
            model_id=str(indicf5_config.get("model_id", "ai4bharat/IndicF5")),
            # The environment variable wins over the file so a box with a spare
            # GPU — or one where Ollama has been stopped — is a restart with an
            # export, not an edit to a committed file.
            device=os.environ.get("MEDIHIVE_TTS_DEVICE", "").strip()
            or str(indicf5_config.get("device", "cpu")),
            sample_rate=int(indicf5_config.get("sample_rate", 24000)),
            requires=tuple(indicf5_config.get("requires", ("torch", "transformers"))),
        ),
        PiperTTS.id: PiperTTS(
            voice_dir=_resolve_dir(
                str(piper_config.get("voice_dir", "../voices")),
                _PACKAGE_DIR,
                "MEDIHIVE_VOICE_DIR",
            ),
            overrides=piper_config.get("voices") or {},
        ),
    }

    override = os.environ.get("MEDIHIVE_TTS_PROVIDERS", "").strip()
    order = (
        [name.strip() for name in override.split(",") if name.strip()]
        if override
        else list(_config.get("providers", {}).get("order", []))
    )

    chain: list[TTSProvider] = []
    for name in order:
        provider = built.get(name)
        if provider is None:
            # A typo in the order list must not take the service down, and it
            # must not be silent either: the symptom would otherwise be "Hindi
            # stopped working" with nothing to connect it to.
            logger.warning("tts provider %r in provider order is not a known provider", name)
            continue
        chain.append(provider)

    if not chain:
        logger.warning("tts provider order is empty; nothing can be spoken")

    for provider in chain:
        # Reference pairs are read and validated here, once, so a half-supplied
        # language appears in the startup log of the deployment that supplied
        # it rather than in the 503 a patient gets three days later. Cheap: a
        # WAV header and a line of text per language, and nothing is loaded.
        validate = getattr(provider, "validate_all", None)
        if callable(validate):
            validate()
    return chain


def providers() -> list[TTSProvider]:
    """The configured chain, built once.

    Built lazily under a lock rather than at import, so `import tts` stays
    cheap and cannot fail on a bad path — this module is imported by `main.py`
    before uvicorn has bound a port, and an exception there is a service that
    does not start rather than a capability that reports itself down.
    """
    global _chain
    if _chain is None:
        with _chain_lock:
            if _chain is None:
                _chain = _build_chain()
    return _chain


def provider_for(language: str) -> TTSProvider | None:
    """The first provider in the chain that can speak this language, or None.

    None is a real answer and the caller's job is to refuse. It is never the
    cue to try a different language.
    """
    if not is_supported(language):
        return None
    for provider in providers():
        if provider.supports(language):
            return provider
    return None


# ── The surface `main.py` and the old `tts.py` share ──────────────


def available(language: str = "en") -> bool:
    """Whether this language can actually be spoken right now."""
    return provider_for(language) is not None


def languages() -> list[str]:
    """Every configured language some provider can speak right now.

    `/health` reports this alongside the plain `tts` boolean so a caller can
    see that Tamil is missing without having to request it and read the 503.
    """
    return sorted(code for code in SUPPORTED_LANGUAGES if available(code))


def warm() -> None:
    """Load what is slow to load, before anybody asks for it.

    Only providers that choose to implement `warm` - Piper's voices are tens
    of megabytes and load in a couple of seconds, so it does not bother. A
    provider that cannot speak anything right now is skipped rather than
    asked, because warming a model whose weights are missing is a download
    nobody requested.
    """
    for provider in providers():
        warmer = getattr(provider, "warm", None)
        if warmer is None or not provider.languages():
            continue
        warmer()


def speak(text: str, language: str = "en") -> bytes:
    """One WAV, whole, in the language asked for or not at all."""
    return speak_with_provider(text, language)[0]


def speak_with_provider(text: str, language: str = "en") -> tuple[bytes, str]:
    """The audio and the id of whatever produced it.

    The id goes out as a response header. It is the cheapest possible answer to
    "which engine actually spoke this?", which used to be unanswerable — the
    incident this package exists because of was a Tamil request served by the
    English voice, and nothing in the response or the log said so.

    ## Falling through on a failure is not substituting a language

    A provider that says it supports a language and then throws — a model that
    will not load, weights half-written, a runtime that `find_spec` could see
    and Python cannot import — hands the request to the **next provider that
    supports the same language**, not to the next provider. For Hindi that
    means IndicF5 failing costs a patient the better voice and nothing else,
    because Piper has a Hindi voice of its own. For Tamil there is nobody to
    fall through to and the refusal stands.

    That distinction is the whole reason `supports` is on the interface: the
    chain never has to guess what a provider can do, so falling forward through
    it cannot quietly arrive at the wrong language.
    """
    code = normalise(language)
    if not is_supported(code):
        raise UnsupportedLanguage("chain", code)

    failure: Exception | None = None
    for provider in providers():
        if not provider.supports(code):
            continue
        try:
            return provider.synthesize(text, language), provider.id
        except Exception as error:  # noqa: BLE001 — the next provider is the handler
            failure = error
            logger.exception("tts provider %s failed on %s; trying the rest", provider.id, code)

    if failure is not None:
        raise failure
    raise UnsupportedLanguage("chain", code)


def voice_path(language: str) -> Path | None:
    """The Piper voice file for this language, or None if there is not one.

    Kept from the module this package replaced, where it was the only notion of
    a voice there was. IndicF5 has no per-language file — it has a reference
    recording and one set of weights — so this answers for Piper alone and a
    None here no longer means a language cannot be spoken. Ask [available].
    """
    for provider in providers():
        if isinstance(provider, PiperTTS):
            return provider.voice_path(language)
    return None


# ── What `/health` reports ────────────────────────────────────────


def provider_status() -> list[dict[str, Any]]:
    """Per provider: whether it is ready, why not, and what it can speak."""
    return [provider.status() for provider in providers()]


def availability() -> dict[str, dict[str, Any]]:
    """Per language: who would speak it, and who could.

    One row per configured language rather than a list of the working ones,
    because the useful question on a health check is "why is Odia not
    available" and a list of the seven that are cannot answer it. `providers`
    holds every provider's own answer, so "IndicF5 has no reference audio yet
    but Piper has a voice file" is visible without reading a log.
    """
    chain = providers()
    report: dict[str, dict[str, Any]] = {}
    for code, language in sorted(SUPPORTED_LANGUAGES.items()):
        per_provider = {provider.id: provider.supports(code) for provider in chain}
        serving = next((provider.id for provider in chain if per_provider[provider.id]), None)
        report[code] = {
            "name": language.name,
            "englishName": language.english_name,
            "preferred": language.tts,
            "provider": serving,
            "available": serving is not None,
            "providers": per_provider,
        }
    return report


__all__ = [
    "Language",
    "SUPPORTED_LANGUAGES",
    "TTSProvider",
    "UnsupportedLanguage",
    "availability",
    "available",
    "get",
    "is_supported",
    "languages",
    "normalise",
    "provider_for",
    "provider_status",
    "providers",
    "speak",
    "speak_with_provider",
    "voice_path",
]
