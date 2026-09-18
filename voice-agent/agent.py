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
`user_input_transcribed` -> POST -> `session.say(text=..., audio=...)`.

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
import json
import logging
import time
from dataclasses import dataclass, replace
from typing import Any, AsyncIterator

from livekit import rtc
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    cli,
    room_io,
)
from livekit.plugins import silero

import health
import llm
import timing
from audio import PcmFramer, frames_duration, frames_stream, wav_to_frames
from config import Settings, describe, load_env_file
from engine import (
    CaseTakingClient,
    EngineRejected,
    EngineUnavailable,
    NextQuestion,
    TurnResult,
    utterances,
)
from sidecar import SidecarClient, SidecarRefusal, SidecarUnavailable, split_for_speech
from stt_adapter import SidecarSTT

logger = logging.getLogger("medihive.agent")

# Read hms_v2/.env.local at *import* time, before Settings.load() below.
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
AGENT_NAME = "medihive"

# Loading Silero and opening two HTTP clients is not instant, and the default
# 10 s is measured on a box that is not also holding Ollama and Docker.
#
# `agent_name` is NOT set here: on livekit-agents 1.8 it belongs on the
# `@server.rtc_session()` decorator below, not on the constructor, and passing
# it here is a TypeError rather than a no-op. See the note on `entrypoint`.
server = AgentServer(initialize_process_timeout=120.0)


@dataclass
class TurnLatency:
    """One turn's clock, from the patient opening their mouth to hearing audio.

    `timing.py` already records every hop as NDJSON, and that is the file a
    budget is built from. This is the other half of the same job: five numbers
    on one INFO line, in the worker's own log, so an operator watching a live
    call can see *which* hop is slow without joining two processes' timing logs
    together after the fact.

    Two kinds of number, and mixing them up is how a budget stops adding up.
    `sttFirstPartial`, `sttFinal` and `total` are measured from `speech_start` —
    the moment Silero says the patient began speaking, the only anchor the
    patient shares with the system. `engine`, `llmFirstToken` and
    `ttsFirstAudio` are measured from the end of the hop before them, so each is
    the cost of that stage and not of everything preceding it. Reporting a
    per-stage cost from `speech_start` makes a slow recogniser look like a slow
    synthesiser.

    `total` is time-to-first-audio rather than time-to-finish. It is what the
    patient experiences as "the pause", and it is the number every setting in
    config.py is tuned against.

    `None` means "did not happen", and the three ways it can be None are all
    ordinary: no interim (the answer was too short to reach
    `MEDIHIVE_INTERIM_MIN_SPEECH_SEC`), no LLM (phrasing off, or it fell back),
    no audio (TTS refused the language and the question went down as text).

    ## One record per turn, snapshotted, and why that is not over-engineering

    The event handlers write into a *live* record — they are the only things
    that know when the patient started talking — and `run_turn` takes a copy of
    it with [snapshot] before it posts anything. Everything downstream writes
    into the copy.

    Measured, before it did: a barge-in is a new utterance, so it calls [begin],
    which resets the live record. The turn that was being interrupted then
    reported the reset one, and the log line came out as

        latency ros.constitutional.rigors: stt_partial=2094ms stt_final=3297ms
              engine=31ms llm_first_token=- tts_first_audio=- total=-

    on a turn whose audio had demonstrably played — the line above it in the
    same log says `interrupted while saying: Have you had shaking chills…`. And
    a turn cut off before it spoke reported six dashes, which reads as a dead
    pipeline rather than as a patient who changed their mind.

    A copy costs six floats, and the alternative is a budget that is wrong
    exactly when somebody is reading it to find out why a call felt bad.
    """

    speech_start: float | None = None
    stt_first_partial: float | None = None
    stt_final: float | None = None
    turn_posted: float | None = None
    llm_first_token: float | None = None
    tts_first_audio: float | None = None

    def begin(self) -> None:
        """The patient started talking. Everything else is measured from here.

        Resets every stage, because this is a new utterance and the old numbers
        belong to the turn before it. Safe to do only because whatever is still
        reporting that turn is holding a [snapshot] rather than this object.
        """
        self.speech_start = time.monotonic()
        self.stt_first_partial = None
        self.stt_final = None
        self.turn_posted = None
        self.llm_first_token = None
        self.tts_first_audio = None

    def snapshot(self) -> "TurnLatency":
        """A copy this turn owns, immune to the next utterance resetting things."""
        return replace(self)

    def measured(self) -> bool:
        """Whether anything at all happened. False means there is nothing to log.

        A turn superseded before it could be posted — the patient said something
        new while the last answer was still being processed — has a
        `speech_start` and nothing else. Its line would be six dashes, which
        says less than the `stopping the reply` line already above it.
        """
        return self.speech_start is not None and any(
            at is not None
            for at in (
                self.stt_first_partial,
                self.stt_final,
                self.turn_posted,
                self.llm_first_token,
                self.tts_first_audio,
            )
        )

    def _since(self, at: float | None, start: float | None = None) -> float | None:
        origin = self.speech_start if start is None else start
        if at is None or origin is None:
            return None
        return (at - origin) * 1000.0

    def summary(self) -> dict[str, float | None]:
        # The synthesiser starts when the last thing before it finished, which
        # is the LLM's first sentence when phrasing is on and the engine's reply
        # when it is off. Taking `or` of the two rather than branching keeps the
        # number meaning "how long until it made a sound" in both modes.
        synthesis_start = self.llm_first_token or self.turn_posted
        return {
            "sttFirstPartialMs": _round(self._since(self.stt_first_partial)),
            "sttFinalMs": _round(self._since(self.stt_final)),
            "engineMs": _round(self._since(self.turn_posted, self.stt_final)),
            "llmFirstTokenMs": _round(self._since(self.llm_first_token, self.turn_posted)),
            "ttsFirstAudioMs": _round(self._since(self.tts_first_audio, synthesis_start)),
            "totalMs": _round(self._since(self.tts_first_audio)),
        }


