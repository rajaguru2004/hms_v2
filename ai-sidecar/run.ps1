# Start the MediHive AI sidecar (Windows).
#
# The Windows equivalent of run.sh. Same host, same port, same environment
# variable names and defaults — only the venv layout differs, because Windows
# puts the interpreter in .venv\Scripts\ rather than .venv/bin/.
#
# Everything Python in this project lives in .\.venv, on 3.12. Nothing is
# installed into the host interpreter — the host is on 3.13, which several of
# these model runtimes do not publish wheels for yet.
#
#   .\run.ps1                 # default: 127.0.0.1:8801
#   .\run.ps1 --reload        # extra args pass straight through to uvicorn
$ErrorActionPreference = 'Stop'

Set-Location -LiteralPath $PSScriptRoot

$python  = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $python)) {
    Write-Error @'
No venv. Create it with:
  & "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -m venv .venv
  .\.venv\Scripts\python.exe -m pip install -r requirements.txt
'@
    exit 1
}

if (-not $env:OLLAMA_URL)          { $env:OLLAMA_URL          = 'http://127.0.0.1:8080' }

# Voices: a local copy outside OneDrive if there is one, otherwise the tree.
#
# This repository lives under OneDrive on the development box, and Files
# On-Demand turns a ~63 MB .onnx it has not seen used into a cloud placeholder —
# a reparse point with FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS and no data behind
# it. Reading it from Windows triggers a recall; reading it from inside a Docker
# bind mount does not reliably, and a truncated .onnx does not fail to load. It
# builds an onnxruntime session, reports the language as available, and then
# produces zero samples on every request — which reaches a patient as
# "This voice is unavailable." with the file sitting right there on disk.
#
# `ai-sidecar/README.md` has the one-time copy command and how to spot it.
# Nothing here creates the directory: its absence means this box keeps the old
# behaviour, and its presence means somebody chose it.
if (-not $env:MEDIHIVE_VOICE_DIR) {
    $localVoices = Join-Path $env:USERPROFILE '.medihive\voices'
    $env:MEDIHIVE_VOICE_DIR = if (Test-Path -LiteralPath $localVoices) {
        $localVoices
    } else {
        Join-Path $PSScriptRoot 'voices'
    }
}
Write-Host "voices: $env:MEDIHIVE_VOICE_DIR"

# The Hugging Face token, from hms_v2/.env.local if it is not already exported.
#
# `tts/indicf5.py` reads it from the process environment and nothing else, so a
# token sitting in .env.local — which is where every other credential on this
# box lives, and which Nest and the voice worker both read — would otherwise be
# invisible here. The symptom is not an error: /health simply keeps reporting
# "no Hugging Face token is set" and Tamil keeps answering 503, with the token
# on disk a directory away.
#
# Only the three names IndicF5 looks for are taken, and only when unset. This is
# not a general .env loader: the sidecar's other settings are deliberately its
# own, and importing the API's whole environment here would let a DATABASE_URL
# change what a model runtime does.
# torch.compile off, for IndicF5.
#
# `INF5Model.__init__` wraps both its vocoder and its DiT in `torch.compile`.
# That is the right call on the GPU the model was published for. On a CPU-only
# torch it is a trap: inductor compiles at the first forward pass, and measured
# here it burned **28 CPU-minutes without finishing a single sentence**, which
# looks exactly like a hung request. With this set, `torch.compile` returns the
# original callable and the model runs eager — verified, not assumed:
# `torch.compile(f) is f` is True.
#
# It changes nothing on a box that never loads IndicF5, and a GPU deployment
# that wants compilation removes this line.
if (-not $env:TORCHDYNAMO_DISABLE) { $env:TORCHDYNAMO_DISABLE = '1' }

# FFmpeg's shared libraries, for IndicF5's reference-audio decoding.
#
# torchaudio 2.11 removed its own backends and routes every load through
# TorchCodec, which needs FFmpeg's av*.dll. The container installs ffmpeg; on
# Windows there is nothing unless somebody put it there, and PATH does not help
# because Python 3.8+ stopped searching it for extension dependencies. So the
# directory is passed by name and `tts/indicf5.py` registers it with
# os.add_dll_directory. See ai-sidecar/README.md for the one-time fetch.
if (-not $env:MEDIHIVE_FFMPEG_DIR) {
    $localFfmpeg = Join-Path $env:USERPROFILE '.medihive\ffmpeg'
    if (Test-Path -LiteralPath $localFfmpeg) { $env:MEDIHIVE_FFMPEG_DIR = $localFfmpeg }
}
if ($env:MEDIHIVE_FFMPEG_DIR) {
    Write-Host "ffmpeg: $env:MEDIHIVE_FFMPEG_DIR"
} else {
    Write-Host "ffmpeg: not found - IndicF5 cannot read its reference audio" -ForegroundColor DarkYellow
}

$envFile = Join-Path (Split-Path -Parent $PSScriptRoot) '.env.local'
if (Test-Path -LiteralPath $envFile) {
    foreach ($name in 'HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN', 'HUGGINGFACEHUB_API_TOKEN') {
        if (Get-Item -LiteralPath "env:$name" -ErrorAction SilentlyContinue) { continue }
        $line = Select-String -LiteralPath $envFile -Pattern "^\s*$name\s*=" |
                Select-Object -First 1
        if (-not $line) { continue }
        $value = ($line.Line -split '=', 2)[1].Trim().Trim('"').Trim("'")
        if ($value) {
            Set-Item -LiteralPath "env:$name" -Value $value
            # ${name}, not $name: a bare "$name:" is parsed as a drive-qualified
            # variable reference and is a parse error, not a string.
            Write-Host "${name}: loaded from .env.local ($($value.Length) chars)"
        }
    }
}
if (-not $env:HF_TOKEN -and -not $env:HUGGING_FACE_HUB_TOKEN -and -not $env:HUGGINGFACEHUB_API_TOKEN) {
    Write-Host "HF_TOKEN: not set - IndicF5 stays unavailable, Tamil will answer 503" -ForegroundColor DarkYellow
}

$port = if ($env:MEDIHIVE_SIDECAR_PORT) { $env:MEDIHIVE_SIDECAR_PORT } else { '8801' }

# Bound to loopback on purpose. This service authenticates nobody: the only
# thing allowed to call it is the Nest API on the same host.
#
# Invoked as `python -m uvicorn` rather than uvicorn.exe so the running
# interpreter is unambiguously the venv's, whatever is on PATH.
& $python -m uvicorn main:app `
    --host 127.0.0.1 `
    --port $port `
    @args

exit $LASTEXITCODE
