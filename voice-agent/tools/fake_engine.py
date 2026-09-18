"""A stand-in for Nest's case-taking routes. **Development only. Not clinical.**

The real engine lives in hms_v2/src/modules/case-taking. This serves the same
two routes with the same response shape so the worker's turn loop can be tested
without a database, a JWT or a running Nest:

    GET  /api/case-taking/sessions/:id          -> the question on the table
    POST /api/case-taking/sessions/:id/turns    -> accept an answer, next question

It walks a fixed list of questions and does no clinical reasoning whatsoever —
no presence derivation, no validation, no red-flag rules. Nothing here should
ever be mistaken for the engine; it exists to answer the worker with correctly
shaped JSON so that `agent.py`'s posting, parsing and speaking can be exercised.

The shape is taken from `TurnResult` and `NextQuestionView` in
case-taking.service.ts, and the request shape from `SubmitTurnDto`. If the real
DTO changes, this will drift, and the worker's own tests against the real Nest
are what should catch it.

    python tools/fake_engine.py --port 3099

## `--loop`, and why a latency run needs it

A measurement run wants twenty turns from one session and does not care what
the questions are; three questions and then `null` means the agent correctly
stops speaking and the probe correctly records nothing. `--loop` wraps the
index so the stub never runs out. It makes the stub even less like the engine
than it already is, which is fine for timing and would not be fine for
anything else.

The prompts below are **real**: each is a `prompt` string from the engine's own
src/modules/case-taking/engine/field-registry.ts joined to the matching answer
hint from its phrasebook.ts, which is exactly how the live engine composes what
a patient hears. They were chosen to reproduce the length distribution
tools/bench_engine.py measured against live Nest — 38 to 166 characters, median
74 — because Piper's synthesis time scales with the character count and a stub
whose questions are half the length of the engine's reports a TTS cost that is
half the real one. The stub's lengths are 38/59/63/74/89/137/141, median 74.
"""

from __future__ import annotations

import argparse
import json
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer

QUESTIONS = [
    {
        "fieldPath": "hpi.aggravating_factors",
        "section": "hpi",
        "label": "Aggravating factors",
        "kind": "text",
        "prompt": 'Is there anything that makes it worse?',
    },
    {
        "fieldPath": "hpi.associated.fever",
        "section": "hpi",
        "label": "Fever",
        "kind": "boolean",
        "prompt": 'Have you had a fever along with this? You can answer yes or no.',
    },
    {
        "fieldPath": "hpi.duration",
        "section": "hpi",
        "label": "Duration",
        "kind": "duration",
        "prompt": 'How long have you had this problem? For example: three days, or two weeks.',
    },
    {
        "fieldPath": "ros.constitutional.rigors",
        "section": "ros",
        "label": "Rigors",
        "kind": "boolean",
        "prompt": 'Have you had shaking chills where you could not stop shivering? You can answer yes or no.',
    },
    {
        "fieldPath": "hpi.severity",
        "section": "hpi",
        "label": "Severity",
        "kind": "scale",
        "prompt": 'How bad is it right now? Please give a number from 0 to 10.',
    },
    {
        "fieldPath": "social.diet",
        "section": "social",
        "label": "Diet",
        "kind": "choice",
        "prompt": 'What is your usual diet — vegetarian, mixed, or something else? You can say: vegetarian, non-vegetarian, eggetarian, vegan or something else.',
        "choices": ['vegetarian', 'non_vegetarian', 'eggetarian', 'vegan', 'other'],
    },
    {
        "fieldPath": "past_medical.previous_hospitalisation",
        "section": "past_medical",
        "label": "Hospitalisation",
        "kind": "boolean",
        "prompt": 'Have you ever been admitted to a hospital overnight, for anything at all, including childbirth or an operation? You can answer yes or no.',
    },
]

# Set by --loop. Wraps the question index so a measurement run of twenty turns
# does not fall off the end of a three-question script.
LOOP = False

# Overridden by --output-language / --input-language; see main().
OUTPUT_LANGUAGE = "en"
INPUT_LANGUAGE = "en"
# Per session id, the index of the question currently on the table.
_state: dict[str, int] = {}


def _question(index: int) -> dict | None:
    if index >= len(QUESTIONS):
        if not LOOP:
            return None
        index = index % len(QUESTIONS)
    q = dict(QUESTIONS[index])
    q["remaining"] = len(QUESTIONS) - (index % len(QUESTIONS))
    return q


