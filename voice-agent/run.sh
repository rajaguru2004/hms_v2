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

# ── Nothing is defaulted here, and that is the whole point ───────────────────
#
# `run.ps1` opens with a block of `if (-not $env:X) { $env:X = '<default>' }`
# for the sidecar URL, the API URL and every Silero tuning value. Mirroring it
# was the obvious thing to do and it was wrong, measurably: it makes .env.local
# dead for every variable it names.
#
# The chain is short and one-directional. `config.py` calls
# `load_dotenv(ENV_FILE, override=False)` — deliberately, so a value set for one
# run wins — and then reads each variable with its own default. A launcher that
# exports `SILERO_MIN_SILENCE_MS=650` first has *already set it in the shell*,
# so `override=False` keeps 650 and the 1000 in .env.local is never read. It was
# not read: the agent logged `SILERO_MIN_SILENCE_MS 650` with 1000 sitting in
# the file.
#
# So the defaults live in exactly one place, `config.py`, which already had all
# of them. The precedence that leaves is the one the README documents:
#
#     shell for one run  >  .env.local  >  config.py
#
#     SILERO_MIN_SILENCE_MS=1500 ./run.sh   # still works, and now means it
#
# run.ps1 has the same defect. It is untouched here only because it cannot be
# run or tested on this machine.

# `dev` takes whatever room is dispatched to this worker, which is what Nest's
# `dispatchVoiceAgent` does when a patient taps the microphone.
if [[ $# -eq 0 ]]; then
  set -- dev
fi

# A warning and not a failure. The worker starts either way and the interview
# still works by tap and keyboard — but speech in and out is the whole point of
# this process, so starting it against a sidecar that is not there deserves a
# line rather than a silent session where every answer fails to transcribe.
# Read for the probe only, and deliberately not exported: the value config.py
# resolves is the one that matters, and this must not become the shell default
# the block above exists to explain.
sidecar_probe="${AI_SIDECAR_URL:-http://127.0.0.1:8801}"
if ! curl -sf -m 3 "${sidecar_probe}/health" >/dev/null 2>&1; then
  echo "  ! AI sidecar not answering at ${sidecar_probe} — speech in and out will fail." >&2
  echo "    Start it with ../ai-sidecar/run.sh" >&2
fi

exec .venv/bin/python agent.py "$@"
