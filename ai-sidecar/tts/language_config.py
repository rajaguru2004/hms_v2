"""The languages this service knows about, in one place.

Every other module asks this one. That is the whole point of the file: a
language is not a string that some function happens to recognise, it is a row
in this table, and a module that wants to know whether Odia is a thing looks
here rather than growing its own opinion.

The alternative — the shape this code had — was a voice-filename dict in
`tts.py`, a comment in `stt.py` about Indian languages, and a hardcoded `"en"`
in `/health`, which between them disagreed about which languages existed. The
disagreement was not academic: a Tamil request matched nothing in the voice
dict, fell through to English, and a patient was asked a question in a language
they do not read, at HTTP 200.

## The `tts` column is a preference, not a promise

It names the provider **expected** to serve the language well, and nothing
more. Whether it can right now depends on weights on disk and a runtime that
imports, which only the provider itself can answer — see `base.TTSProvider`.
The chain in `__init__.py` asks, in order, and the first provider that says yes
speaks. A provider that says no is never talked round: silence is a
degradation the patient can survive, and the wrong language is not.

## Why English is in a table of Indian languages

Because it is in production. A Flutter build on a real phone is asking this
service for English WAVs today, and a table that listed only the eleven new
languages would have made `en` an unknown code — a 503 on the one language that
currently works. English is served by Piper, which is the only provider here
that has an English voice at all; IndicF5 is trained on the eleven and refuses
the twelfth, which is exactly the honesty this table is for.
"""

from __future__ import annotations

from dataclasses import dataclass

# Provider ids. Spelled once, because they are the join between this table, the
# `providers.order` list in config.yaml, and the `id` on each provider class —
# three places that must agree and no compiler to check them.
INDICF5 = "indicf5"
PIPER = "piper"


@dataclass(frozen=True)
class Language:
    """One language this service is willing to be asked about."""

    code: str
    """The ISO 639-1 code, which is also the key. What `normalise` produces."""

    name: str
    """The language's own name, in its own script.

    Shown to a patient choosing a language. A speaker of Odia who cannot read
    English cannot pick "Odia" off a list, which is the exact population this
    whole feature exists for.
    """

    english_name: str
    """The name a clinician, a log line and an error message use."""

    tts: str
    """The provider expected to speak it. See the note above: a preference."""


# Keyed on the primary subtag, because that is what `normalise` produces and
# what a phone's `Locale.toLanguageTag()` reduces to. `or` is a Python keyword
# and a perfectly ordinary dict key; it is quoted in config.yaml for the same
# reason it is fine here — it is a string, not syntax.
SUPPORTED_LANGUAGES: dict[str, Language] = {
    "as": Language("as", "অসমীয়া", "Assamese", INDICF5),
    "bn": Language("bn", "বাংলা", "Bengali", INDICF5),
    "gu": Language("gu", "ગુજરાતી", "Gujarati", INDICF5),
    "hi": Language("hi", "हिन्दी", "Hindi", INDICF5),
    "kn": Language("kn", "ಕನ್ನಡ", "Kannada", INDICF5),
    "ml": Language("ml", "മലയാളം", "Malayalam", INDICF5),
    "mr": Language("mr", "मराठी", "Marathi", INDICF5),
    # Odia is the one language in this table that no engine here can *hear*.
    # faster-whisper's tokenizer has 100 languages and `or` is not among them —
    # verified against `faster_whisper.tokenizer._LANGUAGE_CODES`, not assumed.
    # It stays in the table because IndicF5 can speak it: a patient can be
    # asked the question aloud in Odia and answer by typing, which is a real
    # degradation rather than an absent language. `stt.py` refuses it by name.
    "or": Language("or", "ଓଡ଼ିଆ", "Odia", INDICF5),
    "pa": Language("pa", "ਪੰਜਾਬੀ", "Punjabi", INDICF5),
    "ta": Language("ta", "தமிழ்", "Tamil", INDICF5),
    "te": Language("te", "తెలుగు", "Telugu", INDICF5),
    # Piper, not IndicF5: IndicF5 is trained on the eleven above and English is
    # not one of them. This row is also the one in production today.
    "en": Language("en", "English", "English", PIPER),
}


def normalise(language: str | None) -> str:
    """The primary subtag, lowercased. `ta-IN`, `ta_IN` and `TA` are all `ta`.

    A phone sends whatever `Locale.toLanguageTag()` gave it, which is BCP-47:
    `ta-IN`, not `ta`. Matching the raw string against a table keyed on bare
    two-letter codes misses every one of them, and the miss used to be silent.

    Deliberately *not* an alias table. `tam`, `tamil` and `ta-Taml-IN` do not
    become `ta` here — the first two are not BCP-47 at all and the third has a
    script subtag this service has nothing to do with. They fall out as codes
    this table does not contain, which is a clean refusal. Guessing what a
    caller meant is how a language ends up substituted for another one.
    """
    tag = (language or "").strip().lower().replace("_", "-")
    return tag.split("-", 1)[0]


def get(language: str | None) -> Language | None:
    """The row for this language, or None if there is not one.

    None rather than a KeyError or a default: "we do not know this language" is
    an answer callers act on, and every one of them acts on it by refusing.
    """
    return SUPPORTED_LANGUAGES.get(normalise(language))


def is_supported(language: str | None) -> bool:
    """Whether this is a language the service is configured for at all.

    Distinct from whether it can be spoken or heard right now, which depends on
    weights on disk and belongs to the providers.
    """
    return normalise(language) in SUPPORTED_LANGUAGES


def codes() -> list[str]:
    """Every configured code, sorted. The order `/health` reports them in."""
    return sorted(SUPPORTED_LANGUAGES)
