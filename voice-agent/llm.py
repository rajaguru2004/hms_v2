"""Gemma, streaming, for wording only — and the leash it is kept on.

## What this is allowed to do

Reword the one question the engine has already chosen, in the language the
engine has already chosen it in, so it sounds like somebody asking rather than
a form being read out. That is the whole job. `LLM for language, software for
structure` is not a slogan here, it is the division this module implements:
`selectNext` in the Nest engine decides *which* clinical field is asked next,
`phrasebook.ts` decides *what the question means*, and this decides how the
sentence scans.

## What it is structurally incapable of doing

Changing the interview. It is handed a finished question and a field path and
returns a string; nothing it produces is ever parsed, stored, or compared
against a clinical rule. Presence derivation, red flags, escalation and question
order all happen in Nest, on the engine's own text, before this module is called
at all — see the note at the top of `agent.py`. If Ollama is down, slow, or
talking nonsense, the patient hears the engine's own wording and the clinical
record is byte-identical.

That last property is the reason this can be switched on at all, and it is worth
being explicit about what it does *not* cover. A rewording that is fluent and
subtly different — "does the pain spread to your arm?" becoming "does your arm
hurt?" — is a different clinical question, it is a plausible 4B-model slip, and
the guards below will not catch it because it is not malformed. Nothing here
makes an unreviewed rewording safe; what it does is keep one badly worded
*question* from becoming a wrong *fact*, and keep the blast radius to the turn
it happened on.

`MEDIHIVE_LLM_PHRASING` is therefore **off by default**. See config.py.

## What it must never be pointed at

`patientMessage`. That string is the routing instruction from the most severe
triggered red-flag rule — "stop and go to the front desk now" — and it is
checked-in, reviewed text. The caller passes questions here and speaks
`patientMessage` verbatim; see `speak_turn` in agent.py.

## Why it streams

Because the alternative is silence. gemma3:4b on this box runs at roughly 21
tokens a second warm, so a twenty-token question is a second of nothing before
the first sample of audio exists. Streaming, the first *sentence* is complete in
a few hundred milliseconds and goes straight to the synthesiser while the rest
is still being generated. The unit is a sentence rather than a token because
the synthesiser's unit is a sentence: there is nothing useful to hand Piper
half a clause of.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from typing import AsyncIterator

import httpx

import timing
from httpclient import async_client

logger = logging.getLogger(__name__)

# Sentence terminators across every script the interview speaks. Same set as the
# sidecar's `tts/base.py:_SENTENCE_END`; restated rather than imported because
# the two processes deliberately do not share a venv, and kept in one place per
# side so the two can be diffed.
_TERMINATORS = ".!?।॥。？！"

# The name each language is asked for by, in the prompt. English names, because
# the instruction is to the model and gemma3 follows an English instruction to
# produce Tamil more reliably than it follows a Tamil one.
_LANGUAGE_NAMES = {
    "as": "Assamese",
    "bn": "Bengali",
    "en": "English",
    "gu": "Gujarati",
    "hi": "Hindi",
    "kn": "Kannada",
    "ml": "Malayalam",
    "mr": "Marathi",
    "or": "Odia",
    "pa": "Punjabi",
    "ta": "Tamil",
    "te": "Telugu",
}

# Mirrors `src/modules/ai/prompts/question-phrasing.prompt.ts`. The Nest copy is
# the reviewed one and this is the same rules written for a streaming call with
# no JSON envelope — a schema-constrained response cannot be streamed usefully,
# because the first token of `{"question":"` is not speech.
_SYSTEM = [
    "You reword one question so it sounds like a person asking, not a form.",
    "",
    "Rules:",
    "1. Ask exactly the question you are given. Do not ask anything else, do not",
    "   add a second question, and do not answer it yourself.",
    "2. Never suggest what might be wrong with them, and never name a condition,",
    "   a test or a medicine. You are not diagnosing; you are asking.",
    "3. Plain words. Short sentence. No clinical vocabulary the patient did not",
    "   use first.",
    "4. Do not reassure and do not alarm.",
    "5. If the question offers choices, keep every one of them.",
    "6. Answer in the same language the question is written in, and in that",
    "   language's own script. Do not translate it.",
    "",
    "Reply with the question and nothing else. No preamble, no quotes, no JSON.",
]


class LlmUnavailable(Exception):
    """Ollama did not answer, or answered something unusable. Operational."""


@dataclass
class PhrasingRequest:
    """One question to reword, plus everything the guards need to check it."""

    text: str
    """The engine's own wording. Spoken verbatim if anything below fails."""

    language: str
    field_path: str | None = None
    choices: tuple[str, ...] = ()
    last_patient_utterance: str | None = None


