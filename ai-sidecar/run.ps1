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
if (-not $env:MEDIHIVE_VOICE_DIR)  { $env:MEDIHIVE_VOICE_DIR  = (Join-Path $PSScriptRoot 'voices') }

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
