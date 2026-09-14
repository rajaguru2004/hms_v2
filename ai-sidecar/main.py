"""MediHive AI sidecar.

Three capabilities the Nest API cannot host itself, behind one HTTP contract:
speech to text, text to speech, and OCR. Nest owns every clinical decision;
this service owns none of them. It reads, it writes, it transcribes, and it
reports how confident it is — which is the number the rest of the system uses
to decide whether a human has to look.

It is a separate process because these are Python model runtimes with their own
interpreter and their own lifecycle, and because a model that wedges should not
take the hospital API down with it.

    uvicorn main:app --host 127.0.0.1 --port 8801
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

import ocr
import stt
import tts

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")

# Refusing a file here rather than after a 40-second OCR pass is the difference
# between a written answer and a spinner. Mirrors the 10 MB the mobile client
# already enforces before it uploads.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

ACCEPTED_DOCUMENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "application/pdf",
}

app = FastAPI(title="MediHive AI sidecar", version="1.0.0")


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
    except Exception:
        ollama_up = False

    return JSONResponse(
        {
            "ollama": ollama_up,
            "ollamaModels": models,
            "stt": stt.available(),
            "tts": tts.available("en"),
            "ocr": ocr.available(),
        }
    )


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
    finally:
        os.unlink(handle.name)


class SpeakRequest(BaseModel):
    text: str
    language: str = "en"


@app.post("/tts")
async def text_to_speech(request: SpeakRequest) -> Response:
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="There was nothing to say.")
    if not tts.available(request.language):
        raise HTTPException(status_code=503, detail="This voice is unavailable.")
    return Response(
        content=tts.speak(request.text, request.language),
        media_type="audio/wav",
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
