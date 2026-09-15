# ──────────────────────────────────────────────────────────────
# MediHive AI sidecar — speech-to-text, text-to-speech, OCR.
# ──────────────────────────────────────────────────────────────
#
# Python 3.12, not 3.13+ and emphatically not the host's 3.14. requirements.txt
# says why: paddlepaddle publishes no 3.14 wheel and ctranslate2 (under
# faster-whisper) lags the newest interpreter by a release or two. Pinning the
# interpreter in the image is the same guarantee `.venv` gives on the host — a
# host upgrade cannot silently break OCR.
#
# `-slim` rather than `-alpine`: every model runtime here (onnxruntime,
# ctranslate2, opencv, pypdfium2) ships manylinux wheels built against glibc.
# On musl there are no wheels at all and pip falls back to compiling from
# source, which is a forty-minute build for an identical result.
FROM python:3.12-slim AS runtime

# Two shared libraries that no wheel bundles:
#   libgl1, libglib2.0-0 — opencv-python, pulled in by rapidocr-onnxruntime.
#     Without them the *import* fails, so `ocr.available()` would answer false
#     and /health would report OCR down with no other symptom.
#   ffmpeg — faster-whisper decodes whatever the phone recorded. A browser or
#     Flutter client sends webm/opus or m4a far more often than wav, and
#     without a decoder those arrive as a runtime error rather than a
#     transcript.
# Removing the apt lists in the same layer keeps them out of the image.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgl1 \
      libglib2.0-0 \
      ffmpeg \
      curl \
    && rm -rf /var/lib/apt/lists/*

# UID 1000 on purpose, matching the developer account on the demo box.
# docker-compose.demo.yml bind-mounts the host's ~/.cache/huggingface so the
# already-downloaded Whisper weights are reused instead of re-fetched; if this
# process ran as root it would write root-owned lock files back into the user's
# cache directory, which is a mess to clean up afterwards.
RUN useradd --create-home --uid 1000 --shell /bin/bash sidecar

WORKDIR /app

# Dependencies before source, so editing main.py does not reinstall onnxruntime.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=sidecar:sidecar *.py ./
# The TTS package, its config.yaml and the eleven reference directories. A
# separate COPY because `*.py` does not match a directory, and the reference
# pairs are source rather than deployment data — unlike the Piper weights in
# /app/voices, which stay a bind mount.
COPY --chown=sidecar:sidecar tts/ ./tts/

USER sidecar

# Where the mounts land. Both are deployment data, never image content:
#   voices/ — ~61 MB per language of Piper weights, gitignored.
#   HF_HOME — Whisper's `small` model, ~460 MB, downloaded on first transcribe.
# The defaults point at the paths docker-compose.demo.yml mounts.
ENV MEDIHIVE_VOICE_DIR=/app/voices \
    HF_HOME=/home/sidecar/.cache/huggingface \
    PYTHONUNBUFFERED=1

EXPOSE 8801

# 0.0.0.0, unlike run.sh's 127.0.0.1. The reasoning in run.sh still holds — this
# service authenticates nobody — but inside compose the container *is* the
# security boundary: the port is never published to the host, so the only thing
# that can reach 8801 is something on the medihive network, which is the Nest
# API. Binding to loopback here would mean binding to the container's own
# loopback, and nothing could reach it at all.
#
# One worker. Each one loads its own copy of Whisper (~500 MB resident) and its
# own Piper voice, and this box has about 4 GB free.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8801", "--workers", "1"]

# `stt`/`tts`/`ocr` in the body are import-and-file checks, so this answers long
# before any model is loaded — which is what we want from a healthcheck. The
# start period is generous because the first import of onnxruntime on a loaded
# box is not fast.
HEALTHCHECK --interval=15s --timeout=10s --start-period=60s --retries=5 \
  CMD curl -fsS http://localhost:8801/health || exit 1
