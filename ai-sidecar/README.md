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
POST /tts/stream {text, language}         → audio/L16 chunked + X-TTS-Sample-Rate
POST /ocr     multipart file (image|pdf)  → {pageCount, pages:[{text, meanConfidence, blocks[]}]}
```

### `/tts` and `/tts/stream` are the same voice for two different callers

`/tts` is unchanged and returns one complete WAV. The phone needs that: it is
handed bytes and hands them to a decoder, so it needs a header and a length.

`/tts/stream` returns **raw little-endian 16-bit mono PCM, chunked**, for the
LiveKit worker, which is playing the audio live and will re-frame whatever
arrives to 20 ms anyway. Both take the same body, route by language through the
same provider chain, and give the same three refusals — 400 for nothing to say,
400 over `MAX_SPEAK_CHARS`, 503 for a language no engine here can speak. A
caller must not be able to reach a voice through one that the other would refuse.

Piper streams for real (`PiperVoice.synthesize` is a per-sentence generator).
IndicF5 has no incremental API, so it is chunked a sentence at a time: not true
streaming, but the first sentence plays while the second is still generating, and
abandoning the generator stops the next sentence being made at all. That is what
makes a barge-in cancel the synthesiser and not just the speaker.

The rate has to be known before the first chunk, since it goes in a header — so
`TTSProvider.sample_rate(language)` answers it separately. Piper reads it off the
loaded voice (22050 Hz for the medium voices on disk); IndicF5 states its 24000.

### One Piper synthesis at a time, process-wide

Both routes now run their blocking work in a threadpool rather than on the event
loop, so a Whisper decode can no longer stall a live call. That made two Piper
syntheses able to overlap for the first time, and Piper phonemises through
espeak-ng — a C library that keeps the **current voice in a process-wide
global**. Overlapping calls share one voice setting, the loser gets its text
phonemised by the other one's language, and Devanagari handed to `en-us`
produces no phonemes, no audio, and the same misleading
`wave.Error: # channels not specified` as a truncated voice file.

`tts/piper.py` therefore holds `_espeak_lock` across the whole of `synthesize`
and `synthesize_stream`. Measured: 16 interleaved `/tts` and `/tts/stream`
requests alternating English and Hindi, 0 failures. Before the lock, an English
call followed immediately by a Hindi one failed reliably.

A worker per language is the shape that scales; this is one uvicorn holding one
Whisper on a 16 GB box, so serialising costs a queue on the rare overlap and the
alternative costs a second copy of every model.

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
| `MEDIHIVE_STT_MODEL`         | `small`                  | `large-v3-turbo` on a card with >2 GB spare — better Hindi        |
| `MEDIHIVE_STT_DEVICE`        | `auto`                   | `cpu` to keep the GPU free; `auto` falls back on its own          |
| `MEDIHIVE_STT_COMPUTE`       | `auto`                   | `int8_float16` on CUDA, `int8` on CPU; override to pin one        |
| `MEDIHIVE_STT_BEAM`          | `1`                      | `5` if a deployment can show beam search buying it something      |
| `MEDIHIVE_STT_VAD`           | `1`                      | `0` saves ~30 ms and risks hallucinated speech in silence         |
| `MEDIHIVE_STT_CONDITION`     | `0`                      | `1` only for audio longer than one 30 s decode window             |
| `MEDIHIVE_STT_PREWARM`       | `1`                      | `0` where idle memory costs more than the first turn              |
| `MEDIHIVE_VOICE_DIR`         | `./voices`               | Piper voices kept with the deployment                             |
| `MEDIHIVE_TTS_DEVICE`        | `cpu`                    | `cuda` for IndicF5 — only if Ollama has moved off the GPU         |
| `MEDIHIVE_TTS_PROVIDERS`     | from config.yaml         | `piper` takes IndicF5 out of service for one run                  |
| `MEDIHIVE_TTS_REFERENCE_DIR` | `tts/voices`             | Reference pairs kept outside the tree                             |
| `MEDIHIVE_TTS_CONFIG`        | `tts/config.yaml`        | A deployment's own provider configuration                         |
| `MEDIHIVE_LOG_LEVEL`         | `INFO`                   | `DEBUG` when a language is being refused and you want to know why |

Every path in `tts/config.yaml` is relative and resolved against the package
directory; the variables above are how a deployment points at somewhere else.
No absolute path is committed anywhere in it.

