"""`GET /healthz` — is the worker up, what is loaded, and what is it costing.

The reference implementation's health endpoint answers `ok`. On this box that
is not enough to be worth a port. 11.7 GB of RAM is shared between Ollama, the
Whisper/Piper sidecar, Docker, Nest and an ngrok tunnel, and it has been sitting
at 1-3 GB free. The question an operator actually has at 2am is not "is it
alive" but "which of these six things should I stop", so this reports RSS for
this process and the system's free memory alongside it.

Served from a daemon thread on `http.server`. It is three fields of JSON on
loopback; a second uvicorn to serve it would cost more memory than it reports.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Callable

logger = logging.getLogger(__name__)


@dataclass
class WorkerStatus:
    """Mutable, written by the worker, read by the handler thread.

    Plain attribute assignment with no lock: every field is a single reference
    or an int, CPython's GIL makes those assignments atomic, and a health page
    that reads one field from just before an update and one from just after is
    reporting a real instant that happened to fall mid-turn.
    """

    connected: bool = False
    room: str | None = None
    session_id: str | None = None
    language: str = "en"
    turns: int = 0
    interims: int = 0
    interruptions: int = 0
    # Questions whose audio was cut off before the patient could have heard
    # them. Distinct from `interruptions`, which counts every barge-in: this
    # one counts only the ones early enough that the next answer cannot be
    # treated as an answer to that question.
    unheard_questions: int = 0
    # Finals the library never closed a turn for, posted by the watchdog
    # instead. Should be zero; anything else means the end-of-turn commit is
    # being lost and the backstop in agent.py is carrying the interview.
    uncommitted_turns: int = 0
    # How many times the audio input had to be moved to a reconnecting phone.
    # Nonzero means patients are dropping and coming back, which is a network
    # story an operator otherwise has no way to see.
    relinks: int = 0
    agent_state: str = "initializing"
    last_error: str | None = None
    spoken_via: str | None = None
    tts_refused: str | None = None
    models: dict[str, Any] = field(default_factory=dict)
    extra: Callable[[], dict[str, Any]] | None = None

    def snapshot(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "status": "ok" if self.connected else "starting",
            "connected": self.connected,
            "room": self.room,
            "sessionId": self.session_id,
            "language": self.language,
            "turns": self.turns,
            "interimTranscripts": self.interims,
            # Barge-ins. livekit-agents does not log these, so the worker times
            # each `say()` against the audio it handed over. See agent.py.
            "interruptions": self.interruptions,
            "unheardQuestions": self.unheard_questions,
            "uncommittedTurns": self.uncommitted_turns,
            "participantRelinks": self.relinks,
            "agentState": self.agent_state,
            "lastError": self.last_error,
            # Which engine actually spoke last, straight from the sidecar's
            # X-TTS-Provider header. The one thing that proves a language was
            # not quietly substituted.
            "spokenVia": self.spoken_via,
            "ttsRefusedFor": self.tts_refused,
            # No model is loaded *in this process* except Silero. Whisper and
            # Piper are the sidecar's, on purpose, and are reported as such so
            # nobody goes looking for them in this process's RSS.
            "models": self.models,
            "memory": _memory(),
        }
        if self.extra is not None:
            try:
                payload.update(self.extra())
            except Exception as exc:  # pragma: no cover - diagnostics only
                payload["extraError"] = repr(exc)
        return payload


def _memory() -> dict[str, Any]:
    try:
        import psutil

        process = psutil.Process(os.getpid())
        info = process.memory_info()
        virtual = psutil.virtual_memory()
        return {
            # RSS of this worker process. On a box with 1 GB free this is the
            # number that decides whether anything else can start.
            "rssMb": round(info.rss / (1024 * 1024), 1),
            "vmsMb": round(getattr(info, "vms", 0) / (1024 * 1024), 1),
            "systemTotalMb": round(virtual.total / (1024 * 1024), 1),
            "systemAvailableMb": round(virtual.available / (1024 * 1024), 1),
            "systemPercentUsed": virtual.percent,
        }
    except Exception as exc:  # pragma: no cover
        return {"error": repr(exc)}


def serve(status: WorkerStatus, port: int) -> HTTPServer | None:
    """Start the health server on a daemon thread. Never fatal.

    A worker that cannot bind its health port is still a worker that can take a
    patient's interview. The port is far more likely to be busy because a
    previous run has not let go of it yet, and refusing to start then would be
    the monitoring killing the thing it monitors.
    """

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            if self.path.rstrip("/") not in ("/healthz", "/health", ""):
                self.send_response(404)
                self.end_headers()
                return
            body = json.dumps(status.snapshot(), indent=2).encode("utf-8")
            self.send_response(200 if status.connected else 503)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt: str, *args: Any) -> None:
            # http.server logs every request to stderr by default, which would
            # bury the turn log under a monitor's polling.
            return

    try:
        # Loopback only. This endpoint names the session id and the room; it
        # authenticates nobody and has no business being reachable off the box.
        httpd = HTTPServer(("127.0.0.1", port), Handler)
    except OSError as exc:
        logger.warning("health server could not bind 127.0.0.1:%d: %s", port, exc)
        return None

    threading.Thread(target=httpd.serve_forever, daemon=True, name="health").start()
    logger.info("health server on http://127.0.0.1:%d/healthz", port)
    return httpd
