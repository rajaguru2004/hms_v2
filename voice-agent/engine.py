"""The clinical turn. This worker's one job is to not have an opinion about it.

    POST {MEDIHIVE_API_URL}/case-taking/sessions/{sessionId}/turns
    Authorization: Bearer <token>

The engine owns question flow, presence derivation, validation, red flags and
escalation, and it answers in about fifteen milliseconds because all of that is
pure and synchronous. Nothing in this file decides anything clinical. It posts
a transcript and reads back a string.

That is a boundary worth stating in code as well as in a comment, so:

  * [TurnResult] exposes `nextQuestion.prompt` and `patientMessage` and nothing
    that would let a caller re-rank them. [utterances] returns the sentences to
    speak, in order, and that order is the engine's, not ours.
  * There is no "if the transcript looks empty, ask again" path here. An empty
    or low-confidence transcript is posted with its real confidence and the
    engine decides whether to re-ask. It has `transcriptConfidence` in its DTO
    for exactly that, and it is the thing that knows whether the field is
    required.
  * There is no retry on 4xx. A rejected turn is a rejected turn; retrying it
    would write the same fact twice.

`patientMessage` is spoken **before** `nextQuestion.prompt`. It is the message
from the most severe triggered rule — a routing instruction such as "go and
tell the front desk" — and if a patient is going to hear one sentence before
they stop listening, it must be that one rather than the next question.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

import timing
from httpclient import async_client

logger = logging.getLogger(__name__)

# `SubmitTurnDto.modality` is validated against the engine's own ANSWER_MODALITIES
# and nothing else. Spoken answers are `voice`. Restated here rather than
# guessed: the DTO's comment says "the vocabulary is the engine's
# ANSWER_MODALITIES and nowhere else".
MODALITY_VOICE = "voice"

# SubmitTurnDto caps `text` at 4000 characters. A minute of speech does not
# reach it, but a stuck VAD holding the mic open might, and a 400 from
# class-validator is a worse failure than a truncation we chose.
MAX_TURN_TEXT = 4000


@dataclass
class NextQuestion:
    field_path: str
    section: str
    label: str
    kind: str
    prompt: str
    remaining: int
    choices: list[str] = field(default_factory=list)


@dataclass
class TurnResult:
    turn_id: str
    session_id: str
    next_question: NextQuestion | None
    interview_status: str
    patient_message: str | None
    red_flags: list[dict[str, Any]]
    server_time_ms: float
    accepted: dict[str, Any]
    raw: dict[str, Any]
    # Only `GET /sessions/:id` carries these. The session knows which language
    # the patient speaks and which one the questions are written in, and they
    # are not always the same — `describeSession` returns `inputLanguage` and
    # `outputLanguage` separately for exactly that reason. Speaking a Hindi
    # question through the English voice because an env var said `en` is the
    # substitution this whole system is built to refuse.
    input_language: str | None = None
    output_language: str | None = None

    @property
    def finished(self) -> bool:
        """No next question. The interview is over or is waiting on something.

        Deliberately derived from `nextQuestion is null` rather than from
        `interviewStatus`, because the status vocabulary belongs to the engine
        and this worker should not hold a copy of it that can go stale. If
        there is no question, there is nothing for a voice agent to ask.
        """
        return self.next_question is None

    @staticmethod
    def from_payload(payload: dict) -> "TurnResult":
        # Nest wraps *every* successful response before it reaches the wire.
        #
        # `src/common/interceptors/response.interceptor.ts` is registered
        # globally in `app.module.ts`, so what actually arrives is
        #
        #   {"success": true, "message": "...", "data": {...},
        #    "timestamp": "...", "path": "/api/..."}
        #
        # and every field this worker reads — `nextQuestion`, `turnId`,
        # `interviewStatus`, `inputLanguage` — is one level down inside `data`.
        # Reading them off the top level returns None for all of them, which
        # presents as an agent that joins the room, posts every turn correctly,
        # and never says a single word: `next_question` is None, so
        # [utterances] is empty and there is nothing to speak.
        #
        # tools/fake_engine.py answers unwrapped, which is exactly why this
        # survived the build. The unwrap is therefore conditional rather than
        # unconditional — both shapes have to keep working — and the condition
        # is the interceptor's own `isApiResponse` test rather than a bare
        # `"data" in payload`, so a future turn payload that legitimately
        # carries a `data` field is not mistaken for an envelope.
        payload = _unwrap(payload)

        # Two routes, two names for the same `NextQuestionView`.
        #
        # `POST /turns` answers with `nextQuestion`: the question *after* the
        # one just answered. `GET /sessions/:id` answers with
        # `currentQuestion`, and its comment says why the names differ — it is
        # read "off the turn log, not the selector: the selector skips what is
        # pending, so re-running it here would hand back the question *after*
        # the one the patient is looking at."
        #
        # Reading only `nextQuestion` made the opening question silently null on
        # every real session, because the agent asks for it with the GET. The
        # stub in tools/fake_engine.py answered `nextQuestion` on both routes
        # and so did not catch it; the shape here is taken from
        # `describeSession` in case-taking.service.ts.
        q = payload.get("nextQuestion") or payload.get("currentQuestion")
        next_question = (
            NextQuestion(
                field_path=str(q.get("fieldPath") or ""),
                section=str(q.get("section") or ""),
                label=str(q.get("label") or ""),
                kind=str(q.get("kind") or ""),
                prompt=str(q.get("prompt") or ""),
                remaining=int(q.get("remaining") or 0),
                choices=[str(c) for c in (q.get("choices") or [])],
            )
            if isinstance(q, dict)
            else None
        )
        message = payload.get("patientMessage")
        return TurnResult(
            turn_id=str(payload.get("turnId") or ""),
            session_id=str(payload.get("sessionId") or ""),
            next_question=next_question,
            interview_status=str(payload.get("interviewStatus") or ""),
            patient_message=message if isinstance(message, str) and message.strip() else None,
            red_flags=list(payload.get("redFlags") or []),
            server_time_ms=float(payload.get("serverTimeMs") or 0.0),
            accepted=dict(payload.get("accepted") or {}),
            raw=payload,
            input_language=_language(payload, "inputLanguage"),
            output_language=_language(payload, "outputLanguage"),
        )


def utterances(result: TurnResult) -> list[str]:
    """What to say, in the order the engine put it in.

    Severity first. `patientMessage` comes from the most severe triggered rule
    and is a routing instruction; the next question comes after it. If a patient
    stops listening after one sentence, that sentence should be the one that
    sends them to the front desk.
    """
    out: list[str] = []
    if result.patient_message:
        out.append(result.patient_message)
    if result.next_question and result.next_question.prompt.strip():
        out.append(result.next_question.prompt.strip())
    return out


class EngineRejected(Exception):
    """The engine said no — a 4xx. Final; not retried."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(f"turn rejected ({status}): {detail}")
        self.status = status
        self.detail = detail


