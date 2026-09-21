"""Every environment variable this worker reads, and what it means.

One module, because the alternative — `os.environ.get` scattered through five
files — is how a documented default and an actual default drift apart. The
README's table is generated from [describe] below, so a variable cannot be
added without being documented.

Nothing here logs a secret. [describe] redacts by name, and the redaction list
is a suffix match rather than an exact one so that a future `LIVEKIT_API_SECRET_2`
is caught without anybody remembering to add it.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# hms_v2/ — the worker lives in hms_v2/voice-agent/, and the credentials live in
# hms_v2/.env.local, which is untracked. Resolved rather than assumed so that
# running the worker from any cwd finds the same file.
REPO_ROOT = Path(__file__).resolve().parent.parent

# In preference order, and the fallback is the whole point.
#
# `.env.local` stays first: it is untracked, so it is where a credential
# belongs and where a per-machine override wins. But Nest reads `.env`, and the
# day those two files were consolidated into one this worker stopped starting —
# `missing required environment: LIVEKIT_URL, ...` at import, seconds after
# launch, on a machine where the API had every one of those values. Nothing in
# the app said so: the room still opened, no agent was ever dispatched into it,
# and the handset quietly fell back to record-then-upload. A silent downgrade
# from a live conversation to a transcription box, caused by which filename the
# credentials happened to be sitting in.
#
# So this reads whichever of the two is present rather than insisting on one.
# Both, and `.env.local` wins per-key, because `load_dotenv(override=False)`
# keeps the first value seen.
ENV_FILES = (REPO_ROOT / ".env.local", REPO_ROOT / ".env")

# The preferred location, and what the error message points at when neither
# file exists. Kept as a name because the launchers and the README both name it.
ENV_FILE = ENV_FILES[0]


def _str(name: str, default: str) -> str:
    value = os.environ.get(name)
    return default if value is None or value.strip() == "" else value.strip()


def _int(name: str, default: int) -> int:
    try:
        return int(_str(name, str(default)))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(_str(name, str(default)))
    except ValueError:
        return default


def _bool(name: str, default: bool) -> bool:
    return _str(name, "1" if default else "0").lower() not in {"0", "false", "no", "off"}


def _ms(name: str, default_ms: float) -> float:
    """A millisecond knob, read as seconds.

    The tuning constants are named in milliseconds because that is how the
    reference implementation names them and how anybody reasoning about
    endpointing thinks; `silero.VAD.load` wants seconds. Converting in one place
    means the env var and the library never disagree about the unit.
    """
    return _float(name, default_ms) / 1000.0


@dataclass(frozen=True)
class Settings:
    # ── LiveKit Cloud ───────────────────────────────────────────────────────
    # Read by livekit-agents itself as well as by tools/mint_token.py. The
    # worker authenticates to the server with the key and secret; the phone
    # never sees either, it gets a short-lived token minted by Nest.
    livekit_url: str
    livekit_api_key: str
    livekit_api_secret: str

    # ── The sidecar: the only place a model runs ────────────────────────────
    sidecar_url: str
    sidecar_stt_timeout: float
    sidecar_tts_timeout: float

    # ── The deterministic engine ────────────────────────────────────────────
    api_url: str
    api_token: str
    api_timeout: float

    # ── Silero VAD, STT segmentation instance ───────────────────────────────
    silero_min_speech: float
    silero_min_silence: float
    silero_prefix_pad: float
    silero_activation: float
    silero_deactivation: float
    silero_max_buffered_speech: float
    silero_force_cpu: bool

    # ── Silero VAD, barge-in instance ───────────────────────────────────────
    barge_min_sec: float
    barge_min_silence: float
    allow_interruptions: bool

    # ── The turn boundary ───────────────────────────────────────────────────
    turn_commit_grace: float

    # ── Interim transcripts ─────────────────────────────────────────────────
    interim_enabled: bool
    interim_every: float
    interim_min_speech: float

    # ── Session ─────────────────────────────────────────────────────────────
    language: str
    session_id: str
    room_prefix: str

    # ── Operations ──────────────────────────────────────────────────────────
    health_port: int
    log_level: str
    frame_ms: int

    @staticmethod
    def load() -> "Settings":
        return Settings(
            livekit_url=_str("LIVEKIT_URL", ""),
            livekit_api_key=_str("LIVEKIT_API_KEY", ""),
            livekit_api_secret=_str("LIVEKIT_API_SECRET", ""),
            # AI_SIDECAR_URL is the name Nest already uses for the same service
            # in .env.local. Reusing it means one value configures both callers.
            sidecar_url=_str("AI_SIDECAR_URL", "http://127.0.0.1:8801").rstrip("/"),
            # Whisper `small` on int8 CPU decodes a 10-second utterance in a few
            # seconds on this box, and the box is also holding Ollama. 60 s is
            # not a latency budget, it is the point at which something is wrong.
            sidecar_stt_timeout=_float("MEDIHIVE_STT_TIMEOUT", 60.0),
            sidecar_tts_timeout=_float("MEDIHIVE_TTS_TIMEOUT", 60.0),
            api_url=_str("MEDIHIVE_API_URL", "http://127.0.0.1:3000/api").rstrip("/"),
            # Normally supplied per job in the dispatch metadata by Nest, which
            # is the only thing that should be minting patient-scoped tokens.
            # This env var is the development fallback — see README.
            api_token=_str("MEDIHIVE_API_TOKEN", ""),
            # The engine answers in ~15 ms by design. A 15 s ceiling catches a
            # Nest that is down without making a patient wait on a dead socket.
            api_timeout=_float("MEDIHIVE_API_TIMEOUT", 15.0),
            # ── Reference implementation's tuned defaults, verbatim ──────────
            # From shivu0070/local-voice-ai's .env.example. They are starting
            # values chosen for a patient who pauses mid-sentence, not library
            # defaults: Silero's own are 550 ms silence / 0.5 activation, which
            # cuts a hesitant speaker off mid-symptom.
            silero_min_speech=_ms("SILERO_MIN_SPEECH_MS", 50.0),
            silero_min_silence=_ms("SILERO_MIN_SILENCE_MS", 650.0),
            silero_prefix_pad=_ms("SILERO_PREFIX_PAD_MS", 900.0),
            silero_activation=_float("SILERO_ACTIVATION", 0.26),
            silero_deactivation=_float("SILERO_DEACTIVATION", 0.16),
            # A patient describing a symptom can talk for a while. 60 s is the
            # library default and also roughly where a WAV starts to approach
            # the sidecar's 10 MB upload ceiling at 16 kHz mono.
            silero_max_buffered_speech=_float("SILERO_MAX_BUFFERED_SPEECH", 60.0),
            # Silero is a 1.8 MB ONNX graph. On CPU it costs no VRAM and avoids
            # a per-chunk round trip to a GPU that is holding Ollama.
            silero_force_cpu=_bool("SILERO_FORCE_CPU", True),
            barge_min_sec=_float("BARGE_MIN_SEC", 0.2),
            barge_min_silence=_ms("BARGE_MIN_SILENCE_MS", 250.0),
            allow_interruptions=_bool("MEDIHIVE_ALLOW_INTERRUPTIONS", True),
            # How long a final transcript may sit unclaimed before the worker
            # posts it anyway.
            #
            # The turn is normally started by livekit-agents' own end-of-turn
            # commit rather than by the raw STT final — see the note on
            # [CaseTakingAgent] in agent.py. That commit is what stops the
            # library cutting our own question off, and it is reliable: across
            # every turn in agent.log it landed 0.13-0.84 s after the final.
            #
            # But it is now the *only* thing that starts a turn, so a commit
            # that never comes is a patient who answers into silence forever.
            # This is the backstop. It is set above the library's own
            # `max_delay` of 3.0 s, so it only ever fires when the commit has
            # genuinely been lost rather than merely been slow.
            turn_commit_grace=_float("MEDIHIVE_TURN_COMMIT_GRACE_SEC", 3.5),
            # Interim transcripts cost a whole extra Whisper decode each.
            # On by default because partials on the way back are the point of
            # the design; the knob exists because this box has run at 1 GB free.
            interim_enabled=_bool("MEDIHIVE_INTERIM_TRANSCRIPTS", True),
            # A floor, not a cadence. Only one interim runs at a time, and a
            # decode on this box takes 2-3.5 s, so the observed spacing is the
            # decode time and this value is almost never the binding constraint.
            interim_every=_float("MEDIHIVE_INTERIM_EVERY_SEC", 1.4),
            # 3 s, raised from the 0.9 s this started at, on a measurement.
            #
            # An interim still in flight when the patient stops talking is
            # cancelled — a partial that lands after the final would overwrite
            # good text with worse. Timed on this box: a Whisper decode takes
            # 2-3.5 s, so for any utterance shorter than about 4 s the interim
            # is *always* cancelled before it can be shown. It is not merely
            # wasted: cancelling the HTTP request does not stop the sidecar
            # decoding, so that dead decode goes on competing for the same CPU
            # the real transcript needs, and the final arrives later than it
            # would have with interims off.
            #
            # Most answers in an interview are short — "three days", "severe".
            # At 0.9 s every one of them paid for a partial nobody ever saw. At
            # 3 s they cost nothing, and a patient telling a long story still
            # gets partials from roughly 5.5 s onward.
            # 1.5, lowered from 3.0 — and the measurement that set 3.0 is the
            # reason, not a change of mind.
            #
            # 3.0 was correct when a decode took 2.8-5.2 s on CPU: an interim
            # started earlier could never finish before the patient stopped
            # talking, so it was always cancelled, and cancelling the HTTP
            # request does not stop the sidecar decoding — the dead decode
            # competed for the CPU the real transcript needed. Measured across
            # 11 turns at that setting: 3 interims started, 3 cancelled, **0
            # ever reached the patient**.
            #
            # On CUDA a decode is ~400 ms, so that no longer holds. At 3.0 the
            # first partial lands ~3.5 s after the patient starts speaking and
            # covers 3 of 4 long utterances and **0 of 8 short answers** — which
            # is almost every clinical answer. At 1.5 it lands ~1.6-1.9 s and
            # covers most of them. A cancelled interim now costs ~90-140 ms.
            interim_min_speech=_float("MEDIHIVE_INTERIM_MIN_SPEECH_SEC", 1.5),
            language=_str("MEDIHIVE_SESSION_LANGUAGE", "en"),
            session_id=_str("MEDIHIVE_SESSION_ID", ""),
            room_prefix=_str("MEDIHIVE_ROOM_PREFIX", "case-"),
            health_port=_int("AGENT_HEALTH_PORT", 9090),
            log_level=_str("MEDIHIVE_LOG_LEVEL", "INFO").upper(),
            # 20 ms is what LiveKit's own encoders expect and what the reference
            # uses. It is independent of sample rate: the frame length in
            # samples is derived from the WAV's own rate. See audio.py.
            frame_ms=_int("MEDIHIVE_FRAME_MS", 20),
        )


_SECRET_SUFFIXES = ("SECRET", "TOKEN", "PASSWORD", "KEY")


def redact(name: str, value: str) -> str:
    """A value safe to print.

    Suffix match rather than an exact allowlist, so a variable added later is
    redacted by default rather than by somebody remembering. An API *key* is
    redacted along with the secret: it is not as damaging on its own, but it
    identifies the project, and there is no reason a log needs it.
    """
    if not value:
        return "(unset)"
    if any(name.upper().endswith(s) for s in _SECRET_SUFFIXES):
        return f"…{value[-4:]} ({len(value)} chars)"
    return value


def describe(settings: Settings) -> list[tuple[str, str]]:
    """(env var, value-as-printed) for the startup banner and /health."""
    s = settings
    return [
        ("LIVEKIT_URL", redact("LIVEKIT_URL", s.livekit_url)),
        ("LIVEKIT_API_KEY", redact("LIVEKIT_API_KEY", s.livekit_api_key)),
        ("LIVEKIT_API_SECRET", redact("LIVEKIT_API_SECRET", s.livekit_api_secret)),
        ("AI_SIDECAR_URL", s.sidecar_url),
        ("MEDIHIVE_API_URL", s.api_url),
        ("MEDIHIVE_API_TOKEN", redact("MEDIHIVE_API_TOKEN", s.api_token)),
        ("MEDIHIVE_SESSION_LANGUAGE", s.language),
        ("MEDIHIVE_SESSION_ID", s.session_id or "(from room name or job metadata)"),
        ("SILERO_MIN_SPEECH_MS", f"{s.silero_min_speech * 1000:.0f}"),
        ("SILERO_MIN_SILENCE_MS", f"{s.silero_min_silence * 1000:.0f}"),
        ("SILERO_PREFIX_PAD_MS", f"{s.silero_prefix_pad * 1000:.0f}"),
        ("SILERO_ACTIVATION", f"{s.silero_activation}"),
        ("SILERO_DEACTIVATION", f"{s.silero_deactivation}"),
        ("BARGE_MIN_SEC", f"{s.barge_min_sec}"),
        ("BARGE_MIN_SILENCE_MS", f"{s.barge_min_silence * 1000:.0f}"),
        ("MEDIHIVE_ALLOW_INTERRUPTIONS", "1" if s.allow_interruptions else "0"),
        ("MEDIHIVE_TURN_COMMIT_GRACE_SEC", f"{s.turn_commit_grace}"),
        ("MEDIHIVE_INTERIM_TRANSCRIPTS", "1" if s.interim_enabled else "0"),
        ("MEDIHIVE_INTERIM_EVERY_SEC", f"{s.interim_every}"),
        ("AGENT_HEALTH_PORT", str(s.health_port)),
        ("MEDIHIVE_FRAME_MS", str(s.frame_ms)),
    ]


def load_env_file() -> Path | None:
    """Pull the first of [ENV_FILES] that exists into the environment.

    `override=False`: a variable already set in the shell wins. That is what
    makes `$env:SILERO_MIN_SILENCE_MS=900; .\\run.ps1` work for a single run
    without editing the shared credentials file. It is also what orders
    [ENV_FILES] — the earlier file is loaded first, so its value is the one
    that survives, key by key.

    Returns the first file actually loaded, which is what the startup banner
    prints, so a worker that came up on the wrong credentials says which file
    it read rather than leaving that to be guessed.
    """
    from dotenv import load_dotenv

    loaded: Path | None = None
    for candidate in ENV_FILES:
        if not candidate.exists():
            continue
        load_dotenv(candidate, override=False)
        if loaded is None:
            loaded = candidate
    return loaded
