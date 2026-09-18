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
ENV_FILE = REPO_ROOT / ".env.local"


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

    # ── Interim transcripts ─────────────────────────────────────────────────
    interim_enabled: bool
    interim_every: float
    interim_min_speech: float

    # ── Streaming synthesis ─────────────────────────────────────────────────
    tts_streaming: bool

    # ── Gemma, for wording only ─────────────────────────────────────────────
    llm_phrasing: bool
    ollama_url: str
    ollama_model: str
    llm_timeout: float
    llm_first_token_timeout: float
    llm_max_chars: int

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
            # `/tts/stream` rather than `/tts`. On by default: it is the same
            # audio from the same provider, cut into pieces, and it is what
            # makes a barge-in stop the synthesiser as well as the speaker.
            # Set to 0 to fall back to whole-WAV synthesis — which is worth
            # doing exactly once, to find out whether a stutter is the stream
            # or the box.
            tts_streaming=_bool("MEDIHIVE_TTS_STREAMING", True),
            # OFF by default, and this is a clinical decision rather than a
            # performance one.
            #
            # With it on, gemma3:4b rewords each question before it is spoken.
            # The engine still chooses the field, the phrasebook still supplies
            # the meaning, red flags still fire on the engine's own text, and a
            # model failure falls back to the reviewed wording — see llm.py. But
            # a fluent rewording that asks something subtly different is not
            # detectable by any guard in that file, and nobody has reviewed it.
            #
            # So: on for a demo, on for a box where somebody is listening to
            # every question, and off by default in front of a patient until a
            # clinician has signed the phrasing path off the way they sign a
            # phrasebook off.
            llm_phrasing=_bool("MEDIHIVE_LLM_PHRASING", False),
            # 8080 on this deployment, not Ollama's stock 11434. Same value the
            # sidecar reads, and the same trap: a default that points at 11434
            # produces a worker that starts cleanly and silently never phrases.
            ollama_url=_str("OLLAMA_URL", "http://127.0.0.1:8080").rstrip("/"),
            ollama_model=_str("MEDIHIVE_LLM_MODEL", "gemma3:4b"),
            # The whole generation. Long, because it is not the thing the
            # patient waits on — the first-token deadline below is.
            llm_timeout=_float("MEDIHIVE_LLM_TIMEOUT", 20.0),
            # What the patient actually waits on, and the number to tune.
            # gemma3:4b warm answers in a few hundred milliseconds; cold it
            # takes ~31 s to load, which this is designed to give up on rather
            # than sit through. Every give-up is a question asked in the
            # engine's own words, which is a complete question.
            llm_first_token_timeout=_float("MEDIHIVE_LLM_FIRST_TOKEN_SEC", 2.5),
            # About two spoken sentences. A reworded clinical question that is
            # longer than this is not a rewording.
            llm_max_chars=_int("MEDIHIVE_LLM_MAX_CHARS", 320),
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
        ("MEDIHIVE_INTERIM_TRANSCRIPTS", "1" if s.interim_enabled else "0"),
        ("MEDIHIVE_INTERIM_EVERY_SEC", f"{s.interim_every}"),
        ("MEDIHIVE_TTS_STREAMING", "1" if s.tts_streaming else "0"),
        ("MEDIHIVE_LLM_PHRASING", "1" if s.llm_phrasing else "0"),
        ("OLLAMA_URL", s.ollama_url),
        ("MEDIHIVE_LLM_MODEL", s.ollama_model),
        ("MEDIHIVE_LLM_FIRST_TOKEN_SEC", f"{s.llm_first_token_timeout}"),
        ("MEDIHIVE_LLM_MAX_CHARS", str(s.llm_max_chars)),
        ("AGENT_HEALTH_PORT", str(s.health_port)),
        ("MEDIHIVE_FRAME_MS", str(s.frame_ms)),
    ]


def load_env_file() -> Path | None:
    """Pull hms_v2/.env.local into the environment if it is there.

    `override=False`: a variable already set in the shell wins. That is what
    makes `$env:SILERO_MIN_SILENCE_MS=900; .\\run.ps1` work for a single run
    without editing the shared credentials file.
    """
    if not ENV_FILE.exists():
        return None
    from dotenv import load_dotenv

    load_dotenv(ENV_FILE, override=False)
    return ENV_FILE