class EngineUnavailable(Exception):
    """Nest did not answer, or answered 5xx. Operational."""


class CaseTakingClient:
    def __init__(self, base_url: str, token: str, *, timeout: float = 15.0) -> None:
        self._base = base_url.rstrip("/")
        self._token = token
        self._client = async_client(timeout)

    async def aclose(self) -> None:
        await self._client.aclose()

    @property
    def has_token(self) -> bool:
        return bool(self._token)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }

    async def submit_turn(
        self,
        session_id: str,
        *,
        text: str,
        field_path: str | None = None,
        modality: str = MODALITY_VOICE,
        transcript_confidence: float | None = None,
        audio_key: str | None = None,
    ) -> TurnResult:
        body: dict[str, Any] = {"modality": modality}
        if text:
            # Verbatim. The DTO says "What they said or typed, verbatim. Never
            # normalised." Whisper's output is already the patient's words as
            # far as this system is concerned; tidying it here would put a
            # second transcription in the clinical record.
            body["text"] = text[:MAX_TURN_TEXT]
        if field_path:
            body["fieldPath"] = field_path
        if transcript_confidence is not None:
            # Clamped, not rounded away: the DTO validates 0 <= x <= 1 and a
            # float that arrives at 1.0000001 from exp(avg_logprob) would be a
            # 400 on an otherwise good turn.
            body["transcriptConfidence"] = max(0.0, min(1.0, float(transcript_confidence)))
        if audio_key:
            body["audioKey"] = audio_key

        url = f"{self._base}/case-taking/sessions/{session_id}/turns"
        # Hop 4. The gap between this span and the `serverTimeMs` the engine
        # reports for itself is Nest's own overhead — guards, validation pipes,
        # the JSON envelope and the loopback socket — and is worth seeing apart
        # from the engine, because only one of the two is this worker's problem.
        started = timing.mark("turn.http_start", chars=len(text or ""))
        try:
            response = await self._client.post(url, json=body, headers=self._headers())
        except httpx.HTTPError as exc:
            timing.span("turn.http_error", started, error=str(exc)[:120])
            raise EngineUnavailable(f"{url} unreachable: {exc}") from exc
        timing.span("turn.http_end", started, status=response.status_code)

        if 400 <= response.status_code < 500:
            raise EngineRejected(response.status_code, _detail(response))
        if response.status_code >= 500:
            raise EngineUnavailable(f"{url} returned {response.status_code}")

        result = TurnResult.from_payload(response.json())
        timing.mark(
            "turn.parsed",
            server_ms=result.server_time_ms,
            has_question=result.next_question is not None,
            prompt_chars=len(result.next_question.prompt) if result.next_question else 0,
            message_chars=len(result.patient_message or ""),
        )
        return result

    async def current_question(self, session_id: str) -> TurnResult | None:
        """The question already on the table, for the opening turn.

        `GET sessions/:id` returns the session including whatever question the
        engine is waiting on. The agent asks that rather than inventing an
        opener, because the engine may be mid-interview — a patient who
        reconnects should hear the question they were on, not the first one.
        """
        url = f"{self._base}/case-taking/sessions/{session_id}"
        started = timing.mark("session.http_start")
        try:
            response = await self._client.get(url, headers=self._headers())
        except httpx.HTTPError as exc:
            timing.span("session.http_error", started, error=str(exc)[:120])
            raise EngineUnavailable(f"{url} unreachable: {exc}") from exc
        timing.span("session.http_end", started, status=response.status_code)
        if response.status_code >= 400:
            raise EngineUnavailable(f"{url} returned {response.status_code}")
        return TurnResult.from_payload(response.json())


