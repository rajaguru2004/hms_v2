#!/usr/bin/env bash
# Start the MediHive AI sidecar.
#
# Everything Python in this project lives in ./.venv, on 3.12. Nothing is
# installed into the host interpreter — the host is on 3.14, which several of
# these model runtimes do not publish wheels for yet.
set -euo pipefail

cd "$(dirname "$0")"

if [[ ! -x .venv/bin/python ]]; then
  echo "No venv. Create it with:  python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  exit 1
fi

export OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
export MEDIHIVE_VOICE_DIR="${MEDIHIVE_VOICE_DIR:-$PWD/voices}"

# Bound to loopback on purpose. This service authenticates nobody: the only
# thing allowed to call it is the Nest API on the same host.
exec .venv/bin/uvicorn main:app \
  --host 127.0.0.1 \
  --port "${MEDIHIVE_SIDECAR_PORT:-8801}" \
  "$@"