### IndicF5 on Windows needs two things the container gets for free

The eleven Indic languages come from `ai4bharat/IndicF5`, and on a Windows venv
three separate things have to be true before it will speak. Each fails in a way
that does not name the cause.

**1. A Hugging Face token that is actually authorised.** The repo is
`gated: auto`, so acceptance is automatic _on request_ — but somebody has to
request it, while signed in, at <https://huggingface.co/ai4bharat/IndicF5>. And
a **fine-grained** token additionally needs the _"Read access to contents of all
public gated repos you can access"_ permission; without it the token
authenticates and the fetch still 403s. The two failures are distinguishable:
`401` is no token, `403` is a token that is not authorised.

`run.ps1` reads `HF_TOKEN` from `hms_v2/.env.local` and says what it found.

**2. FFmpeg's shared libraries.** `torchaudio` 2.11 removed its own backends and
routes every `load()` through TorchCodec, which is a wrapper over FFmpeg's
`av*.dll`. The Dockerfile installs `ffmpeg`, so Linux never sees this. On
Windows, note that **PATH is not enough** — since Python 3.8 the interpreter
does not search PATH for an extension module's dependencies, so a directory of
DLLs on PATH is invisible to the DLL that needs them. The directory is passed by
name instead and `tts/indicf5.py` registers it with `os.add_dll_directory`.

A **shared** build is required; `winget install Gyan.FFmpeg` is static and has no
DLLs at all. One-time fetch:

```powershell
$dst = 'C:\Users\user\.medihive\ffmpeg'
New-Item -ItemType Directory -Force $dst | Out-Null
$zip = "$env:TEMP\ffmpeg-shared.zip"
Invoke-WebRequest -UseBasicParsing -OutFile $zip `
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-win64-lgpl-shared-8.1.zip'
Expand-Archive $zip "$env:TEMP\ffmpeg-extract" -Force
Get-ChildItem "$env:TEMP\ffmpeg-extract" -Recurse -Filter *.dll |
  ForEach-Object { Copy-Item $_.FullName $dst -Force }
```

`run.ps1` picks that path up automatically; `MEDIHIVE_FFMPEG_DIR` overrides it.
Any major from 4 to 9 works — `torchcodec` ships a `libtorchcodec_core<N>.dll`
per major and loads whichever matches what it finds.

**3. `torchcodec` itself**, which is not in `requirements.txt` for the same
reason torch is not:

```
.venv\Scripts\pip install torchcodec
```

### Do not keep the voices in OneDrive

On this machine the repository lives under `C:\Users\user\OneDrive\...`, and
OneDrive Files On-Demand turns a file it has not seen you use into a **cloud
placeholder**: a reparse point with `FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS`
(`0x80000`) and no data behind it. Reading it from Windows triggers a recall and
you never notice. Reading it from inside a Docker bind mount does not reliably
trigger one, and the container gets a short file.

A truncated `.onnx` does not fail to load. onnxruntime builds a session from it,
`PiperVoice.load` returns, `supports()` says yes, `/health` reports the language
as available — and then every synthesis produces **zero samples**, which
surfaces as

    wave.Error: # channels not specified

and reaches the patient as `503 This voice is unavailable.` on a box where the
voice file is right there on disk. It comes and goes, because opening the file
from Windows rehydrates it and OneDrive later evicts it again. The same
placeholder mechanism breaks `docker build` in this tree, with
`transferring dockerfile: 31B` for a 4 KB Dockerfile.

So the weights live outside the synced tree and are mounted from there:

```powershell
# once
New-Item -ItemType Directory -Force C:\Users\user\.medihive\voices
Get-ChildItem .\voices -File | ForEach-Object {
  [System.IO.File]::WriteAllBytes(
    "C:\Users\user\.medihive\voices\$($_.Name)",
    [System.IO.File]::ReadAllBytes($_.FullName))   # forces a full recall
}
```

```
-v "C:\Users\user\.medihive\voices:/app/voices:ro"     # container
$env:MEDIHIVE_VOICE_DIR = 'C:\Users\user\.medihive\voices'   # venv
```

Check a suspect deployment by size from inside the container, not from Windows:

```sh
docker exec medihive_sidecar_dev python -c \
  "import os;[print(f, os.path.getsize('/app/voices/'+f)) for f in os.listdir('/app/voices')]"
```

A medium voice is ~63 MB. Anything much smaller is a placeholder.
