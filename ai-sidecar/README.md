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

## Languages

`tts/language_config.py` is the single source of truth: twelve languages, the
eleven IndicF5 covers plus English. Everything that needs to know whether a
language exists asks it, speech in and speech out alike, so there is no second
list to drift.

Speaking goes through a provider chain, `tts/config.yaml` `providers.order`:

```
IndicF5  →  Piper  →  503 and a written sentence
```

Each provider is asked whether it can do the language _before_ anything is
loaded, and the first yes speaks. **A provider that cannot do a language says
so; nothing ever substitutes another language.** That is not a preference: the
code this replaced resolved an unknown code to the English voice, so a Tamil
question was read aloud in English at HTTP 200 with nothing in the logs. A
patient cannot tell a wrong-language question from their own hearing. They can
tell silence. `X-TTS-Provider` on every `/tts` response says which engine
actually spoke.

- **IndicF5** (`ai4bharat/IndicF5`) — as bn gu hi kn ml mr or pa ta te. Needs
  torch and transformers, which are **not** in requirements.txt, and a
  reference pair per language in `tts/voices/<code>/`. Missing either, it
  reports itself unavailable and the chain falls through. `tts/voices/README.md`
  is the contract for a reference pair.
- **Piper** — fallback, and the only English voice here. Reads `.onnx` voices
  out of `MEDIHIVE_VOICE_DIR`, discovering them by filename, so dropping
  `xx_YY-speaker-medium.onnx` in adds a language with no restart.

Hearing is faster-whisper, and it covers ten of the eleven. **Odia is not in
Whisper's 100 languages**, so `POST /stt {"language":"or"}` is refused by name
with a sentence a patient can act on, rather than returning a fluent Hindi
transcript labelled Odia. `stt.STTProvider` is the seam an engine that does
cover Odia plugs into. `/health` reports it as `tts: true, stt: false` once its
reference pair exists.

## Contract

```
GET  /health  → {ollama, ollamaModels[], stt, sttLanguages[], tts, ttsLanguages[],
                 ttsProviders[], languages{}, ocr}
POST /stt     multipart file + language?  → {text, confidence, language, segments[], durationMs}
POST /tts     {text, language}            → audio/wav + X-TTS-Provider
POST /ocr     multipart file (image|pdf)  → {pageCount, pages:[{text, meanConfidence, blocks[]}]}
```

`/health`'s `languages` is one row per configured language and is the only
place that answers "why is Tamil unavailable" rather than just "is it":

```jsonc
"languages": {
  "ta": {
    "name": "தமிழ்", "englishName": "Tamil",
    "preferred": "indicf5",      // who should speak it
    "provider": null,            // who actually would, right now
    "available": false,          // → POST /tts answers 503
    "providers": {"indicf5": false, "piper": false},
    "stt": true                  // Whisper can hear it
  }
}
```

`ttsProviders` carries each provider's own answer, including why not —
`not installed: torch, transformers`, or a per-language `problems` map naming
the reference file that is missing or unreadable.

`ttsLanguages`, `tts`, and every existing field keep their shape: the Flutter
build on a real phone and `src/modules/ai/sidecar.client.ts` both read this
response today.

Uploads are capped at 10 MB, matching what the mobile client refuses before it
sends. Errors come back as written sentences, because they are shown to a
patient: "We couldn't read this document clearly", never `PP-OCR inference
exception`.

## Environment

| Variable                     | Default                  | Why you would change it                                           |
| ---------------------------- | ------------------------ | ----------------------------------------------------------------- |
| `OLLAMA_URL`                 | `http://127.0.0.1:11434` | Ollama elsewhere on the host                                      |
| `MEDIHIVE_SIDECAR_PORT`      | `8801`                   | Port clash                                                        |
| `MEDIHIVE_STT_MODEL`         | `small`                  | `medium` for Indian languages — benchmark first                   |
| `MEDIHIVE_STT_DEVICE`        | `cpu`                    | The GPU is holding gemma3:4b; leave it there                      |
| `MEDIHIVE_STT_COMPUTE`       | `int8`                   | `float32` when int8 quantisation costs accuracy                   |
| `MEDIHIVE_VOICE_DIR`         | `./voices`               | Piper voices kept with the deployment                             |
| `MEDIHIVE_TTS_DEVICE`        | `cpu`                    | `cuda` for IndicF5 — only if Ollama has moved off the GPU         |
| `MEDIHIVE_TTS_PROVIDERS`     | from config.yaml         | `piper` takes IndicF5 out of service for one run                  |
| `MEDIHIVE_TTS_REFERENCE_DIR` | `tts/voices`             | Reference pairs kept outside the tree                             |
| `MEDIHIVE_TTS_CONFIG`        | `tts/config.yaml`        | A deployment's own provider configuration                         |
| `MEDIHIVE_LOG_LEVEL`         | `INFO`                   | `DEBUG` when a language is being refused and you want to know why |

Every path in `tts/config.yaml` is relative and resolved against the package
directory; the variables above are how a deployment points at somewhere else.
No absolute path is committed anywhere in it.