class OllamaClient:
    """One HTTP client, held open, streaming `/api/chat`.

    No model is loaded in this process — Ollama holds gemma3:4b in its own, for
    `OLLAMA_KEEP_ALIVE`, and this is a socket. That is the same argument
    `sidecar.py` makes about Whisper, and it matters more here: the worker has
    ~1 GB of headroom and the model is several.
    """

    def __init__(
        self,
        base_url: str,
        model: str,
        *,
        timeout: float = 20.0,
        first_token_timeout: float = 2.5,
        max_chars: int = 320,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._model = model
        self._timeout = timeout
        self._first_token_timeout = first_token_timeout
        self._max_chars = max_chars
        self._client = async_client(timeout)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def available(self) -> bool:
        """Whether Ollama is up and holding the configured model.

        Checked once at join rather than per turn. A per-turn probe is another
        round trip in the budget, and the failure it would catch — Ollama dying
        mid-interview — is already handled by every call falling back.
        """
        try:
            response = await self._client.get(f"{self._base}/api/tags", timeout=3.0)
            if response.status_code != 200:
                return False
            names = {m.get("name", "") for m in response.json().get("models", [])}
        except Exception as exc:
            logger.info("ollama is not available at %s (%s)", self._base, exc)
            return False
        # `gemma3:4b` and `gemma3:4b-it-q4_K_M` are the same model to a human
        # and different strings to a tag list, so the configured name matching
        # any tag's prefix counts. A miss here is not fatal; it downgrades
        # phrasing to off for the session and logs which names were on offer.
        if any(name == self._model or name.startswith(self._model) for name in names):
            return True
        logger.warning(
            "ollama has no model matching %r; phrasing is off. It has: %s",
            self._model,
            ", ".join(sorted(names)) or "(nothing)",
        )
        return False

    async def phrase(self, request: PhrasingRequest) -> AsyncIterator[str]:
        """The reworded question, a sentence at a time, as it is generated.

        Yields nothing at all rather than raising when the model is unusable —
        an empty stream is the caller's signal to speak the engine's own text,
        and that path must not need a try/except at every call site.

        Three things end the stream early, and all three are deliberate:

        * **No first token within `first_token_timeout`.** The patient is
          sitting in silence and the engine's sentence is already in hand. A
          model that has not started in 2.5 s is not going to beat it.
        * **`max_chars` exceeded.** A 4B model that has lost the thread produces
          paragraphs. Nothing past the cap is spoken.
        * **A second question.** Rule 1 says one question; a second `?` means
          the model added one, and the caller has already been handed the first
          sentence, so the extra is dropped rather than the whole reply
          discarded.
        """
        started = time.monotonic()
        timing.mark(
            "llm.request", chars=len(request.text), language=request.language
        )

        buffer = ""
        emitted = 0
        first_token_at: float | None = None
        questions = 0

        try:
            async for token in self._tokens(request, started):
                if first_token_at is None:
                    first_token_at = time.monotonic()
                    timing.mark(
                        "llm.first_token",
                        ms=round((first_token_at - started) * 1000.0, 1),
                    )
                buffer += token
                if len(buffer) + emitted > self._max_chars:
                    logger.warning(
                        "phrasing for %s ran past %d characters; truncating",
                        request.field_path or "?",
                        self._max_chars,
                    )
                    break

                # Emit on a terminator. Not on a newline and not on a comma:
                # both appear inside one spoken clause, and a synthesiser handed
                # half a clause puts a pause in the middle of it.
                while True:
                    cut = _first_terminator(buffer)
                    if cut is None:
                        break
                    sentence, buffer = buffer[: cut + 1].strip(), buffer[cut + 1 :]
                    if not sentence:
                        continue
                    questions += sentence.count("?") + sentence.count("？")
                    emitted += len(sentence)
                    timing.mark("llm.sentence", chars=len(sentence), index=questions)
                    yield sentence
                    if questions >= 1:
                        # One question is the contract. Everything after it is
                        # the model answering itself or asking a second thing,
                        # and neither belongs in a clinical interview.
                        return
        except asyncio.CancelledError:
            # A barge-in. Propagated so the HTTP stream closes and Ollama stops
            # generating for a patient who is already talking over the answer.
            timing.mark("llm.cancelled", ms=round((time.monotonic() - started) * 1000.0, 1))
            raise
        except (httpx.HTTPError, LlmUnavailable, json.JSONDecodeError) as exc:
            # Never fatal. The engine's own sentence is the fallback and the
            # caller applies it by finding this stream empty or short.
            logger.warning("phrasing failed, using the engine's wording: %s", exc)
            timing.mark("llm.failed", error=str(exc)[:120])
            return

        tail = buffer.strip()
        if tail and emitted + len(tail) <= self._max_chars:
            # A reply that ran out of tokens without a full stop. Spoken, because
            # a question with no question mark is still the question, and the
            # alternative is dropping the only thing the model produced.
            timing.mark("llm.sentence", chars=len(tail), index=questions + 1, tail=True)
            yield tail

    async def _tokens(
        self, request: PhrasingRequest, started: float
    ) -> AsyncIterator[str]:
        """`/api/chat` with `stream: true`, as content deltas.

        Ollama answers NDJSON: one JSON object per line, each carrying a
        `message.content` fragment, terminated by an object with `done: true`.
        A line that will not parse ends the stream rather than the turn.
        """
        body = {
            "model": self._model,
            "stream": True,
            "messages": [
                {"role": "system", "content": "\n".join(_SYSTEM)},
                {"role": "user", "content": _user_prompt(request)},
            ],
            "options": {
                # Low, not zero. Zero makes gemma3 repeat the input verbatim,
                # which is the fallback with extra latency; this is enough
                # variation to reword and not enough to invent.
                "temperature": 0.3,
                # A hard ceiling in the model's own units, belt to the
                # `max_chars` braces. A runaway generation costs the patient
                # nothing here because the stream is abandoned, but it costs
                # Ollama the GPU the next turn needs.
                "num_predict": 96,
            },
        }

        async with self._client.stream(
            "POST", f"{self._base}/api/chat", json=body, timeout=self._timeout
        ) as response:
            if response.status_code != 200:
                await response.aread()
                raise LlmUnavailable(f"/api/chat returned {response.status_code}")

            deadline = started + self._first_token_timeout
            seen = False
            async for line in response.aiter_lines():
                line = line.strip()
                if not line:
                    continue
                payload = json.loads(line)
                if payload.get("error"):
                    raise LlmUnavailable(str(payload["error"]))
                token = (payload.get("message") or {}).get("content") or ""
                if token:
                    seen = True
                    yield token
                if payload.get("done"):
                    return
                if not seen and time.monotonic() > deadline:
                    # Checked per line rather than with `asyncio.wait_for`,
                    # because the deadline applies to the *first token* and not
                    # to the whole generation — a model that starts promptly is
                    # allowed to take its time finishing.
                    raise LlmUnavailable(
                        f"no first token within {self._first_token_timeout:.1f}s"
                    )


def _first_terminator(text: str) -> int | None:
    for index, char in enumerate(text):
        if char in _TERMINATORS:
            return index
    return None


def _user_prompt(request: PhrasingRequest) -> str:
    language = _LANGUAGE_NAMES.get(request.language, request.language)
    lines = [f"Question to ask: {request.text}"]
    if request.choices:
        lines.append(f"Answers offered: {', '.join(request.choices)}")
    if request.last_patient_utterance:
        lines.append(f"They just said: {request.last_patient_utterance}")
    # Last, and stated as the language the question is *already* in, because the
    # engine's text has already been through the phrasebook. Asking the model to
    # "ask in Tamil" when it has been handed Tamil invites it to translate what
    # is already translated; asking it to keep the language invites it to keep
    # the language.
    lines.append(f"The question above is written in {language}. Reply in {language}.")
    return "\n".join(lines)
