#!/usr/bin/env bash
# Start the MediHive voice agent.
#
# The Linux counterpart of run.ps1, and a straight translation of it — same
# defaults, same order, same warning. Two launchers for one worker is a thing to
# keep in step, so when one gains a variable the other has to gain it too; they
# are side by side in the same directory so the diff is obvious.
#
# `../ai-sidecar/run.sh` is the same shape for the same reason.
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -x .venv/bin/python ]]; then
  cat >&2 <<'EOF'
No venv. Create it with:
  python3.12 -m venv .venv
  .venv/bin/pip install -r requirements.txt
Do NOT install these into ../ai-sidecar/.venv — requirements.txt explains why.
EOF
  exit 1
fi

# Every one of these is a default, never an override: `${VAR:-default}` leaves a
# value already in the environment alone. That is what makes
# `SILERO_MIN_SILENCE_MS=1500 ./run.sh` work for a single run, and it is also
# why .env.local wins — agent.py loads it at import, and anything it sets is
# already in the environment by the time config.py reads it.
export AI_SIDECAR_URL="${AI_SIDECAR_URL:-http://127.0.0.1:8801}"
export MEDIHIVE_API_URL="${MEDIHIVE_API_URL:-http://127.0.0.1:3000/api}"
export SILERO_MIN_SILENCE_MS="${SILERO_MIN_SILENCE_MS:-650}"
export SILERO_ACTIVATION="${SILERO_ACTIVATION:-0.26}"
export SILERO_DEACTIVATION="${SILERO_DEACTIVATION:-0.16}"
export SILERO_PREFIX_PAD_MS="${SILERO_PREFIX_PAD_MS:-900}"
export SILERO_MIN_SPEECH_MS="${SILERO_MIN_SPEECH_MS:-50}"
export BARGE_MIN_SEC="${BARGE_MIN_SEC:-0.2}"
export AGENT_HEALTH_PORT="${AGENT_HEALTH_PORT:-9090}"

# `dev` takes whatever room is dispatched to this worker, which is what Nest's
# `dispatchVoiceAgent` does when a patient taps the microphone.
if [[ $# -eq 0 ]]; then
  set -- dev
fi

# A warning and not a failure. The worker starts either way and the interview
# still works by tap and keyboard — but speech in and out is the whole point of
# this process, so starting it against a sidecar that is not there deserves a
# line rather than a silent session where every answer fails to transcribe.
if ! curl -sf -m 3 "${AI_SIDECAR_URL}/health" >/dev/null 2>&1; then
  echo "  ! AI sidecar not answering at ${AI_SIDECAR_URL} — speech in and out will fail." >&2
  echo "    Start it with ../ai-sidecar/run.sh" >&2
fi

exec .venv/bin/python agent.py "$@"
