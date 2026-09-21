"""The only place this worker talks to a model, and it does so over HTTP.

## Why HTTP rather than importing ai-sidecar/stt.py

Both were on the table. The deciding numbers:

  * `WhisperModel("small", compute_type="int8")` is roughly 250-500 MB resident.
    Importing `stt.py` here would load a **second** copy into this process,
    because the sidecar's copy lives in the uvicorn process and Python does not
    share model weights across processes. This box has been running at 1-3 GB
    free. A second Whisper is the most expensive thing this worker could do.
  * The loopback round trip costs a WAV body: a 5-second utterance at 16 kHz
    mono int16 is 160 KB, which is sub-millisecond on 127.0.0.1 against a
    Whisper decode measured in hundreds of milliseconds. The transport is noise
    in that budget.
  * The Odia refusal, the confidence calculation and the `/health` language
    table all live behind the same routes. Importing the module would give this
    worker its own opinion about which languages are available, and two
    opinions is how `/health` came to claim a language the voice table had
    never heard of — the mistake ai-sidecar/stt.py's own docstring records.

So: one model instance, one warm cache, one place where the language policy is
decided. This file is a client, and it is careful to pass the refusals through
rather than interpret them.

## The refusals, which are the point

`/stt` answers **400** for Odia with a sentence written for a patient. There is
no Whisper model for `or`; retrying will never work and typing will. That 400
must not be retried and must not be turned into an auto-detect, which would
return a fluent Hindi transcript labelled Odia at HTTP 200.

`/tts` answers **503** for every language Piper has no voice for — which today
is whatever has no voice file on disk. That must not be substituted with
another language. The set is not fixed and is not this file's to know: Piper
rescans its voices directory per request, so Tamil arrived by somebody copying
`ta_IN-ValluvarNeural-medium.onnx` into it. `/health` names the current set;
anything not in it 503s.

The incident the sidecar's own comment records is a Tamil request served by the
English voice, from before it had a Tamil one. The correct behaviour here when
TTS refuses is to publish the question as text into the room and say nothing:
the question is there to be read.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

import timing
from httpclient import async_client

logger = logging.getLogger(__name__)


class SidecarRefusal(Exception):
    """The sidecar declined, on purpose, with something to show the patient.

    Distinct from a transport failure because the responses differ: a refusal
    is final and has a sentence attached, a transport failure is worth one
    retry and has nothing to say to anybody but an operator.
    """

    def __init__(self, status: int, patient_message: str) -> None:
        super().__init__(f"sidecar refused ({status}): {patient_message}")
        self.status = status
        self.patient_message = patient_message


class SidecarUnavailable(Exception):
    """The sidecar did not answer. Operational, not clinical."""


@dataclass
class Transcript:
    text: str
    confidence: float
    language: str
    language_confidence: float
    duration_ms: int

    @staticmethod
    def from_payload(payload: dict) -> "Transcript":
        return Transcript(
            text=(payload.get("text") or "").strip(),
            # The sidecar exponentiates Whisper's average log-probability into a
            # 0-1 number. It is passed to the engine as `transcriptConfidence`
            # verbatim: it is a real measurement and the engine is entitled to
            # distrust a transcript on it.
            confidence=float(payload.get("confidence") or 0.0),
            language=str(payload.get("language") or ""),
            language_confidence=float(payload.get("languageConfidence") or 0.0),
            duration_ms=int(payload.get("durationMs") or 0),
        )


class SidecarClient:
    """Speech in and speech out, over loopback.

    One `httpx.AsyncClient` held open for the life of the worker. Reconnecting
    per utterance would add a TCP handshake to every turn for no benefit; the
    sidecar is a single uvicorn on the same machine.
    """

    def __init__(
        self,
        base_url: str,
        *,
        stt_timeout: float = 60.0,
        tts_timeout: float = 60.0,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._stt_timeout = stt_timeout
        self._tts_timeout = tts_timeout
        # Built with a preloaded SSL context; see httpclient.py.
        self._client = async_client(stt_timeout)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def health(self) -> dict:
        try:
            response = await self._client.get(f"{self._base}/health", timeout=5.0)
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            raise SidecarUnavailable(str(exc)) from exc

    async def transcribe(self, wav: bytes, language: str | None) -> Transcript:
        """One utterance, 16 kHz mono WAV in.

        `language` is passed through rather than dropped. Dropping it lets
        Whisper auto-detect, which is the right default for a patient who
        code-switches but the wrong one for a session whose language is already
        known — and for Odia it is actively dangerous, because auto-detect
        answers in Hindi or Bengali at HTTP 200 rather than refusing.
        """
        if not wav:
            return Transcript("", 0.0, language or "", 0.0, 0)

        files = {"file": ("utterance.wav", wav, "audio/wav")}
        data = {"language": language} if language else {}
        # Hop 3 of the turn budget. The body crosses loopback, so everything
        # between these two marks that is not Whisper is a memcpy: see
        # tools/bench_sidecar.py, which measures the fixed HTTP overhead on the
        # same socket with a /health request so the decode can be reported
        # without it.
        started = timing.mark("stt.http_start", bytes=len(wav), language=language or "")
        try:
            response = await self._client.post(
                f"{self._base}/stt",
                files=files,
                data=data,
                timeout=self._stt_timeout,
            )
        except httpx.HTTPError as exc:
            timing.span("stt.http_error", started, error=str(exc)[:120])
            raise SidecarUnavailable(f"/stt unreachable: {exc}") from exc
        timing.span("stt.http_end", started, status=response.status_code, bytes=len(wav))

        if response.status_code == 400:
            # Odia, an unreadable recording, or a codec the phone chose that
            # PyAV will not open. All three arrive as 400 with a sentence the
            # patient can act on, and all three mean "do not retry this audio".
            raise SidecarRefusal(400, _detail(response, "We could not use that recording."))
        if response.status_code == 503:
            raise SidecarUnavailable("speech recognition is unavailable")
        if response.status_code >= 400:
            raise SidecarUnavailable(f"/stt returned {response.status_code}")

        parsed = Transcript.from_payload(response.json())
        timing.mark(
            "stt.parsed",
            chars=len(parsed.text),
            audio_ms=parsed.duration_ms,
            confidence=round(parsed.confidence, 3),
        )
        return parsed

    async def speak(self, text: str, language: str) -> tuple[bytes, str]:
        """WAV at the voice's native rate, plus which engine actually spoke.

        The `X-TTS-Provider` header exists precisely so a caller can check that
        it was not quietly served by another language's voice. It is returned
        here and logged, rather than discarded, for the same reason it was
        added: from the outside there was previously no way to tell.
        """
        payload = {"text": text, "language": language}
        # Hop 5. Piper's synthesis time scales with the character count, so the
        # count is recorded alongside the duration: a budget that reports only
        # the milliseconds cannot tell a slow synthesiser from a long question.
        started = timing.mark("tts.http_start", chars=len(text), language=language)
        try:
            response = await self._client.post(
                f"{self._base}/tts", json=payload, timeout=self._tts_timeout
            )
        except httpx.HTTPError as exc:
            timing.span("tts.http_error", started, error=str(exc)[:120])
            raise SidecarUnavailable(f"/tts unreachable: {exc}") from exc
        timing.span(
            "tts.http_end",
            started,
            status=response.status_code,
            chars=len(text),
            bytes=len(response.content),
        )

        if response.status_code == 503:
            # No voice for this language — see the note at the top of this
            # file for why the set is asked for rather than listed here.
            # NOT substituted; the caller displays the text instead.
            raise SidecarRefusal(503, _detail(response, "This voice is unavailable."))
        if response.status_code == 400:
            raise SidecarRefusal(400, _detail(response, "There was nothing to say."))
        if response.status_code >= 400:
            raise SidecarUnavailable(f"/tts returned {response.status_code}")

        provider = response.headers.get("X-TTS-Provider", "unknown")
        spoken_language = response.headers.get("X-TTS-Language", language)
        if spoken_language and spoken_language != language:
            # Should be impossible — the route refuses rather than substitutes —
            # but this is the exact failure the header was added to make
            # visible, so it is checked rather than trusted.
            logger.error(
                "sidecar answered %s in %s; refusing to play it",
                language,
                spoken_language,
            )
            raise SidecarRefusal(503, "This voice is unavailable.")
        return response.content, provider


def _detail(response: httpx.Response, fallback: str) -> str:
    """FastAPI's `{"detail": "..."}`, or the fallback if it is shaped otherwise."""
    try:
        detail = response.json().get("detail")
    except Exception:
        return fallback
    if isinstance(detail, str) and detail.strip():
        return detail.strip()
    return fallback


