# Start the worker with timing instrumentation on, in its own room.
#
# The same worker run.ps1 starts, with three differences, all of which exist so
# that a measurement run cannot collide with anything else on this box:
#
#   * MEDIHIVE_TIMING_LOG is set, which is the only thing that turns timing.py
#     on. It is written under $env:TEMP, NOT under the project: the project
#     lives in a OneDrive-synced folder and a sync landing mid-turn would be
#     measured as latency that is not there.
#   * AGENT_HEALTH_PORT defaults to 9091 rather than 9090, so this can run
#     beside an ordinary worker without either failing to bind.
#   * The room is explicit and the session id comes from the environment rather
#     than from the room name, so two workers cannot end up in one room both
#     answering the patient.
#
# Prepare the session first — it prints the two variables this needs:
#
#   .\.venv\Scripts\python.exe tools\prepare_session.py --shell powershell | iex
#   .\tools\run_measured.ps1 -Room latency-budget
#
# Then, in another shell:
#
#   .\.venv\Scripts\python.exe tools\latency_probe.py --room latency-budget
#   .\.venv\Scripts\python.exe tools\report_budget.py
param(
    [string]$Room = 'latency-budget',
    [string]$TimingLog = "$env:TEMP\medihive-timing\worker.ndjson",
    [string]$HealthPort = '9091'
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

if (-not $env:MEDIHIVE_SESSION_ID) {
    Write-Error 'MEDIHIVE_SESSION_ID is not set. Run tools\prepare_session.py first.'
    exit 1
}
if (-not $env:MEDIHIVE_API_TOKEN) {
    Write-Error 'MEDIHIVE_API_TOKEN is not set. Run tools\prepare_session.py first.'
    exit 1
}

New-Item -ItemType Directory -Force (Split-Path -Parent $TimingLog) | Out-Null
$env:MEDIHIVE_TIMING_LOG = $TimingLog
$env:AGENT_HEALTH_PORT = $HealthPort

# Named rather than left to config.py's fallbacks, so the log of a measurement
# run records what the VAD was actually tuned to when it was taken. These are
# run.ps1's values; changing one here changes what hop 1 costs.
if (-not $env:SILERO_MIN_SILENCE_MS) { $env:SILERO_MIN_SILENCE_MS = '650' }
if (-not $env:SILERO_ACTIVATION)     { $env:SILERO_ACTIVATION     = '0.26' }
if (-not $env:SILERO_DEACTIVATION)   { $env:SILERO_DEACTIVATION   = '0.16' }
if (-not $env:SILERO_PREFIX_PAD_MS)  { $env:SILERO_PREFIX_PAD_MS  = '900' }
if (-not $env:SILERO_MIN_SPEECH_MS)  { $env:SILERO_MIN_SPEECH_MS  = '50' }
if (-not $env:BARGE_MIN_SEC)         { $env:BARGE_MIN_SEC         = '0.2' }

Write-Host "timing log : $TimingLog"
Write-Host "session    : $env:MEDIHIVE_SESSION_ID"
Write-Host "room       : $Room"

# -u so the log is not sitting in a stdio buffer when the run is interrupted,
# which is exactly how the first attempt at this lost twenty minutes of output.
& '.\.venv\Scripts\python.exe' -u agent.py connect --room $Room
exit $LASTEXITCODE
