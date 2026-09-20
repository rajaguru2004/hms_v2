"""MediHive AI sidecar.

Three capabilities the Nest API cannot host itself, behind one HTTP contract:
speech to text, text to speech, and OCR. Nest owns every clinical decision;
this service owns none of them. It reads, it writes, it transcribes, and it
reports how confident it is — which is the number the rest of the system uses
to decide whether a human has to look.

It is a separate process because these are Python model runtimes with their own
interpreter and their own lifecycle, and because a model that wedges should not
take the hospital API down with it.

Start it with `run.ps1` (or `run.sh`), never with a bare uvicorn line. The
launcher sets the environment this service depends on — `OLLAMA_URL`, the voice
directory, the STT device — and the defaults in this file are *not* a working
configuration on their own. `OLLAMA_URL` is the one that bites: Ollama runs on
**8080** on this deployment and the default below is Ollama's stock 11434, so a
bare `uvicorn main:app` starts cleanly, serves speech correctly, and reports
`"ollama": false` forever while the background translation path quietly has no
model. It also pays ~320 ms per `/health` on the failed probe.

    .\run.ps1
"""

from __future__ import annotations

import logging
import os
import tempfile
import threading
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

import ocr
import stt
import tts

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")

# uvicorn configures handlers for its own loggers and leaves the root logger
# without one, so everything this service logs about itself — which voice
# loaded, how long a synthesis took, which reference pair is half-supplied —
# went nowhere below WARNING. Those lines are the only evidence that a language
# is being refused rather than substituted, which makes them worth a handler.
logging.basicConfig(
    level=os.environ.get("MEDIHIVE_LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)

# Refusing a file here rather than after a 40-second OCR pass is the difference
# between a written answer and a spinner. Mirrors the 10 MB the mobile client
# already enforces before it uploads.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

# The cap on one `/tts` request. Roughly 2000 characters is a couple of minutes
# of speech and about 5 MB of WAV, which stays under MAX_UPLOAD_BYTES above —
# the same ceiling this service applies to what it accepts, applied to what it
# produces. A caller with more to say sends it a sentence at a time.
MAX_SPEAK_CHARS = 2000

ACCEPTED_DOCUMENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "application/pdf",
}

app = FastAPI(title="MediHive AI sidecar", version="1.0.0")


@app.on_event("startup")
async def _prewarm_stt() -> None:
    """Load Whisper before the first patient speaks, not during.

    Whisper is lazily loaded, so without this the first `/stt` of the day pays
    model load plus a first decode that is itself slower than every subsequent
    one — about 5.8 s on CUDA against 0.21 s warm. That cost landed on the
    first answer of an interview, which is the worst place in the session to
    spend six seconds.

    On a thread, so uvicorn finishes binding and `/health` answers immediately;
    a caller that races it gets `sttConfig.loaded: false` and a slow first
    request, which is exactly the old behaviour. `MEDIHIVE_STT_PREWARM=0` opts
    out on a box where the memory matters more than the first turn.
    """
    if not stt.prewarm_enabled() or not stt.available():
        return
    threading.Thread(target=stt.warm, name="stt-prewarm", daemon=True).start()


@app.on_event("startup")
async def _prewarm_tts() -> None:
    """Load IndicF5 before the first patient taps the speaker, not during.

    The same argument as `_prewarm_stt`, with a sharper edge. IndicF5's
    weights are ~1.4 GB and the vocoder is fetched beside them, so a cold
    first `/tts` can take longer than the API's 30 s TTS timeout on its own -
    and what the patient gets for a question that was perfectly speakable is
    the silent written fallback, with nothing on screen to say why.

    Piper does not implement `warm` and is not affected; on a box without
    IndicF5 installed this does nothing at all. `MEDIHIVE_TTS_PREWARM=0` opts
    out where the memory matters more than the first question.
    """
    if os.environ.get("MEDIHIVE_TTS_PREWARM", "1").strip() in {"0", "false", "no"}:
        return
    threading.Thread(target=tts.warm, name="tts-prewarm", daemon=True).start()


@app.get("/health")
async def health() -> JSONResponse:
    """What can actually run right now.

    Answers per capability rather than as one boolean, because the degradations
    are different: no OCR means documents wait, no TTS means the question is
    read instead of heard, no Ollama means plainer questions. Only one of those
    is worth telling the patient about.
    """
    ollama_up = False
    models: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(f"{OLLAMA_URL}/api/tags")
            ollama_up = response.status_code == 200
            if ollama_up:
                models = [m["name"] for m in response.json().get("models", [])]
    except Exception as error:
        # Named, at WARNING, with the URL it tried.
        #
        # A silent `false` here reads as "Ollama is down" when the commonest
        # cause is this service looking at the wrong port — 11434 is Ollama's
        # stock default and this deployment runs it on 8080, so a sidecar
        # started without `run.ps1` probes an address nothing is listening on
        # and says so in a way indistinguishable from a real outage.
        ollama_up = False
        logging.getLogger(__name__).warning(
            "ollama probe failed at %s (%s) — background translation has no model",
            OLLAMA_URL,
            type(error).__name__,
        )

    return JSONResponse(
        {
            "ollama": ollama_up,
            "ollamaModels": models,
            "stt": stt.available(),
            # Every configured language some engine can actually hear. Odia is
            # missing from it and always will be until an engine other than
            # Whisper is plugged into `stt.STTProvider` — see stt.py.
            "sttLanguages": stt.languages(),
            # Which model, on which device, with which decode settings. The
            # device is resolved at load time and can fall back — a box whose
            # CUDA libraries are missing transcribes on the CPU rather than
            # refusing to start, and this is the only place that difference is
            # visible without reading an old log line. It is the first thing to
            # check when transcription is suddenly seconds slower.
            "sttConfig": stt.describe(),
            "tts": tts.available("en"),
            # Which languages can actually be spoken, not just whether English
            # can. One boolean computed for English said `tts: true` while
            # Tamil was missing, so a caller had no way to discover a language
            # was unavailable except by requesting it and reading the 503.
            "ttsLanguages": tts.languages(),
            # Per provider, and per language across providers. The health check
            # a human reads at 2am has to answer "why is Tamil not available"
            # as well as "is it", and those are different failures with the
            # same symptom: IndicF5 not installed, no reference audio for `ta`,
            # or a voice directory that is not mounted. `detail` names which.
            "ttsProviders": tts.provider_status(),
            "languages": _languages(),
            "ocr": ocr.available(),
        }
    )


def _languages() -> dict[str, dict]:
    """Per language: can it be spoken, can it be heard, and by what.

    Merged here because this is the only layer that owns both halves — `tts`
    knows nothing about Whisper and `stt` knows nothing about reference audio.
    Both keys always exist, so a caller deciding whether to offer a microphone
    or a speaker reads one row rather than intersecting two lists.

    Odia is the row this shape exists for: `tts: true` once its reference pair
    is in place, `stt: false` permanently, because faster-whisper has 100
    languages and `or` is not one of them. Dropping it would have meant a
    language nobody can be asked a question in; flattening the two into one
    boolean would have meant the same.
    """
    audible = set(stt.languages())
    return {
        code: {**row, "stt": code in audible}
        for code, row in tts.availability().items()
    }


async def _read_upload(upload: UploadFile) -> bytes:
    data = await upload.read()
    if not data:
        raise HTTPException(status_code=400, detail="The uploaded file was empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Files must be under {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
        )
    return data


@app.post("/stt")
async def speech_to_text(
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
) -> JSONResponse:
    if not stt.available():
        raise HTTPException(status_code=503, detail="Speech recognition is unavailable.")

    data = await _read_upload(file)

    # faster-whisper reads a path, and the decoder wants a real file to seek in.
    # Written to a temp file and deleted in `finally` — this is patient speech.
    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    handle = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        handle.write(data)
        handle.close()
        return JSONResponse(stt.transcribe(handle.name, language=language))
    except HTTPException:
        raise
    except stt.LanguageNotSupported as refusal:
        # A language this service is configured for that no installed engine
        # can hear — Odia today, and only Odia. It gets its own sentence rather
        # than the generic one below because the patient's next move is
        # different: retrying the recording will never work, and typing will.
        #
        # 400 for the same reason as the generic handler: a 5xx here counts
        # against the circuit breaker STT shares with OCR, and one Odia session
        # would edge document reading towards being switched off for everybody.
        logging.getLogger(__name__).info(
            "refused transcription in %s: no engine", refusal.language
        )
        raise HTTPException(status_code=400, detail=refusal.patient_message)
    except Exception:
        # Everything reaching here is "we could not read that recording", and
        # the caller is a patient. Without this, a truncated upload, a codec the
        # phone chose that PyAV will not open, or a language code Whisper does
        # not know all escaped as a bare 500 with the body `Internal Server
        # Error` — a stack trace's worth of nothing, in plain text, on a route
        # documented to answer in written sentences.
        #
        # 400 rather than 500 on purpose: the recording is the problem, not the
        # service, and the Nest client is written to read a 4xx as "carry on
        # with the keyboard" while a 5xx counts against the circuit breaker
        # that STT and OCR share.
        logging.getLogger(__name__).exception("transcription failed")
        raise HTTPException(
            status_code=400,
            detail="We could not use that recording. Please try again, or type your answer.",
        )
    finally:
        os.unlink(handle.name)


class SpeakRequest(BaseModel):
    text: str
    language: str = "en"


@app.post("/tts")
async def text_to_speech(request: SpeakRequest) -> Response:
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="There was nothing to say.")
    if len(request.text) > MAX_SPEAK_CHARS:
        # Uncapped, this route would synthesise whatever it was given: 4480
        # characters produced an 11.5 MB WAV, larger than the 10 MB this same
        # service refuses on the way *in*, after 23 seconds of CPU. A model
        # summary of a few paragraphs reaches that on its own.
        raise HTTPException(
            status_code=400,
            detail="That is too long to read aloud in one go.",
        )
    if not tts.available(request.language):
        # 503 and a written sentence, for every language with no voice on this
        # box — including a language code that means nothing at all. The one
        # answer this route may never give is somebody else's language at 200.
        raise HTTPException(status_code=503, detail="This voice is unavailable.")
    try:
        audio, provider = tts.speak_with_provider(request.text, request.language)
    except Exception:
        # Every engine that claimed this language has failed. The patient gets
        # the same sentence as a language with no voice at all, because from
        # the screen they are the same thing: the question is there to be read.
        # Without this the failure left as a bare 500 and the body `Internal
        # Server Error`, on a route documented to answer in written sentences.
        logging.getLogger(__name__).exception(
            "synthesis failed for %s", tts.normalise(request.language)
        )
        raise HTTPException(status_code=503, detail="This voice is unavailable.")
    return Response(
        content=audio,
        media_type="audio/wav",
        # Which engine actually spoke, on the response itself. The incident
        # behind this package was a Tamil request served by the English voice,
        # and nothing in the response said so — there was no way to tell from
        # the outside, which is what let it run. One header makes it checkable
        # from curl, from the phone, and from a log of either.
        headers={"X-TTS-Provider": provider, "X-TTS-Language": tts.normalise(request.language)},
    )


@app.post("/ocr")
async def read_document(file: UploadFile = File(...)) -> JSONResponse:
    if not ocr.available():
        raise HTTPException(status_code=503, detail="Document reading is unavailable.")

    content_type = (file.content_type or "").lower()
    if content_type and content_type not in ACCEPTED_DOCUMENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail="That file type cannot be read. Upload a photo or a PDF.",
        )

    data = await _read_upload(file)
    pages = ocr.read(data, content_type)

    return JSONResponse(
        {
            "pageCount": len(pages),
            "pages": [
                {
                    "text": page.text,
                    "meanConfidence": round(page.mean_confidence, 4),
                    "blocks": page.blocks,
                }
                for page in pages
            ],
        }
    )
