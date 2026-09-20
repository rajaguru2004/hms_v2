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

# ──────────────────────────────────────────────────────────────
# Optional: the eleven Indian languages.
# ──────────────────────────────────────────────────────────────
#
#   docker build --target indic -t medihive-sidecar:indic ./ai-sidecar
#
# A separate stage rather than a line in requirements.txt, because IndicF5
# costs several gigabytes of torch and the demo container only ever speaks
# English through Piper. Building with no --target still stops at `runtime`
# and produces the lean image, so nothing that exists today gets larger.
#
# Only the install differs. ENV, USER, CMD and HEALTHCHECK are inherited from
# `runtime`, which is the point of extending it rather than restating it: the
# two images cannot drift in how they run, only in what they can speak.
#
# The weights are NOT baked in. `ai4bharat/IndicF5` is a gated repo (~1.4 GB,
# plus 52 MB for the charactr/vocos-mel-24khz vocoder), and it is read from the
# HuggingFace cache that docker-compose.demo.yml and scripts/dev.mjs bind-mount
# at HF_HOME. An image carrying gated weights is one nobody can publish.
FROM runtime AS indic

USER root
COPY requirements-indic.txt ./
RUN pip install --no-cache-dir -r requirements-indic.txt

# AI4Bharat's own f5_tts, not the PyPI `f5-tts`. requirements-indic.txt has the
# argument in full; the short version is that the `model.py` shipped with the
# weights calls a `load_model` signature that exists only in this fork, and
# `--no-deps` is what keeps its `numpy<=1.26.4` pin from taking OCR down with
# it. Its dependencies are in requirements-indic.txt, installed above.
#
# A tarball rather than `git+https://`, so the image does not need git. `main`
# rather than a tag because the repository publishes none; it is pinned by the
# weights it has to match, which are themselves a fixed HuggingFace revision.
RUN pip install --no-cache-dir --no-deps       https://github.com/AI4Bharat/IndicF5/archive/refs/heads/main.tar.gz

# Two caches that have to be writable, and are not by default.
#
# librosa - imported by f5_tts.model.modules - decorates functions with
# `@jit(cache=True)`, and numba's default cache location is a `__pycache__`
# beside the source. site-packages is root-owned and this process is `sidecar`,
# so the *first IndicF5 synthesis* dies with
#
#   RuntimeError: cannot cache function '__o_fold': no locator available
#   for file '/usr/local/lib/python3.12/site-packages/librosa/core/notation.py'
#
# which is a permissions problem wearing the costume of a numba bug, reported
# at load time rather than at import, i.e. against the first patient who picks
# an Indian language. matplotlib has the same shape of problem and only warns.
#
# /tmp rather than a directory under /app: both are caches that can be thrown
# away, and a container filesystem is the right place for them. Nothing here
# needs to survive a restart - a cold numba cache costs one compile.
# `OMP_WAIT_POLICY=PASSIVE` is not a tuning knob here, it is a bug fix.
#
# torch's OpenMP threads spin-wait when idle by default. After one IndicF5
# synthesis this container sat at ~600% CPU *forever* - not during the
# request, after it - and the next English question, which Piper answers in
# 180 ms, timed out at the API's 30 s ceiling and reached the patient as
# "We cannot read this aloud right now." One Tamil question poisoned every
# question after it until a restart. PASSIVE makes those threads sleep:
# measured idle afterwards is 0.19%.
#
# Four threads rather than the twelve torch would take: a spoken interview is
# one sentence at a time, and the rest of the box - Whisper, Piper, OCR and
# the API - has to stay responsive while IndicF5 runs. It costs a slow engine
# a little more time and stops it taking the machine.
ENV NUMBA_CACHE_DIR=/tmp/numba-cache     MPLCONFIGDIR=/tmp/matplotlib     OMP_WAIT_POLICY=PASSIVE     OMP_NUM_THREADS=4     MKL_NUM_THREADS=4
RUN mkdir -p /tmp/numba-cache /tmp/matplotlib && chown sidecar:sidecar /tmp/numba-cache /tmp/matplotlib

USER sidecar


# ──────────────────────────────────────────────────────────────
# Optional: the Indian languages, on a GPU.
# ──────────────────────────────────────────────────────────────
#
#   docker build --target indic-gpu -t medihive-sidecar:indic-gpu ./ai-sidecar
#   docker run --gpus all ... medihive-sidecar:indic-gpu
#
# `FROM indic` rather than `FROM runtime`, so the whole f5_tts install above is
# reused and this stage only swaps the three CPU wheels for their CUDA builds.
# The dependency list stays in one place; a torch version bump cannot leave the
# two stages disagreeing about anything except the device.
#
# Why bother: IndicF5 on the CPU takes 95-155 s per question, which is a way to
# hear a language rather than a way to be interviewed in one. The weights are
# ~1.4 GB in fp32, so a 4 GB card fits them with room for the vocoder - but
# only if nothing else is holding the VRAM. Whisper stays on the CPU
# (MEDIHIVE_STT_DEVICE=cpu) for exactly that reason, and Ollama will evict or
# be evicted if it is serving a model at the same time.
#
# `--gpus all` is required at run time. Without it torch sees no device, and
# `MEDIHIVE_TTS_DEVICE=cuda` then fails at load rather than falling back - so
# a box with no GPU should run `medihive-sidecar:indic` instead.
FROM indic AS indic-gpu

USER root
# Default index, deliberately: this is the one place that wants the CUDA build
# requirements-indic.txt goes out of its way to avoid.
RUN pip install --no-cache-dir --force-reinstall torch torchaudio torchcodec
USER sidecar

ENV MEDIHIVE_TTS_DEVICE=cuda