def _unwrap(payload: dict) -> dict:
    """The body inside Nest's standard envelope, or the body as given.

    Mirrors `ResponseInterceptor.isApiResponse`: it stamps `success` and
    `timestamp` onto everything it wraps and passes through anything that
    already has both. Testing for the same two keys — rather than for `data`
    alone — is what keeps an unwrapped payload that happens to contain a `data`
    field from being unwrapped into it.

    Error bodies are *not* unwrapped: they carry `success: false` with `message`
    and `errors` at the top level and no `data` at all. `_detail` reads them
    where they are.
    """
    if not isinstance(payload, dict):
        return {}
    if "success" in payload and "timestamp" in payload:
        inner = payload.get("data")
        if isinstance(inner, dict):
            return inner
    return payload


def _language(payload: dict, key: str) -> str | None:
    value = payload.get(key) or payload.get("language")
    return str(value).strip() or None if value else None


def _detail(response: httpx.Response) -> str:
    """The most specific thing the server said, for a log line and /health.

    Nest's error shape puts a human sentence in `message` and the per-field
    reasons in `errors` ({"modality": ["modality must be one of ..."]}). The
    sentence alone is "Validation failed", which does not tell an operator
    which field the worker got wrong, so both are reported when both exist.
    """
    try:
        payload = response.json()
    except Exception:
        return response.text[:300]
    if not isinstance(payload, dict):
        return str(payload)[:300]

    detail = payload.get("message") or payload.get("detail")
    if isinstance(detail, list):
        detail = "; ".join(str(d) for d in detail)
    detail = str(detail) if detail else ""

    errors = payload.get("errors")
    if isinstance(errors, dict) and errors:
        fields = "; ".join(
            f"{name}: {', '.join(str(m) for m in msgs) if isinstance(msgs, list) else msgs}"
            for name, msgs in errors.items()
        )
        detail = f"{detail} ({fields})" if detail else fields

    return (detail or str(payload))[:300]