def _round(value: float | None) -> float | None:
    return None if value is None else round(value, 1)


def _ms(value: float | None) -> str:
    """A millisecond field for the log line, or a dash when it did not happen."""
    return "-" if value is None else f"{value:.0f}ms"


# `ParticipantKind.PARTICIPANT_KIND_AGENT`, restated as the integer it is.
#
# Read off the protobuf enum rather than imported, for the same reason
# case-taking.service.ts spells it out: `livekit.rtc` re-exports the enum
# wrapper but not the member as an attribute — `rtc.ParticipantKind` has only
# `DESCRIPTOR`, `Name`, `Value`, `items`, `keys`, `values` — so `.AGENT` is a
# lookup, not a constant, and a wire value that cannot change without breaking
# every LiveKit client in existence is safe to name here.
_AGENT_KIND = 4


def _is_agent(participant: Any) -> bool:
    """Whether this participant is another agent rather than a person.

    Defaults to False when `kind` is missing or unreadable: an unknown
    participant is treated as a person, because the cost of getting that wrong
    is a microphone linked to somebody who is not talking, and the cost of the
    opposite is an interview conducted with a robot. See `_on_participant_joined`.
    """
    try:
        return int(getattr(participant, "kind", -1)) == _AGENT_KIND
    except (TypeError, ValueError):
        return False


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
    latency = TurnLatency()

    # The task that is currently synthesising and speaking, or None.
    #
    # Held as a task rather than a flag because the only reliable way to stop a
    # reply that is half-spoken, half-synthesised and half-generated is to
    # cancel the one coroutine that owns all three: cancelling it unwinds the
    # `async with sidecar.speak_stream(...)`, which closes the HTTP stream,
    # which is what stops the sidecar synthesising the *next* sentence. See
    # `stop_speaking` below.
    speaking: asyncio.Task | None = None

    # Gemma, for wording, or None when `MEDIHIVE_LLM_PHRASING` is off — which is
    # the default. Constructed either way is pointless; a None here is what the
    # phrasing call checks, so the off path costs one comparison per question.
    phrasing = (
        llm.OllamaClient(
            SETTINGS.ollama_url,
            SETTINGS.ollama_model,
            timeout=SETTINGS.llm_timeout,
            first_token_timeout=SETTINGS.llm_first_token_timeout,
            max_chars=SETTINGS.llm_max_chars,
        )
        if SETTINGS.llm_phrasing
        else None
    )
    # Resolved once at join. A model that is not there must not cost every
    # question a failed connection before it falls back.
    phrasing_ready = False

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

    # The patient's last finalised words, for the phrasing prompt only.
    #
    # It is what lets a reworded question follow on — "and how long has that
    # been going on?" rather than "how long has the pain been going on?" — and
    # it is never sent to the engine, which has the whole transcript already and
    # does not need this worker's copy of one line of it. Trimmed, because the
    # prompt is a budget and a patient's narrative can be a paragraph.
    last_utterance: str | None = None

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

    async def say(text: str, record: TurnLatency) -> bool:
        """Synthesise one piece and push it into the room. True if it was heard.

        Streams by default — `/tts/stream`, PCM, first audio out while the rest
        of the sentence is still being made — and falls back to the whole-WAV
        `/tts` when `MEDIHIVE_TTS_STREAMING=0` or when the stream cannot be
        opened. Both paths refuse identically.

        On a TTS refusal this returns False without speaking anything. It does
        not fall back to another language's voice: IndicF5 serves the eleven
        Indian languages and Piper serves `en` and `hi`; anything nobody serves
        503s, and answering a Tamil session in English would be a clinical
        record of a question the patient never understood. The text still
        reaches the phone as a data message, so the question is there to be read.
        """
        text = text.strip()
        if not text:
            return False
        timing.mark("say.begin", chars=len(text), streaming=SETTINGS.tts_streaming)
        if SETTINGS.tts_streaming:
            return await say_streaming(text, record)
        return await say_whole(text, record)

    async def say_streaming(text: str, record: TurnLatency) -> bool:
        """`/tts/stream` straight into the room, frame by frame as it arrives.

        ## Why the frames are generated inside the response context

        Because leaving it is what cancels the synthesiser. The async generator
        below is consumed by livekit-agents' own forwarding task, but the
        `async with` that owns the socket lives on *this* coroutine — so when
        `stop_speaking` cancels this task, the context exits, `httpx` closes the
        connection, and the sidecar's `StreamingResponse` stops being iterated
        before it generates the next sentence.

        The whole-WAV path cannot do that. There, a barge-in cut the playback
        and the synthesis carried on to completion on the same CPU the next
        transcription needed, so interrupting the agent made the box slower.

        ## Why the handle is interrupted on the way out

        `session.say` hands the generator to a task this one does not own. If
        this coroutine is cancelled and the context closes underneath that task,
        it is left iterating a dead socket. `handle.interrupt()` in the `finally`
        tells it to stop first, in the one order that has no window in it.
        """
        try:
            async with sidecar.speak_stream(text, language) as stream:
                STATUS.spoken_via = stream.provider
                STATUS.tts_refused = None
                await publish(
                    "speak",
                    {
                        "text": text,
                        "spoken": True,
                        "provider": stream.provider,
                        "sampleRate": stream.sample_rate,
                        "streaming": True,
                    },
                )

                framer = PcmFramer(stream.sample_rate, frame_ms=SETTINGS.frame_ms)
                spoke_any = False

                async def frames() -> AsyncIterator[rtc.AudioFrame]:
                    nonlocal spoke_any
                    opened = timing.mark("say.stream_frames_begin")
                    count = 0
                    async for chunk in stream.chunks:
                        for frame in framer.push(chunk):
                            if not spoke_any:
                                spoke_any = True
                                record.tts_first_audio = (
                                    record.tts_first_audio or time.monotonic()
                                )
                                timing.span(
                                    "say.first_frame_out",
                                    opened,
                                    provider=stream.provider,
                                    rate=stream.sample_rate,
                                )
                            count += 1
                            yield frame
                            # Yields to the event loop between frames so a
                            # cancellation lands here rather than after the
                            # whole chunk. See `frames_stream` in audio.py.
                            await asyncio.sleep(0)
                    for frame in framer.flush():
                        count += 1
                        yield frame
                    timing.span("say.stream_frames_end", opened, frames=count)

                handle = session.say(
                    text=text,
                    audio=frames(),
                    allow_interruptions=SETTINGS.allow_interruptions,
                    add_to_chat_ctx=True,
                )
                try:
                    await handle
                finally:
                    # Both on the ordinary path (a no-op once it is done) and on
                    # cancellation, where it is the thing that stops the
                    # forwarding task before the socket goes away under it.
                    if not handle.done():
                        handle.interrupt()

                timing.mark(
                    "say.handle_done",
                    interrupted=bool(handle.interrupted),
                    provider=stream.provider,
                )
                if handle.interrupted:
                    STATUS.interruptions += 1
                    logger.info("interrupted while saying: %s", text[:60])
                return spoke_any
        except SidecarRefusal as refusal:
            STATUS.tts_refused = language
            STATUS.last_error = refusal.patient_message
            logger.warning("no voice for %s; sending text only: %s", language, text)
            await publish(
                "speak",
                {"text": text, "spoken": False, "reason": refusal.patient_message},
            )
            return False
        except SidecarUnavailable as exc:
            # One retry, on the other transport. A streaming body has more ways
            # to fail than a file does — a proxy that buffers, a header that did
            # not arrive — and `/tts` is the path that has been serving a real
            # phone for months. Falling back to it costs the patient the
            # streaming latency and keeps them a question.
            STATUS.last_error = str(exc)
            logger.warning("tts stream failed (%s); falling back to whole-WAV", exc)
            timing.mark("say.stream_fallback", error=str(exc)[:120])
            return await say_whole(text, record)

    async def say_whole(text: str, record: TurnLatency) -> bool:
        """The original path: one `/tts` call, one WAV, then frames.

        Kept because it is the transport the Flutter client uses and the one
        every measurement in MULTILINGUAL.md was taken against, so it is what a
        streaming regression is compared to. It cannot cancel a synthesis in
        flight; a barge-in stops the playback and the sidecar finishes making
        audio nobody hears.
        """
        try:
            wav, provider = await sidecar.speak(text, language)
        except SidecarRefusal as refusal:
            STATUS.tts_refused = language
            STATUS.last_error = refusal.patient_message
            logger.warning("no voice for %s; sending text only: %s", language, text)
            await publish("speak", {"text": text, "spoken": False, "reason": refusal.patient_message})
            return False
        except SidecarUnavailable as exc:
            STATUS.last_error = str(exc)
            logger.error("tts unavailable: %s", exc)
            await publish("speak", {"text": text, "spoken": False, "reason": "tts unavailable"})
            return False

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
            return False

        await publish(
            "speak",
            {
                "text": text,
                "spoken": True,
                "provider": provider,
                "sampleRate": frames[0].sample_rate,
            },
        )
        timing.mark("say.handle_create", chars=len(text))
        record.tts_first_audio = record.tts_first_audio or time.monotonic()
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
        await handle
        spoke = time.monotonic() - started

        # A 25% margin: playout starts slightly before the first frame lands and
        # the last frame drains after the handle resolves, so an uninterrupted
        # utterance does not finish at exactly `expected`.
        timing.mark(
            "say.handle_done",
            spoke_ms=round(spoke * 1000.0, 1),
            expected_ms=round(expected * 1000.0, 1),
            interrupted=bool(SETTINGS.allow_interruptions and spoke < expected * 0.75),
        )
        if SETTINGS.allow_interruptions and spoke < expected * 0.75:
            STATUS.interruptions += 1
            logger.info(
                "interrupted after %.2fs of %.2fs: %s", spoke, expected, text[:60]
            )
        else:
            logger.debug("spoke %.2fs of %.2fs", spoke, expected)
        return True

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

    async def say_all(lines: list[str], record: TurnLatency) -> None:
        """Speak the engine's lines, in the engine's order, one at a time.

        Serialised behind a lock: two overlapping `say` calls put two voices in
        the room at once. The lock is also what makes a cancelled turn stop
        cleanly — the cancellation lands while waiting for it.

        ## The loop stops on an interruption, and it did not used to

        A red-flag turn is two lines: the routing instruction and the next
        question. A patient who talks over the first one used to get the second
        one anyway — `say` returned, the loop went round, and the agent started
        a new utterance into a room where the patient was mid-sentence. From the
        patient's side the agent ignored them and carried on, which is the exact
        behaviour barge-in exists to prevent.

        `handle.interrupted` is not checked here because `stop_speaking` is
        cancelling this whole coroutine; the `CancelledError` unwinds the loop
        and nothing after it runs. The remaining lines are dropped rather than
        queued: the engine will re-send whatever is still outstanding on the
        next turn, and a question the patient has already answered over is not
        worth asking late.
        """
        async with speaking_lock:
            for line in lines:
                for piece in split_for_speech(line):
                    await say(piece, record)

    async def speak_turn(
        question: NextQuestion | None, lines: list[str], record: TurnLatency
    ) -> None:
        """Everything the engine wants said, with the LLM in front of the question.

        The split is the clinical boundary and it is the reason this is not just
        `say_all`:

        * `patientMessage` — the routing instruction from the most severe
          triggered red-flag rule, e.g. "stop and go to the front desk now" — is
          checked-in, reviewed text and is spoken **verbatim**. It never goes
          near the model.
        * The next question is phrased by gemma3:4b when
          `MEDIHIVE_LLM_PHRASING` is on, and by the phrasebook when it is not.
          Either way it is the same clinical question about the same field; see
          llm.py for what the model is and is not allowed to change.

        `lines` still carries both, in the engine's severity order, so the
        fallback path is `say_all(lines)` unchanged.
        """
        if not lines:
            return
        if not (phrasing and phrasing_ready and question and question.spoken_text):
            await say_all(lines, record)
            return

        # Everything except the question — in practice the red-flag message —
        # spoken first and verbatim, exactly as `utterances()` ordered it.
        preamble = [line for line in lines if line != question.spoken_text]
        async with speaking_lock:
            for line in preamble:
                for piece in split_for_speech(line):
                    await say(piece, record)

            spoke_phrased = False
            request = llm.PhrasingRequest(
                text=question.spoken_text,
                language=language,
                field_path=question.field_path,
                choices=tuple(question.choices or ()),
                last_patient_utterance=last_utterance,
            )
            try:
                async for sentence in phrasing.phrase(request):
                    if record.llm_first_token is None:
                        record.llm_first_token = time.monotonic()
                    # Straight to the synthesiser, one sentence at a time. This
                    # is the whole point of streaming the model: the second
                    # sentence is still being generated while the first is being
                    # spoken, so the patient waits for a sentence rather than
                    # for a reply.
                    if await say(sentence, record):
                        spoke_phrased = True
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # pragma: no cover - the fallback is the point
                logger.warning("phrasing failed mid-question (%s)", exc)

            if not spoke_phrased:
                # Nothing usable came back, or the model is down, or TTS refused
                # every sentence it did produce. The engine's own wording is a
                # complete, reviewed question and is what the patient gets.
                timing.mark("llm.fallback", field=question.field_path or "")
                logger.info(
                    "phrasing produced nothing for %s; speaking the engine's wording",
                    question.field_path or "?",
                )
                for piece in split_for_speech(question.spoken_text):
                    await say(piece, record)

    def report_latency(record: TurnLatency, field_path: str | None) -> None:
        """One line per turn, with every stage of the budget on it.

        The NDJSON in `timing.py` is the authority and the thing
        `tools/report_budget.py` reads; this is the same measurement in the
        place an operator is already looking. It costs one log line per turn and
        it is the difference between "the agent feels slow" and "the engine
        answers in 18 ms and Whisper is taking four seconds".

        `-` rather than `0` for a stage that did not happen, because a zero here
        would read as "instant" and mean "absent".
        """
        if not record.measured():
            return
        summary = record.summary()
        timing.mark("turn.latency", field=field_path or "", **summary)
        logger.info(
            "latency %s: stt_partial=%s stt_final=%s engine=%s llm_first_token=%s "
            "tts_first_audio=%s total=%s",
            field_path or "-",
            _ms(summary["sttFirstPartialMs"]),
            _ms(summary["sttFinalMs"]),
            _ms(summary["engineMs"]),
            _ms(summary["llmFirstTokenMs"]),
            _ms(summary["ttsFirstAudioMs"]),
            _ms(summary["totalMs"]),
        )
        STATUS.last_latency = summary

    def stop_speaking(reason: str) -> None:
        """Cut the reply off now: playback, synthesis and generation together.

        Called from the barge-in handler. Cancelling the task is what reaches
        all three — `say_streaming` interrupts the `SpeechHandle` and closes the
        `/tts/stream` socket on its way out, and `llm.phrase` propagates the
        cancellation so Ollama stops generating for a patient who is already
        talking over the answer.

        Idempotent and cheap. `user_state_changed` fires on every transition
        into speaking, including the ones where the agent is not saying
        anything, and the ordinary case is that there is nothing to cancel.
        """
        nonlocal speaking
        if speaking is None or speaking.done():
            return
        timing.mark("barge.cancel", reason=reason)
        logger.info("patient started speaking; stopping the reply (%s)", reason)
        speaking.cancel()

    async def start_speaking(
        question: NextQuestion | None, lines: list[str], record: TurnLatency
    ) -> None:
        """Run `speak_turn` as a cancellable task and wait for it.

        The task handle is what `stop_speaking` needs. Awaiting it here keeps
        `run_turn` reading top to bottom, and swallows the `CancelledError` that
        a barge-in produces: an interruption is the system working, not a turn
        that failed, and it must not take `run_turn`'s own cancellation
        semantics with it.
        """
        nonlocal speaking
        speaking = asyncio.create_task(speak_turn(question, lines, record))
        try:
            await speaking
        except asyncio.CancelledError:
            if speaking.cancelled():
                # Ours: the patient interrupted. Swallowed.
                timing.mark("barge.stopped")
                return
            # Somebody cancelled `run_turn` itself — a newer utterance arrived
            # before this one finished being answered. The speaking task is not
            # cancelled by that on its own; awaiting a task and being cancelled
            # while awaiting leaves the task running. Orphaning it here would
            # leave a voice in the room belonging to a turn that has been
            # abandoned, so it is cancelled explicitly before the error goes up.
            speaking.cancel()
            raise
        finally:
            speaking = None

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
        # The turn's own copy of the budget. Taken here, before anything can
        # await: from this line on, a barge-in resetting the live record cannot
        # reach these numbers. See `TurnLatency`.
        record = latency.snapshot()
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

        record.turn_posted = time.monotonic()
        remember_pending(result)
        await publish_turn(result)

        lines = utterances(result)
        timing.mark("turn.lines", lines=len(lines), chars=sum(len(l) for l in lines))
        if not lines:
            logger.info("engine returned nothing to say (status=%s)", result.interview_status)
            return
        await start_speaking(result.next_question, lines, record)
        mark_pending_spoken()
        timing.mark("turn.spoken")
        report_latency(
            record, result.next_question.field_path if result.next_question else None
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

    @session.on("user_state_changed")
    def _on_user_state(event: Any) -> None:
        """The patient started or stopped talking. Both edges do a job.

        **Started** is the barge-in. `turn_handling.interruption` already stops
        the *playback* — that is livekit-agents' own job and it does it after
        `BARGE_MIN_SEC` of speech — but it knows nothing about the synthesiser
        still generating the rest of the sentence or the model still generating
        the rest of the question. `stop_speaking` cancels all three, and it is
        wired to the same signal so it cannot lag the playback cut.

        Doing it here rather than on `agent_false_interruption` or on the final
        transcript is the point: by the time a transcript exists the patient has
        finished a sentence, and an agent that keeps talking until then is an
        agent that talks over them.

        **Stopped** is not used to resume anything. A cut-off question is
        re-asked by the engine on the next turn if it is still outstanding, and
        re-playing audio the patient interrupted is what
        `resume_false_interruption: False` above exists to prevent.
        """
        new = str(getattr(event, "new_state", "") or "")
        timing.mark("user.state", old=str(getattr(event, "old_state", "?")), new=new)
        if new != "speaking":
            return
        # The anchor for every number in `TurnLatency`. Set on the edge into
        # speaking rather than on the first transcript, because the patient's
        # clock starts when they open their mouth and Whisper's starts later.
        latency.begin()
        stop_speaking("user started speaking")

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
            if latency.stt_first_partial is None:
                latency.stt_first_partial = time.monotonic()
            timing.mark("transcript.interim", chars=len(text))
            logger.debug("partial: %s", text)
            return

        # Not read off the event: `UserInputTranscribedEvent` carries only the
        # transcript, `is_final`, an item id, a speaker id and a language.
        # Whisper's confidence is dropped between `SpeechData` and this event,
        # so [SidecarSTT] parks it and the handler claims it by text. See the
        # note on `SidecarSTT._confidences`.
        confidence = stt.claim_confidence(text)

        nonlocal last_utterance
        latency.stt_final = time.monotonic()
        # Capped, not stored whole: this exists only to give the phrasing prompt
        # something to follow on from, and a patient's narrative can be long
        # enough to crowd the actual question out of a 4B model's attention.
        last_utterance = text[:200]

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
        start_turn(text, confidence)

    # ── Join ────────────────────────────────────────────────────────────────

    agent = Agent(
        # Inert. There is no LLM in this session, so nothing ever reads these.
        # `Agent` is required by `session.start`, and the string is here to tell
        # the next reader that its absence is not an oversight.
        instructions=(
            "Transport only. Question selection, validation, red flags and "
            "escalation belong to the deterministic case-taking engine."
        )
    )

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

    # Probed once, here, rather than per question. A model that is not loaded
    # costs ~31 s on this box and the probe itself is a 3 s timeout; paying
    # either on the first question of an interview is the worst place in the
    # session to spend it. A `False` turns phrasing off for the whole call and
    # every question comes out in the engine's reviewed wording — which is the
    # shipped behaviour anyway, since `MEDIHIVE_LLM_PHRASING` defaults to off.
    if phrasing is not None:
        phrasing_ready = await phrasing.available()
        STATUS.llm = (
            f"{SETTINGS.ollama_model} at {SETTINGS.ollama_url}"
            if phrasing_ready
            else "unavailable; questions come out in the engine's wording"
        )
        logger.info(
            "llm phrasing %s (%s)",
            "on" if phrasing_ready else "off",
            STATUS.llm,
        )
    else:
        STATUS.llm = "off (MEDIHIVE_LLM_PHRASING=0)"

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
                    # A fresh record with no `speech_start`: the opening
                    # question answers nobody, so there is no patient clock to
                    # measure it against and `report_latency` is not called.
                    await start_speaking(
                        current.next_question, lines, TurnLatency()
                    )
                    mark_pending_spoken()
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
        if _is_agent(participant):
            # Never take audio from another agent, whatever else is true.
            #
            # Measured in a live room: a second `medihive` worker was dispatched
            # to the same session — two `POST /voice/token` calls create two
            # dispatches — and this handler, seeing the patient slot empty,
            # handed it the microphone. The worker then transcribed the *other
            # agent's questions* and posted them to `/turns` as the patient's
            # answers:
            #
            #     final: On a scale of nothing at all to the worst you can
            #            imagine, where would you put it right now? 0 to 10.
            #            (confidence 0.82)
            #
            # Six turns were written into a clinical record with no patient in
            # the room. Whatever else is wrong when two agents meet, an agent
            # is never the thing being interviewed, so the microphone must not
            # follow one — and that is knowable here, from `kind`, rather than
            # guessable from an identity prefix a deployment could change.
            logger.warning(
                "%s is an agent, not a patient; not linking audio to it", identity
            )
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
        if current_turn is not None and not current_turn.done():
            current_turn.cancel()
        # Before the clients close, not after: a speaking task still inside
        # `async with sidecar.speak_stream(...)` when the client shuts down
        # raises on a closed transport instead of unwinding cleanly.
        stop_speaking("room closed")
        await sidecar.aclose()
        await engine.aclose()
        if phrasing is not None:
            await phrasing.aclose()

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
