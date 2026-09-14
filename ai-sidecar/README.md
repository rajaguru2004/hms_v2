# MediHive AI sidecar

Speech-to-text, text-to-speech and OCR for the patient case-taking feature.
The Nest API calls it; nothing else should.

It is a separate process because these are Python model runtimes with their own
interpreter and their own failure modes. A wedged model should not take the
hospital API down with it.

## What it does not do

It makes no clinical decision. It transcribes, it reads, it speaks, and it
reports a confidence. Every judgement built on those outputs — what a fact
means, whether it is a red flag, whether it may touch a patient record — belongs
to the engine in `hms_v2/src/modules/case-taking/`.

## Setup

Python **3.12**, in a venv, always. The host interpreter is 3.14 and several of
these runtimes publish no wheel for it; `paddlepaddle` is the reason the spec's
PaddleOCR became RapidOCR on onnxruntime, which is the same PP-OCRv5 models.

```sh
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
./run.sh
```

Voices for TTS are downloaded separately into `voices/` (about 60 MB each) and
are not in git. Without them `/health` reports `tts: false` and the app reads
questions on screen instead of speaking them — a degradation, not a failure.

## Contract

```
GET  /health  → {ollama, ollamaModels[], stt, tts, ocr}
POST /stt     multipart file + language?  → {text, confidence, language, segments[], durationMs}
POST /tts     {text, language}            → audio/wav
POST /ocr     multipart file (image|pdf)  → {pageCount, pages:[{text, meanConfidence, blocks[]}]}
```

Uploads are capped at 10 MB, matching what the mobile client refuses before it
sends. Errors come back as written sentences, because they are shown to a
patient: "We couldn't read this document clearly", never `PP-OCR inference
exception`.

## Environment

| Variable                | Default                  | Why you would change it                         |
| ----------------------- | ------------------------ | ----------------------------------------------- |
| `OLLAMA_URL`            | `http://127.0.0.1:11434` | Ollama elsewhere on the host                    |
| `MEDIHIVE_SIDECAR_PORT` | `8801`                   | Port clash                                      |
| `MEDIHIVE_STT_MODEL`    | `small`                  | `medium` for Indian languages — benchmark first |
| `MEDIHIVE_STT_DEVICE`   | `cpu`                    | The GPU is holding gemma3:4b; leave it there    |
| `MEDIHIVE_VOICE_DIR`    | `./voices`               | Voices kept with the deployment                 |
