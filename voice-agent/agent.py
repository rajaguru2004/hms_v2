"""The participant that joins the patient's room.

    Phone (Flutter) --WebRTC--> LiveKit Cloud
                                     ^
                                     | joins as a participant
                               THIS worker
      VAD -> STT (sidecar) -> POST Nest /turns -> TTS (sidecar) -> audio back

## What streams, and what deliberately does not

Audio up, partial transcripts back. The patient's microphone streams
continuously with VAD endpointing; interim transcripts go back as they form;
the next question's audio is pushed down as soon as the turn resolves.

No LLM tokens stream, because there are none. The next question is a
deterministic string that `POST /turns` returns in about fifteen milliseconds —
the engine's question selection, presence derivation and red-flag rules are all
pure and synchronous. There is nothing to stream for a string that is already
in hand, and pretending otherwise would add a token queue, a sentence splitter
and a cancellation protocol to move fifteen milliseconds of latency around.

## Why there is no built-in pipeline here

`AgentSession` is constructed with `stt=` and `vad=` and **no `llm=` and no
`tts=`**. With those two set, livekit-agents owns the turn: it would call an LLM
with a chat context and speak the reply. That is the wrong shape for a clinical
interview, where the next question comes from a deterministic engine that also
owns validation, red flags and escalation. So the loop is hand-rolled:
`Agent.on_user_turn_completed` -> POST -> `session.say(text=..., audio=...)`.

It hangs off the *turn commit* rather than off `user_input_transcribed`, which
is the one non-obvious thing in this file and is explained at length on
[CaseTakingAgent]. In one line: a transcript is not a turn, the library closes
the turn a few hundred milliseconds later, and starting to speak before it does
means the library cuts the question off as if the patient had barged in.

The agent never makes a clinical decision. It transcribes, posts, and speaks
what comes back. Every judgement call — is that answer valid, is this a red
flag, what comes next, should this escalate — is the engine's.

## Two VAD instances

One drives STT segmentation inside [SidecarSTT]: it decides where an utterance
ends, tuned to wait `SILERO_MIN_SILENCE_MS` (650 ms) so a patient who pauses
mid-symptom is not cut off. The other is handed to `AgentSession` for barge-in:
it only has to notice that the patient has started talking over the question, so
it is tuned short and paired with `turn_handling={"interruption": {"min_duration":
BARGE_MIN_SEC}}` (0.2 s, about one word).

They are separate objects because they want opposite tunings. Sharing one — as
the reference implementation ends up doing, both handles resolving to the same
`proc.userdata["silero_vad"]` — forces a single `min_silence_duration` to serve
both jobs, and 650 ms of patience in the endpointer is 650 ms of the agent
talking over the patient in the interrupter. A second Silero is a 1.8 MB ONNX
graph; it is the cheapest thing in this process.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import time
from typing import Any, Callable

from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    StopResponse,
    cli,
    llm,
    room_io,
)
from livekit.plugins import silero

import health
import timing
from audio import frames_duration, frames_stream, wav_to_frames
from config import Settings, describe, load_env_file
from delivery import TurnBuffer, speak_all
from engine import (
    CaseTakingClient,
    EngineRejected,
    EngineUnavailable,
    TurnResult,
    utterances,
)
from sidecar import SidecarClient, SidecarRefusal, SidecarUnavailable, split_for_speech
from stt_adapter import SidecarSTT

logger = logging.getLogger("medihive.agent")

# Read hms_v2/.env.local, then hms_v2/.env, at *import* time — before both
# Settings.load() and AGENT_NAME below, each of which reads os.environ.
#
# Not in `main()`, and not under `if __name__ == "__main__"`. `cli.run_app` may
# run jobs in spawned subprocesses, and a spawned child re-imports this module
# with `__name__ == "__main__"` false. A credentials load that only happens in
# the parent leaves the child with default settings and no LiveKit URL, which
# presents as a worker that starts, registers, and then cannot join anything.
_ENV_FILE = load_env_file()

SETTINGS = Settings.load()
STATUS = health.WorkerStatus(language=SETTINGS.language)

# The name Nest dispatches to. Must match VOICE_AGENT_NAME in
# case-taking.service.ts — they are two languages naming one worker, and if they
# drift the dispatch is created for an agent nobody is registered as, so the
# patient sits in a room no one ever joins.
#
# ── Why this is an environment variable and not just "medihive"
#
# The name is the *only* thing LiveKit routes a dispatch on, and a LiveKit
# project is shared by everyone holding its credentials. Two machines running
# this worker under one name are two candidates for every job, and LiveKit
# hands each job to one of them — so a developer's interview is served by
# whichever worker won that race, which may be a checkout on somebody else's
# desk that cannot reach this machine's API or sidecar at 127.0.0.1.
#
# That failure is silent and it is sticky. The foreign worker joins, publishes
# no audio because it has nothing to say, and `dispatchVoiceAgent` then refuses
# to dispatch again because an agent is already in the room. The handset sees a
# room with a participant that never speaks, never raises `carriesTheVoice`,
# and quietly falls back to record-then-upload — with every service on this
# machine healthy and nothing in any log to point at.
#
# So each environment names its own worker. Set VOICE_AGENT_NAME in
# hms_v2/.env.local, which is untracked and which both this worker and Nest
# read before .env. The default keeps a single-machine setup working untouched.
AGENT_NAME = os.environ.get("VOICE_AGENT_NAME", "").strip() or "medihive"

# Loading Silero and opening two HTTP clients is not instant, and the default
# 10 s is measured on a box that is not also holding Ollama and Docker.
#
# `agent_name` is NOT set here: on livekit-agents 1.8 it belongs on the
# `@server.rtc_session()` decorator below, not on the constructor, and passing
# it here is a TypeError rather than a no-op. See the note on `entrypoint`.
server = AgentServer(initialize_process_timeout=120.0)


def _vad(*, min_silence: float, min_speech: float, prefix_pad: float) -> silero.VAD:
    return silero.VAD.load(
        sample_rate=16000,  # Silero supports 8 k or 16 k. Whisper wants 16 k.
        force_cpu=SETTINGS.silero_force_cpu,
        min_speech_duration=min_speech,
        min_silence_duration=min_silence,
        prefix_padding_duration=prefix_pad,
        activation_threshold=SETTINGS.silero_activation,
        deactivation_threshold=SETTINGS.silero_deactivation,
        max_buffered_speech=SETTINGS.silero_max_buffered_speech,
    )


def prewarm(proc: JobProcess) -> None:
    """Load both VADs once, before a patient is waiting on them.

    Silero is small but its ONNX session still takes a moment to build, and the
    moment would otherwise land on the first thing the patient says.
    """
    proc.userdata["vad_stt"] = _vad(
        min_silence=SETTINGS.silero_min_silence,
        min_speech=SETTINGS.silero_min_speech,
        prefix_pad=SETTINGS.silero_prefix_pad,
    )
    proc.userdata["vad_barge"] = _vad(
        # Short on purpose: this one only has to notice speech starting.
        min_silence=SETTINGS.barge_min_silence,
        min_speech=SETTINGS.silero_min_speech,
        # No prefix padding — its frames are never transcribed, so there is no
        # clipped consonant to protect and no reason to buffer 900 ms of audio.
        prefix_pad=0.0,
    )
    STATUS.models = {
        "sileroVad": "loaded (x2: stt segmentation, barge-in)",
        "whisper": f"remote at {SETTINGS.sidecar_url}/stt",
        "piper": f"remote at {SETTINGS.sidecar_url}/tts",
    }
    logger.info("prewarm: two Silero VAD instances loaded on CPU")


server.setup_fnc = prewarm


class CaseTakingAgent(Agent):
    """Transport only — and the one place the turn is allowed to begin.

    ## The race this exists to end

    The turn used to start on `user_input_transcribed(is_final=True)`, which is
    the moment [SidecarSTT] finishes a Whisper decode. That was survivable while
    the reply came from a language model: gemma3:4b took seconds, and in those
    seconds livekit-agents finished its *own* end-of-turn pipeline and committed
    the user's turn. The question was spoken afterwards, into a settled session.

    The deterministic engine answers in fifteen milliseconds. The worker now
    wins that race every time, and winning it is the bug:
    `AgentActivity._user_turn_completed_impl` reaches

        await current_speech.interrupt(source="user_turn")

    (voice/agent_activity.py) a few hundred milliseconds later and cuts off the
    question we have just started asking — because from the library's side a
    user turn has closed while the agent is speaking, which is a barge-in.

    Measured in agent.log, one session, 2026-09-20 20:06-20:08:

        20:07:17,908  final: "I've been unusually drowsy for 2 hours"
        20:07:18,032  agent state listening -> speaking
        20:07:18,035  user turn committed          <- 3 ms later
        20:07:18,040  interrupted after 0.01s of 3.08s:
                      "Have you had shaking chills where you could not stop..."

    Five of that session's nine questions were cut off this way, one of them
    after ten milliseconds. And because `session.say(text=...)` forwards the
    whole transcript to the room the instant it is called, every one of them
    **appeared on the patient's screen in full**. That is the report this fixes:
    the bot skips messages and they show up only as text.

    ## The fix, and why it is this one

    The turn starts here instead — `on_user_turn_completed` is the library's own
    "the patient has finished, it is your move". By the time it runs, the
    interrupt above has already happened and found nothing to cut; anything that
    interrupts the question from here on is the patient genuinely talking over
    it, which is what barge-in is for.

    It costs the library's endpointing delay, measured at 0.13-0.84 s across
    every turn in the log. That is not a regression to apologise for: a reply
    that lands fifteen milliseconds after somebody stops speaking is not what a
    conversation sounds like.

    Two things are deliberately *not* done here:

      * **No clinical judgement.** This reads a transcript and hands it on. The
        question, the validation, the red flags and the escalation are the
        engine's, exactly as before.
      * **No work in the hook.** It starts a task and returns.
        `_user_turn_completed_impl` awaits the previous hook before handling the
        next turn, so blocking here would delay the patient's *next* answer by
        the length of the question we are asking.

    `StopResponse` is raised rather than returned so the library never reaches
    reply generation. With no `llm=` it would return anyway one branch later;
    raising says it is a decision rather than a consequence of the session's
    shape, and keeps it true if an LLM is ever attached for something else.
    """

    def __init__(self, on_turn: Callable[[str, float], None]) -> None:
        super().__init__(
            # Inert. There is no LLM in this session, so nothing ever reads
            # these. `Agent` requires them, and the string is here to tell the
            # next reader that its absence is not an oversight.
            instructions=(
                "Transport only. Question selection, validation, red flags and "
                "escalation belong to the deterministic case-taking engine."
            )
        )
        self._on_turn = on_turn

    async def on_user_turn_completed(
        self, turn_ctx: llm.ChatContext, new_message: llm.ChatMessage
    ) -> None:
        text = (new_message.text_content or "").strip()
        confidence = float(new_message.transcript_confidence or 0.0)
        timing.mark("turn.committed", chars=len(text), confidence=round(confidence, 3))
        self._on_turn(text, confidence)
        raise StopResponse


def _job_metadata(ctx: JobContext) -> dict[str, Any]:
    """Whatever Nest attached to the dispatch, as a dict.

    The metadata is the intended channel for the session id and the patient's
    bearer token: it is set by the API when it creates the dispatch, so the
    worker never has to guess and never has to hold a long-lived credential.
    Malformed metadata is logged and ignored rather than fatal — a worker that
    refuses to join leaves the patient in an empty room.
    """
    raw = (getattr(ctx.job, "metadata", "") or "").strip()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        logger.warning("job metadata is not JSON; ignoring it")
        return {}


def _resolve_session_id(ctx: JobContext, metadata: dict[str, Any]) -> str:
    """Three sources, most specific first.

    1. `sessionId` in the dispatch metadata — how production will do it.
    2. The room name, when it is `case-<sessionId>`. Lets a room created by
       hand behave correctly without a dispatch.
    3. `MEDIHIVE_SESSION_ID` — a single fixed session, for development.
    """
    from_metadata = str(metadata.get("sessionId") or "").strip()
    if from_metadata:
        return from_metadata

    room_name = ctx.room.name or ""
    prefix = SETTINGS.room_prefix
    if prefix and room_name.startswith(prefix) and len(room_name) > len(prefix):
        return room_name[len(prefix) :]

    return SETTINGS.session_id


# `agent_name` is what switches this worker from automatic to explicit dispatch,
# and that switch is the whole point.
#
# Without it, LiveKit creates the job itself for every room in the project. That
# sounds like the convenient option — the worker joins whatever appears — but a
# job LiveKit invented has no metadata, and metadata is the only channel that
# carries the patient's bearer token. So the worker joined, listened, and posted
# nothing, every time: `_job_metadata` had nothing to read, and the symptom was
# `no session id or token: listening only` on a room that was otherwise working
# perfectly — audio flowing both ways, `turns: 0`.
#
# With a name set, Nest creates the dispatch when it mints the patient's room
# pass, and attaches the session id and a token scoped to that one patient for
# the life of the room. The trade is that this worker no longer joins rooms
# nobody dispatched it to, which is the correct behaviour for a clinical
# interview, and leaves `connect --room <name>` working for the latency tooling.
@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: JobContext) -> None:
    ctx.log_context_fields = {"room": ctx.room.name}

    timing.mark("job.entrypoint", room=ctx.room.name)
    metadata = _job_metadata(ctx)
    session_id = _resolve_session_id(ctx, metadata)
    token = str(metadata.get("token") or "").strip() or SETTINGS.api_token
    language = str(metadata.get("language") or "").strip() or SETTINGS.language

    STATUS.room = ctx.room.name
    STATUS.session_id = session_id or None
    STATUS.language = language

    logger.info(
        "joining room=%s session=%s language=%s", ctx.room.name, session_id or "(none)", language
    )

    sidecar = SidecarClient(
        SETTINGS.sidecar_url,
        stt_timeout=SETTINGS.sidecar_stt_timeout,
        tts_timeout=SETTINGS.sidecar_tts_timeout,
    )
    engine = CaseTakingClient(SETTINGS.api_url, token, timeout=SETTINGS.api_timeout)

    vad_stt = ctx.proc.userdata.get("vad_stt") or _vad(
        min_silence=SETTINGS.silero_min_silence,
        min_speech=SETTINGS.silero_min_speech,
        prefix_pad=SETTINGS.silero_prefix_pad,
    )
    vad_barge = ctx.proc.userdata.get("vad_barge") or _vad(
        min_silence=SETTINGS.barge_min_silence,
        min_speech=SETTINGS.silero_min_speech,
        prefix_pad=0.0,
    )

    stt = SidecarSTT(
        client=sidecar,
        vad=vad_stt,
        language=language,
        interim_enabled=SETTINGS.interim_enabled,
        interim_every=SETTINGS.interim_every,
        interim_min_speech=SETTINGS.interim_min_speech,
    )

    session = AgentSession(
        stt=stt,
        vad=vad_barge,
        # No llm=, no tts=. The engine is the brain and the sidecar is the
        # voice, and both are reached over HTTP in the turn loop below.
        #
        # `turn_handling` rather than the `min_interruption_duration=` and
        # `resume_false_interruption=` arguments the reference implementation
        # uses. Those are the livekit-agents 1.3 spelling of exactly these two
        # settings; on 1.8.2 they still work but log
        #
        #   resume_false_interruption, min_interruption_duration are deprecated
        #   and will be removed in v2.0. Use turn_handling=TurnHandlingOptions(...)
        #
        # so the new spelling is used and the values are unchanged.
        turn_handling={
            "interruption": {
                "enabled": SETTINGS.allow_interruptions,
                # Explicitly VAD, not "adaptive". Adaptive wants the end-of-turn
                # transformer from livekit-plugins-turn-detector, which is not
                # installed on purpose — see requirements.txt. Naming the mode
                # means this is a decision rather than a fallback.
                "mode": "vad",
                # About one word of speech. BARGE_MIN_SEC, default 0.2 s.
                "min_duration": SETTINGS.barge_min_sec,
                # Auto-resume replays audio after what it decides was a false
                # interruption, which in an interview means re-asking a question
                # the patient has already started answering.
                "resume_false_interruption": False,
            },
        },
    )

    current_turn: asyncio.Task | None = None
    speaking_lock = asyncio.Lock()

    # The field the question on the table is asking about, or None before the
    # first question has been read.
    #
    # `SubmitTurnDto.fieldPath` is documented "The field being answered. Omit
    # for an opening narrative that belongs to no single field." Omitting it on
    # every turn — which is what this worker did — tells the engine that every
    # sentence a patient speaks is an opening narrative, and the engine responds
    # exactly as it should to that claim: it cannot bind the answer to a field,
    # so it queues the text for model extraction and asks the same question
    # again.
    #
    # Measured against the live engine, same session, same sentence:
    #
    #   text="I have a bad headache", no fieldPath
    #     -> accepted.fieldPath=null, presence=null,
    #        extraction={queued:true, reason:"narrative turn with no field"}
    #        nextQuestion=chief_complaint.symptom   (the same question again)
    #
    #   text="I have a bad headache", fieldPath="chief_complaint.symptom"
    #     -> accepted.presence="recorded", reason="extracted_value",
    #        extraction={queued:false, reason:"engine read the answer without a
    #        model"}, nextQuestion=hpi.associated.fainting
    #
    # Three things follow from the first case, in ascending order of harm. The
    # patient is asked a question they have already answered. The answer is
    # parked in an extraction queue that needs Ollama, which /health currently
    # reports as unavailable. And — this is the one that ended up in a clinical
    # record during run 1 — the *next* thing the patient says gets bound to the
    # still-open field, so "three days" (mistranscribed "Free days") was filed
    # as the chief complaint.
    #
    # So the field is tracked and sent. The worker is not deciding anything
    # clinical by doing so: it is reporting which question it just read out,
    # which is a fact only it holds.
    pending_field: str | None = None

    # Whether the patient has actually *heard* the question `pending_field`
    # names. Set only once its audio has finished; cleared the moment a new
    # question is remembered.
    #
    # The gap between those two moments is where a real misattribution lived.
    # A patient saying "I have had a headache since Monday" who pauses for
    # 1.2 s gets endpointed by Silero after 650 ms: the first half posts, the
    # engine answers with the next question, `pending_field` rebinds — and the
    # tail, "Since Monday", arrives while that question is still being
    # synthesised. It was then filed against `hpi.associated.fainting`, a
    # question nobody had asked, and the duration the patient actually gave was
    # destroyed.
    #
    # Whether a fragment is a continuation or a fresh answer is a genuine
    # judgement call. This is not: the patient cannot be answering a question
    # they have not heard yet. So the unheard case is simply not attributed —
    # see `run_turn`.
    pending_field_spoken: bool = False

    def remember_pending(result: TurnResult) -> None:
        """Record which field the question we are about to ask is for."""
        nonlocal pending_field, pending_field_spoken
        pending_field = result.next_question.field_path if result.next_question else None
        pending_field_spoken = False

    def mark_pending_spoken() -> None:
        """The question is out of the speaker; answers to it can now be bound."""
        nonlocal pending_field_spoken
        pending_field_spoken = True

    # ── Text to the phone ───────────────────────────────────────────────────

    async def publish(kind: str, payload: dict[str, Any]) -> None:
        """A structured message to whatever is in the room, on our own topic.

        Audio is not enough for the client. A question has a `fieldPath`, a
        `kind` and sometimes `choices` — a list of buttons the patient taps
        rather than speaks — and none of that survives being read aloud. So
        every question goes down twice: as audio, and as this.

        It is also the only way text reaches the phone when TTS refuses the
        language. `session.say(text=...)` cannot be used for that: with no
        `tts=` on the session and audio output enabled it raises
        "trying to generate speech from text without a TTS model".

        Failures are logged and swallowed. A data message that does not arrive
        must not take down an interview that is otherwise working.
        """
        try:
            body = json.dumps({"type": kind, "ts": int(time.time() * 1000), **payload})
            started = timing.mark("publish.start", kind=kind, bytes=len(body))
            await ctx.room.local_participant.publish_data(
                body.encode("utf-8"), reliable=True, topic="medihive.case-taking"
            )
            timing.span("publish.end", started, kind=kind)
        except Exception as exc:  # pragma: no cover - diagnostics only
            logger.warning("could not publish %s: %s", kind, exc)

    # ── Speaking ────────────────────────────────────────────────────────────

    async def synthesise(text: str) -> tuple[list[Any], str] | None:
        """One piece of engine text as audio frames, or None if it has no voice.

        Separated from playing it so the next piece can be synthesised while
        the current one is in the patient's ear. Piper takes a few hundred
        milliseconds per sentence and the round trip used to sit *between* two
        halves of the same question — a dead gap in the middle of a sentence,
        which is the single most artificial thing this worker did.

        On a refusal this publishes the text and returns None. It does not fall
        back to another language's voice. Which languages have a voice is the
        sidecar's to know and it changes — dropping a `.onnx` into its voices
        directory adds one without a restart — so this asks and believes the
        answer. Answering a session in a language it did not ask for would be a
        clinical record of a question the patient never understood. The text still
        reaches the phone as a data message, so the question is there to be
        read — which is why a refusal is not counted against delivery below.
        """
        timing.mark("say.begin", chars=len(text))
        try:
            wav, provider = await sidecar.speak(text, language)
        except SidecarRefusal as refusal:
            STATUS.tts_refused = language
            STATUS.last_error = refusal.patient_message
            logger.warning("no voice for %s; sending text only: %s", language, text)
            await publish(
                "speak",
                {
                    "phase": "end",
                    "text": text,
                    "spoken": False,
                    "complete": False,
                    "reason": refusal.patient_message,
                },
            )
            return None
        except SidecarUnavailable as exc:
            STATUS.last_error = str(exc)
            logger.error("tts unavailable: %s", exc)
            await publish(
                "speak",
                {
                    "phase": "end",
                    "text": text,
                    "spoken": False,
                    "complete": False,
                    "reason": "tts unavailable",
                },
            )
            return None

        STATUS.spoken_via = provider
        STATUS.tts_refused = None

        # Piper's own rate — 22050 Hz for the English voice — passed straight
        # through with no resampling here. `rtc.AudioFrame` carries the rate and
        # livekit-agents builds an `AudioResampler` to the room's output rate
        # when they differ (see voice/generation.py `_audio_forwarding_task`).
        # Resampling 22050 -> 48000 in numpy first would be a non-integer ratio
        # done worse, plus an extra copy of every utterance on a box with about
        # a gigabyte free.
        _t = timing.mark("say.decode_start", bytes=len(wav))
        frames = wav_to_frames(wav, frame_ms=SETTINGS.frame_ms)
        timing.span(
            "say.decode_end",
            _t,
            frames=len(frames),
            audio_ms=round(frames_duration(frames) * 1000.0, 1),
            rate=frames[0].sample_rate if frames else 0,
        )
        if not frames:
            logger.warning("tts returned no audio for: %s", text[:80])
            await publish(
                "speak",
                {
                    "phase": "end",
                    "text": text,
                    "spoken": False,
                    "complete": False,
                    "reason": "no audio",
                },
            )
            return None
        return frames, provider

    async def play(text: str, audio: tuple[list[Any], str]) -> bool:
        """Push one synthesised piece into the room. True if it played out whole.

        The return value is the honest one, and the reason this function exists
        apart from `session.say`. A speech that is cut off at 10 ms still
        resolves its handle normally and still forwarded its full transcript to
        the room, so from the caller's side an interrupted question and a spoken
        one were indistinguishable — which is exactly how a patient came to be
        shown six questions they had never heard.

        Takes `synthesise`'s result whole rather than unpacked, because
        [speak_all] hands it straight back without looking inside it — which is
        the only way that function can stay ignorant of what audio is.
        """
        frames, provider = audio
        await publish(
            "speak",
            {
                "phase": "start",
                "text": text,
                "spoken": True,
                "provider": provider,
                "sampleRate": frames[0].sample_rate,
            },
        )
        timing.mark("say.handle_create", chars=len(text))
        handle = session.say(
            text=text,
            audio=frames_stream(frames),
            allow_interruptions=SETTINGS.allow_interruptions,
            add_to_chat_ctx=True,
        )

        # Timed, because livekit-agents logs nothing when a speech is cut off:
        # grepping its output for "interrupt" finds only "adaptive interruption
        # is disabled" and "resumed false interrupted speech". Comparing how
        # long the handle took against how much audio was handed to it is the
        # only way to see a barge-in from outside the library — and an operator
        # asking "is barge-in even working" has no other evidence at all.
        expected = frames_duration(frames)
        started = time.monotonic()
        try:
            await handle
        except asyncio.CancelledError:
            # The turn was dropped under us — a newer answer arrived. Stop the
            # audio rather than letting it play on into a conversation that has
            # moved past it.
            with contextlib.suppress(Exception):
                handle.interrupt()
            raise
        spoke = time.monotonic() - started

        # A 25% margin: playout starts slightly before the first frame lands and
        # the last frame drains after the handle resolves, so an uninterrupted
        # utterance does not finish at exactly `expected`.
        complete = not (SETTINGS.allow_interruptions and spoke < expected * 0.75)
        timing.mark(
            "say.handle_done",
            spoke_ms=round(spoke * 1000.0, 1),
            expected_ms=round(expected * 1000.0, 1),
            interrupted=not complete,
        )
        if not complete:
            STATUS.interruptions += 1
            logger.info(
                "interrupted after %.2fs of %.2fs: %s", spoke, expected, text[:60]
            )
        else:
            logger.debug("spoke %.2fs of %.2fs", spoke, expected)
        await publish(
            "speak",
            {
                "phase": "end",
                "text": text,
                "spoken": True,
                "complete": complete,
                "spokenMs": round(spoke * 1000.0),
                "expectedMs": round(expected * 1000.0),
            },
        )
        return complete

    async def report_stt_problem(kind: str, code: str, detail: str) -> None:
        """Tell the room that we heard the patient and could not use it.

        Wired after `publish` exists rather than at construction, because the
        STT is built before the room handle this closes over.

        Nothing is spoken. There is no engine text for this, and synthesising
        the sidecar's sentence would put a line into the patient's ear that no
        clinician wrote — the thing removing MEDIHIVE_GREETING was about. It
        goes down as text, which is also the only form that is any use: for a
        refusal the sentence is "please type your answer", and a patient being
        told to type is by definition looking at the screen.

        `kind` is the difference between "this will never work, get the
        keyboard out" and "that one did not go through, say it again", and the
        client cannot infer it from the text.
        """
        STATUS.last_error = detail
        await publish(
            "stt",
            {
                "ok": False,
                "kind": kind,
                "language": code,
                "reason": detail,
                # A refusal for a language with no model is for the rest of the
                # interview; a sidecar that is restarting is for this utterance
                # only. The client offers the keyboard permanently for one and
                # a "say that again" for the other.
                "permanent": kind == "refused",
            },
        )

    stt.on_problem = report_stt_problem

    async def say_all(lines: list[str]) -> bool:
        """Speak the engine's lines, in the engine's order. True if heard whole.

        Serialised behind a lock: two overlapping speeches put two voices in the
        room at once. The lock is also what makes a cancelled turn stop cleanly
        — the cancellation lands while waiting for it.

        The loop itself is [speak_all] in delivery.py, which synthesises one
        piece ahead of playback and is explicit about which failures count as
        the patient not receiving the question. Both are things this worker got
        wrong and neither needs a room to be tested.
        """
        pieces = [piece for line in lines for piece in split_for_speech(line)]
        async with speaking_lock:
            return await speak_all(pieces, synthesise, play)

    # ── The turn ────────────────────────────────────────────────────────────

    async def run_turn(text: str, confidence: float) -> None:
        if not session_id:
            logger.error("no session id; cannot post a turn. Transcript was: %s", text)
            STATUS.last_error = "no session id"
            return
        if not engine.has_token:
            logger.error("no bearer token; cannot post a turn. Transcript was: %s", text)
            STATUS.last_error = "no bearer token"
            return

        started = time.monotonic()
        timing.mark("turn.begin", chars=len(text), confidence=round(confidence, 3))
        # Read once, before the await: `pending_field` is rebound by whichever
        # turn resolves next, and this answer belongs to the question that was
        # on the table when the patient started speaking, not to whatever is on
        # the table by the time the POST returns.
        #
        # And only if it has been *heard*. An utterance that arrives while the
        # question is still being spoken cannot be an answer to it — it is
        # almost always the tail of the previous answer, split off by the VAD's
        # 650 ms endpoint. Attributing it filed "Since Monday" against a
        # question about fainting; sending it unattributed makes it an opening
        # narrative, which is the case the engine's own extraction exists for.
        #
        # Deliberately not a guess about continuation-versus-new-answer: that
        # needs a product decision. This only declines to claim something the
        # worker cannot know.
        answering = pending_field if pending_field_spoken else None
        if pending_field and not pending_field_spoken:
            logger.info(
                "utterance arrived before %s had been spoken; sending it "
                "unattributed rather than filing it against an unheard question",
                pending_field,
            )
        try:
            result: TurnResult = await engine.submit_turn(
                session_id,
                text=text,
                field_path=answering,
                transcript_confidence=confidence,
            )
        except EngineRejected as rejected:
            # A 4xx is final. Not retried — retrying would write the same fact
            # twice — and not reinterpreted, because deciding what a rejected
            # turn means is the engine's job, not this worker's.
            STATUS.last_error = rejected.detail
            logger.error("turn rejected: %s", rejected)
            # `detail` is Nest's own sentence, and for the 4xx a patient can
            # actually hit it is written for them: a closed or expired
            # interview answers "We could not find that interview." Passing it
            # through is not this worker authoring patient text, it is this
            # worker not swallowing the engine's.
            await publish_error("engine", detail=rejected.detail,
                                status=rejected.status, final=True)
            return
        except EngineUnavailable as exc:
            STATUS.last_error = str(exc)
            logger.error("engine unavailable: %s", exc)
            await publish_error("engine", detail=str(exc), status=None, final=False)
            return

        STATUS.turns += 1
        STATUS.last_error = None
        # `accepted` is logged because it is the only place the engine says what
        # it did with the answer. A 200 means the turn was recorded, not that
        # the answer was understood: presence="not_assessed" with
        # reason="value_failed_field_shape" is a 200 in which the patient's
        # words were dropped on the floor, and without this line the operator
        # sees an accepted turn and a repeated question and nothing connecting
        # the two.
        accepted = result.accepted or {}
        logger.info(
            "turn %s accepted in %.0f ms (server %.1f ms) status=%s red_flags=%d "
            "field=%s presence=%s reason=%s",
            result.turn_id or "?",
            (time.monotonic() - started) * 1000,
            result.server_time_ms,
            result.interview_status,
            len(result.red_flags),
            accepted.get("fieldPath") or answering or "-",
            accepted.get("presence") or "-",
            accepted.get("reason") or "-",
        )

        remember_pending(result)
        await publish_turn(result)

        lines = utterances(result)
        timing.mark("turn.lines", lines=len(lines), chars=sum(len(l) for l in lines))
        if not lines:
            logger.info("engine returned nothing to say (status=%s)", result.interview_status)
            return
        heard = await say_all(lines)
        timing.mark("turn.spoken", heard=heard)
        if heard:
            mark_pending_spoken()
        else:
            # Cut off. `pending_field_spoken` stays false, so the next thing the
            # patient says goes up unattributed rather than being filed against
            # a question they never heard — the same rule as an utterance that
            # arrives mid-question, for the same reason.
            STATUS.unheard_questions += 1
            logger.warning(
                "the question for %s did not finish playing; the next answer "
                "will not be filed against it",
                pending_field or "-",
            )

    async def publish_error(
        stage: str, *, detail: str, status: int | None, final: bool
    ) -> None:
        """An operational failure, as structure, so the patient is not left guessing.

        Measured before this existed: Nest answered 500 to one turn and the
        patient — who had just said "No." — got nothing. No audio, no text, no
        data message. They waited out a sixty-second timeout in front of a
        screen that still showed the previous question, with no way to tell a
        thinking agent from a dead one.

        Nothing is spoken and no sentence is invented here. `stage` and `final`
        are for the client to branch on and `detail` is whatever the server
        itself said; writing patient prose in this worker is the thing that
        removing MEDIHIVE_GREETING was about, and an error is not an exception
        to it. What the phone renders is the phone's decision.

        `final` separates the two cases that need opposite handling: a 4xx is
        done and the patient should stop waiting, a 5xx or an unreachable
        socket may come back and the next thing they say may well work.
        """
        await publish(
            "error",
            {
                "stage": stage,
                "ok": False,
                "status": status,
                "detail": detail,
                "final": final,
            },
        )

    async def publish_turn(result: TurnResult) -> None:
        """The engine's answer, structurally, for the client to render.

        `choices` in particular: a question whose answer is one of four buttons
        should be four buttons on the screen as well as a sentence in the ear.
        Sent before the audio so the screen is already right when the question
        starts playing.

        On an interruption `nextQuestion` is the question that was already on
        the table, sent again with the same `fieldPath`. That repetition is the
        message: a client that keys the pinned question on `fieldPath` redraws
        the same card and nothing on screen jumps, while `aside` tells it what
        just happened.
        """
        question = result.next_question
        await publish(
            "turn",
            {
                "turnId": result.turn_id,
                "interviewStatus": result.interview_status,
                "patientMessage": result.patient_message,
                "redFlags": result.red_flags,
                "serverTimeMs": result.server_time_ms,
                # Present only when the patient interrupted rather than
                # answered. `intent` is the closed-set name — the app draws its
                # own sentence from it rather than printing `reply`, which is
                # the same rule that keeps every other piece of server text off
                # that screen. `reply` travels anyway because this worker speaks
                # it, and a client that can read both can check they agree.
                "aside": result.aside,
                "nextQuestion": (
                    {
                        "fieldPath": question.field_path,
                        "section": question.section,
                        "label": question.label,
                        "kind": question.kind,
                        "prompt": question.prompt,
                        "choices": question.choices,
                        "remaining": question.remaining,
                    }
                    if question
                    else None
                ),
            },
        )

    def start_turn(text: str, confidence: float) -> None:
        nonlocal current_turn
        if current_turn is not None and not current_turn.done():
            # The patient said something new before the last answer finished
            # being processed. Theirs is the current answer; drop the old turn.
            current_turn.cancel()
        current_turn = asyncio.create_task(run_turn(text, confidence))

    # ── The turn boundary ───────────────────────────────────────────────────
    #
    # Finals are *held*, not posted. See [CaseTakingAgent] for why the turn is
    # started by the library's end-of-turn commit rather than by the transcript
    # that triggers it, and [TurnBuffer] in delivery.py for the holding itself.

    def _commit_lost(text: str) -> None:
        STATUS.uncommitted_turns += 1

    turns = TurnBuffer(
        grace=SETTINGS.turn_commit_grace,
        start=start_turn,
        on_lost=_commit_lost,
    )

    # ── Transcripts ─────────────────────────────────────────────────────────

    @session.on("agent_state_changed")
    def _on_agent_state(event: Any) -> None:
        # Logged because barge-in is invisible otherwise. The library emits no
        # log line when a speech is cut off, so the transition into and out of
        # "speaking" plus the `say()` timing below are the only evidence an
        # operator has that interruption is working at all.
        old = getattr(event, "old_state", "?")
        new = getattr(event, "new_state", "?")
        # The only worker-side evidence of a barge-in that exists: the library
        # logs nothing when it cuts a speech off, so the transition out of
        # "speaking" is where the interruption becomes observable from here.
        timing.mark("agent.state", old=str(old), new=str(new))
        STATUS.agent_state = str(new)
        logger.debug("agent state %s -> %s", old, new)

    @session.on("user_input_transcribed")
    def _on_transcribed(event: Any) -> None:
        text = (getattr(event, "transcript", "") or "").strip()
        is_final = bool(getattr(event, "is_final", False))
        if not text:
            return

        if not is_final:
            # Partials go back to the phone automatically: RoomOutputOptions
            # below has transcription_enabled=True, so livekit-agents forwards
            # every `user_input_transcribed` into the room as it forms. Nothing
            # is posted to the engine from a partial — see the note below.
            STATUS.interims += 1
            timing.mark("transcript.interim", chars=len(text))
            logger.debug("partial: %s", text)
            return

        # Not read off the event: `UserInputTranscribedEvent` carries only the
        # transcript, `is_final`, an item id, a speaker id and a language.
        # Whisper's confidence is dropped between `SpeechData` and this event,
        # so [SidecarSTT] parks it and the handler claims it by text. See the
        # note on `SidecarSTT._confidences`.
        confidence = stt.claim_confidence(text)

        timing.mark("transcript.final", chars=len(text), confidence=round(confidence, 3))
        timing.set_context(text[:60])
        logger.info("final: %s (confidence %.2f)", text, confidence)

        # Deliberately NOT preemptive. The reference implementation starts its
        # LLM on a partial transcript and throws the result away if the patient
        # keeps talking, which is free when the discarded work is a token
        # stream. Here the equivalent would be posting half a sentence to
        # `/turns`, and a turn is a clinical write: it derives presence, may
        # trigger a red flag, and creates a fact with an id. "I don't have chest
        # pain" posted at the word "chest" is a different medical record from
        # the one the patient dictated. Latency is not worth that, especially
        # when the engine answers in fifteen milliseconds anyway.
        #
        # Held rather than posted. A final is the end of one Silero segment, not
        # the end of the patient's turn — a patient who pauses mid-sentence
        # produces two of them — and posting on it is what raced the library
        # into cutting our own question off. `TurnBuffer.commit` is called from
        # [CaseTakingAgent] when the turn actually closes, and the watchdog
        # armed here is what happens if that never comes.
        turns.hold(text, confidence)

    # ── Join ────────────────────────────────────────────────────────────────

    agent = CaseTakingAgent(turns.commit)

    _t_start = timing.mark("join.session_start", room=ctx.room.name)
    await session.start(
        agent=agent,
        room=ctx.room,
        # One RoomOptions, not the RoomInputOptions/RoomOutputOptions pair the
        # reference uses — those are deprecated in 1.8.2 in favour of this.
        room_options=room_io.RoomOptions(
            # The patient's phone may drop off a lift and come back. Closing the
            # session on the first disconnect would end the interview.
            close_on_disconnect=False,
            # Both default to enabled; named anyway because they are load-bearing.
            # `audio_output` publishes the question; `text_output` is what puts
            # interim transcripts on the patient's screen as they form.
            audio_output=True,
            text_output=True,
        ),
    )
    timing.span("join.session_started", _t_start)
    _t_conn = timing.mark("join.connect_start")
    await ctx.connect()
    timing.span("join.connected", _t_conn)

    STATUS.connected = True
    STATUS.extra = lambda: {"sttLastError": stt.last_error, "sttRefusedLanguage": stt.refused_language}
    logger.info("connected to %s as %s", ctx.room.name, ctx.room.local_participant.identity)

    # ── The question on the table ───────────────────────────────────────────
    #
    # Asked by fetching the session rather than by inventing an opener. The
    # engine may be mid-interview: a patient who reconnects should hear the
    # question they were on, not the first one. If the session cannot be read,
    # the agent stays silent and listens — a wrong opening question is worse
    # than none.
    #
    # A function rather than a straight line of `entrypoint`, because it is
    # needed twice: once on joining, and again whenever a patient's phone drops
    # and comes back as a new participant. Both are the same request — "what am
    # I supposed to be asking?" — and both must be answered by the engine.
    async def ask_current_question() -> None:
        nonlocal language
        if not (session_id and engine.has_token):
            return
        try:
            current = await engine.current_question(session_id)
            if current is not None:
                # The session is the authority on its own languages, not an env
                # var and not the dispatch metadata. `describeSession` returns
                # `inputLanguage` (what the patient speaks, for Whisper) and
                # `outputLanguage` (what the questions are written in, for
                # Piper) separately, and they are not always the same. Adopting
                # them here is what stops a Hindi question being read out by the
                # English voice because MEDIHIVE_SESSION_LANGUAGE said `en`.
                if current.input_language and current.input_language != stt.language:
                    logger.info(
                        "session input language is %s (was %s); listening in it",
                        current.input_language,
                        stt.language,
                    )
                    stt.language = current.input_language
                if current.output_language and current.output_language != language:
                    logger.info(
                        "session output language is %s (was %s); speaking in it",
                        current.output_language,
                        language,
                    )
                    language = current.output_language
                    STATUS.language = language

                # Before publishing, so the first thing the patient says is
                # already attributed to the question they are hearing. Without
                # this the opening answer is the one turn in the interview that
                # still goes up as a fieldless narrative.
                remember_pending(current)

                await publish_turn(current)
                lines = utterances(current)
                if lines:
                    if await say_all(lines):
                        mark_pending_spoken()
                    else:
                        STATUS.unheard_questions += 1
                        logger.warning(
                            "the opening question for %s did not finish playing",
                            current.next_question.field_path
                            if current.next_question
                            else "-",
                        )
                else:
                    logger.info("session %s has no pending question", session_id)
        except EngineUnavailable as exc:
            logger.error("could not read the current question: %s", exc)
            STATUS.last_error = str(exc)
            # The worst silence in the system: this one lands before the
            # patient has heard anything at all, so there is not even a stale
            # question on screen to look at. Measured with Nest answering 500
            # to this GET — the patient sat in front of a blank interview for
            # seventy seconds with no question, no audio and no error, and the
            # only sign anything had happened was a line in the worker's log.
            await publish_error("engine", detail=str(exc), status=None, final=False)

    # ── The dropped call ────────────────────────────────────────────────────
    #
    # A phone that loses signal and comes back is a NEW participant with a new
    # identity, and livekit-agents does not follow it.
    #
    # `RoomIO._init_task` (voice/room_io/room_io.py) awaits
    # `_participant_available_fut` exactly once, calls `set_participant()` with
    # whoever arrives first, and then returns. `_on_participant_disconnected`
    # re-arms that future and `_on_participant_connected` sets its result again,
    # but by then nothing is awaiting it — the task that would have called
    # `set_participant` has already finished. The audio input stays bound to the
    # phone that left.
    #
    # Measured: patient A joins, answers one question, drops. Patient B joins
    # the same room six seconds later, subscribes to the agent's track, and
    # speaks twice. The worker posts nothing and says nothing — no VAD events,
    # no transcript, no turn — while `close_on_disconnect=False` keeps the
    # session alive and apparently healthy. From the patient's side the
    # interview is simply over, with no error and no way to restart it.
    #
    # So the worker re-links, which it can do because `AgentSession.room_io` is
    # public and `set_participant()` is its supported entry point.
    #
    # The guard matters as much as the re-link. Re-linking on *every* join would
    # hand the microphone to whoever connected most recently, so a clinician
    # opening the room to observe would silently take the patient's place. The
    # link only moves when the participant it was on has actually gone.
    linked_identity: str | None = None
    if session.room_io is not None:
        linked = session.room_io.linked_participant
        linked_identity = linked.identity if linked is not None else None
    logger.info("audio input linked to %s", linked_identity or "(nobody yet)")

    @ctx.room.on("participant_disconnected")
    def _on_participant_left(participant: Any) -> None:
        nonlocal linked_identity
        identity = getattr(participant, "identity", None)
        if identity and identity == linked_identity:
            logger.warning(
                "the participant we were listening to (%s) left; "
                "waiting for a reconnection", identity
            )
            linked_identity = None

    @ctx.room.on("participant_connected")
    def _on_participant_joined(participant: Any) -> None:
        nonlocal linked_identity
        identity = getattr(participant, "identity", None)
        if not identity:
            return
        if linked_identity is not None:
            logger.info(
                "%s joined while we are still listening to %s; not re-linking",
                identity, linked_identity,
            )
            return
        if session.room_io is None:
            return
        logger.info("re-linking audio input to %s", identity)
        try:
            session.room_io.set_participant(identity)
        except Exception as exc:  # pragma: no cover - diagnostics only
            logger.error("could not re-link to %s: %s", identity, exc)
            return
        linked_identity = identity
        STATUS.relinks += 1

        # They missed whatever was said while they were gone, and the engine is
        # the only thing that knows what that was. Same call as on joining.
        async def _resume() -> None:
            try:
                await ask_current_question()
            except Exception as exc:  # pragma: no cover - diagnostics only
                logger.error("could not resume after re-link: %s", exc)

        asyncio.create_task(_resume())

    if session_id and engine.has_token:
        await ask_current_question()
    else:
        # Silence, deliberately. There used to be a `MEDIHIVE_GREETING` escape
        # hatch here that spoke a fixed string when there was no session or no
        # token, so the audio path could be exercised with no Nest running.
        #
        # It is gone because of what it was: a developer-authored sentence
        # played into a patient's ear, arriving at exactly the moment the
        # worker has established it cannot reach the engine. Everything a
        # patient hears in this system comes from the deterministic engine, and
        # a greeting is not an exception to that — it is the one line the
        # patient is guaranteed to be listening to, and it would be the only
        # line in the interview nobody clinical had written or reviewed. A
        # patient told "Hello, I am your assistant" by a worker that has no
        # session has been told something false.
        #
        # The audio path is exercised by tools/selftest.py and by
        # tools/speak_into_room.py, neither of which needs a patient present.
        logger.warning("no session id or token: listening only, nothing will be posted")

    async def _cleanup() -> None:
        STATUS.connected = False
        turns.cancel()
        if current_turn is not None and not current_turn.done():
            current_turn.cancel()
        await sidecar.aclose()
        await engine.aclose()

    ctx.add_shutdown_callback(_cleanup)


def _configure_logging() -> None:
    logging.basicConfig(
        level=SETTINGS.log_level,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )


def main() -> None:
    _configure_logging()
    logger.info("env file: %s", _ENV_FILE or "(none found; using the shell environment)")
    for name, value in describe(SETTINGS):
        logger.info("  %-28s %s", name, value)

    missing = [
        name
        for name, value in (
            ("LIVEKIT_URL", SETTINGS.livekit_url),
            ("LIVEKIT_API_KEY", SETTINGS.livekit_api_key),
            ("LIVEKIT_API_SECRET", SETTINGS.livekit_api_secret),
        )
        if not value
    ]
    if missing:
        # Fatal, and said plainly. Without these livekit-agents fails deeper in
        # with a connection error that does not name the missing variable.
        raise SystemExit(
            f"missing required environment: {', '.join(missing)}. "
            "They live in hms_v2/.env.local, which is untracked."
        )

    health.serve(STATUS, SETTINGS.health_port)
    cli.run_app(server)


if __name__ == "__main__":
    main()