def _result(
    session_id: str, index: int, *, turn_id: str, started: float, get: bool = False
) -> dict:
    """The POST shape, or the GET shape, which differ in one crucial name.

    `POST /turns` returns the question under `nextQuestion`. `GET /sessions/:id`
    returns it under `currentQuestion`, along with the session's own
    `inputLanguage` and `outputLanguage`. This stub originally answered
    `nextQuestion` on both, which is exactly why it failed to catch the agent
    reading the wrong key and going silent on the opening question of every
    real session. It now answers what `describeSession` answers.
    """
    question = _question(index)
    if get:
        return {
            "id": session_id,
            "status": "in_progress",
            "language": OUTPUT_LANGUAGE,
            "inputLanguage": INPUT_LANGUAGE,
            "outputLanguage": OUTPUT_LANGUAGE,
            "interviewStatus": "in_progress" if question else "complete",
            "currentQuestion": question,
            "progress": {"answered": index, "total": len(QUESTIONS)},
            "redFlags": [],
            "patientMessage": None,
            "answeredCount": index,
        }
    return {
        "turnId": turn_id,
        "sessionId": session_id,
        "accepted": {
            "fieldPath": QUESTIONS[(index - 1) % len(QUESTIONS)]["fieldPath"] if index > 0 else None,
            "presence": "present" if index > 0 else None,
            "reason": "fake_engine",
            "needsPatientConfirmation": False,
            "factId": str(uuid.uuid4()) if index > 0 else None,
        },
        "extraction": {"queued": False, "reason": "fake_engine"},
        "nextQuestion": question,
        "interviewStatus": "in_progress" if question else "complete",
        "progress": {"answered": index, "total": len(QUESTIONS)},
        "redFlags": [],
        "patientMessage": None,
        "serverTimeMs": round((time.monotonic() - started) * 1000, 2),
    }


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _session_id(self, suffix: str = "") -> str | None:
        path = self.path.split("?", 1)[0].rstrip("/")
        prefix = "/api/case-taking/sessions/"
        if not path.startswith(prefix):
            return None
        rest = path[len(prefix) :]
        if suffix:
            if not rest.endswith(suffix):
                return None
            rest = rest[: -len(suffix)]
        return rest.strip("/") or None

    def _authorised(self) -> bool:
        # Presence only. The real routes verify a signed JWT and a permission;
        # this only checks that the worker is sending the header at all, which
        # is the thing a stub can usefully catch.
        return self.headers.get("Authorization", "").startswith("Bearer ")

    def do_GET(self) -> None:  # noqa: N802
        started = time.monotonic()
        session_id = self._session_id()
        if not session_id:
            return self._send(404, {"message": "not found"})
        if not self._authorised():
            return self._send(401, {"message": "missing bearer token"})
        index = _state.setdefault(session_id, 0)
        print(f"  GET  session {session_id} -> question #{index}", flush=True)
        self._send(200, _result(session_id, index, turn_id="", started=started, get=True))

    def do_POST(self) -> None:  # noqa: N802
        started = time.monotonic()
        session_id = self._session_id("/turns")
        if not session_id:
            return self._send(404, {"message": "not found"})
        if not self._authorised():
            return self._send(401, {"message": "missing bearer token"})

        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self._send(400, {"message": "body is not JSON"})

        if body.get("modality") not in {
            "voice", "text", "choice", "skip", "no_answer", "uploaded_document", "correction"
        }:
            # Mirrors the real DTO's @IsIn(ANSWER_MODALITIES).
            return self._send(400, {"message": f"bad modality: {body.get('modality')!r}"})

        # flush=True: this is a stub whose whole value is the line it prints,
        # and a block-buffered stdout redirected to a file shows nothing at all
        # until the process exits.
        print(f"  POST session {session_id} body={json.dumps(body)}", flush=True)

        index = _state.get(session_id, 0) + 1
        _state[session_id] = index
        self._send(200, _result(session_id, index, turn_id=str(uuid.uuid4()), started=started))

    def log_message(self, fmt: str, *args) -> None:  # noqa: ANN002
        return


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=3099)
    parser.add_argument(
        "--output-language",
        default="en",
        help=(
            "what the questions are written in, as `GET /sessions/:id` reports it. "
            "The real engine pins this to `en`, so the one path it can never "
            "exercise is a TTS refusal: Piper serves en and hi and 503s on "
            "everything else. Passing `ta` here is the only way to see what a "
            "patient gets when the agent has a question and no voice to say it in."
        ),
    )
    parser.add_argument(
        "--input-language",
        default="en",
        help="what the patient speaks, as reported to the agent for Whisper",
    )
    parser.add_argument(
        "--loop",
        action="store_true",
        help="never run out of questions; for latency runs, see the module docstring",
    )
    args = parser.parse_args()
    global LOOP, OUTPUT_LANGUAGE, INPUT_LANGUAGE
    LOOP = args.loop
    OUTPUT_LANGUAGE = args.output_language
    INPUT_LANGUAGE = args.input_language
    print(f"fake engine on http://127.0.0.1:{args.port}/api/case-taking  (NOT CLINICAL)", flush=True)
    HTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