# The sidecar's `MAX_SPEAK_CHARS`. Restated rather than imported because this
# venv deliberately cannot import the sidecar's modules; kept here next to the
# only code that cares so the two can be compared.
MAX_SPEAK_CHARS = 2000


def split_for_speech(text: str, *, max_chars: int = 400) -> list[str]:
    """One question into pieces the sidecar will accept, split at sentences.

    Chunks are kept as large as they can be. Every seam between two chunks is a
    join between two separately synthesised WAVs, and Piper starts and ends each
    one with a little silence, so more chunks means a more stilted question. The
    engine's prompts are single questions and almost always come back as one
    chunk; this exists for the red-flag `patientMessage`, which can be longer.
    """
    text = " ".join((text or "").split())
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    pieces: list[str] = []
    current = ""
    # Split after sentence-ending punctuation, keeping the punctuation. Devanagari
    # danda included because Hindi is one of the two languages Piper can speak.
    import re

    for sentence in re.split(r"(?<=[.!?।])\s+", text):
        if not sentence:
            continue
        if current and len(current) + 1 + len(sentence) > max_chars:
            pieces.append(current)
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        pieces.append(current)

    # A single sentence longer than max_chars still has to be broken; do it at
    # word boundaries rather than mid-word.
    out: list[str] = []
    for piece in pieces:
        while len(piece) > max_chars:
            cut = piece.rfind(" ", 0, max_chars)
            cut = cut if cut > 0 else max_chars
            out.append(piece[:cut].strip())
            piece = piece[cut:].strip()
        if piece:
            out.append(piece)
    return out
