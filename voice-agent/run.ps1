# Start the MediHive voice agent (Windows).
#
# Same conventions as ai-sidecar\run.ps1 — its own .venv on 3.12, nothing
# installed into the host interpreter, defaults set here rather than assumed in
# code — with one difference worth naming: this venv is *not* the sidecar's.
# See requirements.txt for why. The short version is that this process runs no
# model: Whisper and Piper stay in the sidecar and are reached over loopback,
# so sharing the venv would share the disk and not the memory, while risking
# the sidecar's Smart App Control pins on a resolver run.
#
#   .\run.ps1                       # dev: join any room dispatched to us
#   .\run.ps1 start                 # production worker registration
#   .\run.ps1 connect --room case-abc123
#   .\run.ps1 console               # local mic/speaker, no LiveKit room
#
# Credentials come from hms_v2\.env.local, which is untracked. agent.py loads it
# at import time; nothing here reads or prints a secret.
$ErrorActionPreference = 'Stop'

Set-Location -LiteralPath $PSScriptRoot

$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $python)) {
    Write-Error @'
No venv. Create it with:
  & "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -m venv .venv
  .\.venv\Scripts\python.exe -m pip install -r requirements.txt

Do NOT install these into ai-sidecar\.venv — requirements.txt explains why.
'@
    exit 1
}

# The sidecar and the API. Named the same as everywhere else in this project so
# that one value in .env.local configures every caller; set here only as a
# fallback for a shell that has not sourced it.
if (-not $env:AI_SIDECAR_URL)   { $env:AI_SIDECAR_URL   = 'http://127.0.0.1:8801' }
if (-not $env:MEDIHIVE_API_URL) { $env:MEDIHIVE_API_URL = 'http://127.0.0.1:3000/api' }

# Silero VAD tuning. These are the reference implementation's tuned values, not
# the library's defaults, and they are set here rather than left to config.py's
# fallbacks so that `run.ps1` shows an operator what the box is actually running
# without reading Python. Any of them can be overridden in the shell first.
if (-not $env:SILERO_MIN_SILENCE_MS) { $env:SILERO_MIN_SILENCE_MS = '650' }
if (-not $env:SILERO_ACTIVATION)     { $env:SILERO_ACTIVATION     = '0.26' }
if (-not $env:SILERO_DEACTIVATION)   { $env:SILERO_DEACTIVATION   = '0.16' }
if (-not $env:SILERO_PREFIX_PAD_MS)  { $env:SILERO_PREFIX_PAD_MS  = '900' }
if (-not $env:SILERO_MIN_SPEECH_MS)  { $env:SILERO_MIN_SPEECH_MS  = '50' }
if (-not $env:BARGE_MIN_SEC)         { $env:BARGE_MIN_SEC         = '0.2' }

if (-not $env:AGENT_HEALTH_PORT) { $env:AGENT_HEALTH_PORT = '9090' }

# `dev` unless told otherwise. It is the subcommand that takes whatever room is
# dispatched to this worker, which is what a developer wants; `start` is the
# production registration and is what a service manager should pass.
#
# The [string[]] cast is load-bearing, not decoration. PowerShell unrolls a
# single-element array on its way out of an `if` block, so a bare `start`
# left $agentArgs holding the *string* 'start' — and `@` splats a string by
# character, handing agent.py `s t a r t` as five arguments and failing with
# `No such command 's'`. It went unnoticed because every previous invocation
# passed two or more words (`connect --room case-abc`), which stays an array
# and splats correctly. The cast makes the one-argument and zero-argument
# cases — `start` and bare `dev`, the only two worker-registration modes —
# behave like the multi-word one.
[string[]]$agentArgs = if ($args.Count -gt 0) { $args } else { @('dev') }

# Warn rather than fail if the sidecar is not up. The worker is still useful —
# it will join, listen and log — and a check that refuses to start is a check
# that stops you debugging the thing you are trying to debug.
try {
    $null = Invoke-WebRequest -Uri "$($env:AI_SIDECAR_URL)/health" -TimeoutSec 3 -UseBasicParsing
} catch {
    Write-Warning "AI sidecar not answering at $env:AI_SIDECAR_URL - speech in and out will fail. Start it with ..\ai-sidecar\run.ps1"
}

# Invoked as `python agent.py` rather than through any console script so the
# running interpreter is unambiguously this venv's, whatever is on PATH.
& $python agent.py @agentArgs

exit $LASTEXITCODE
