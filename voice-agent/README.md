# MediHive voice agent

The participant that joins the patient's LiveKit room, listens, transcribes,
asks the deterministic engine for the next question, and speaks it back.

```
  Phone (Flutter)
        │  WebRTC (Opus, 48 kHz)
        ▼
  LiveKit Cloud  wss://<project>.livekit.cloud   (LIVEKIT_URL, see .env.local)
        ▲
        │  joins the same room as a participant
        │
  ┌─────┴──────────────────────────────────────────────────────────┐
  │  voice-agent  (this directory)                                  │
  │                                                                 │
  │   Silero VAD ──► POST /stt ──► POST /turns ──► POST /tts ──► audio
  │   (in process)   ai-sidecar    Nest engine     ai-sidecar    back
  │                  :8801         :3000           :8801             │
  └─────────────────────────────────────────────────────────────────┘
```

Two other processes must be running. **Neither is optional**, and this one runs
no model of its own except a 1.8 MB VAD:

| Service         | Port | Holds                                                            |
| --------------- | ---- | ---------------------------------------------------------------- |
| `../ai-sidecar` | 8801 | faster-whisper (`/stt`), Piper + IndicF5 (`/tts`, `/tts/stream`) |
| Ollama          | 8080 | `gemma3:4b`, for question wording only, off by default           |
| Nest API        | 3000 | the deterministic case-taking engine (`/turns`)                  |

## What streams

**Audio up, partial transcripts back, audio down.** The patient's microphone
streams continuously with VAD endpointing, interim transcripts go back as they
form, and the question's audio starts playing as the synthesiser produces it —
`/tts/stream` is raw PCM, chunked, and the first chunk goes into the room rather
than being collected into a file first.

**LLM tokens stream only when there are any.** The next question is a
deterministic string the engine returns in about fifteen milliseconds — question
selection, presence derivation and the red-flag rules are all pure and
synchronous — so with `MEDIHIVE_LLM_PHRASING` off, which is the default, there
is nothing to stream for a string already in hand. With it on, `gemma3:4b`
rewords that string and each completed _sentence_ goes straight to the
synthesiser rather than waiting for the reply to finish. The unit is a sentence
because the synthesiser's unit is a sentence.

## The agent never makes a clinical decision

It transcribes, posts, and speaks what comes back. Question flow, validation,
red flags and escalation are the engine's, and the code is arranged so that
staying out of it is the easy path:

- `engine.utterances()` returns the sentences to speak in the engine's order —
  `patientMessage` (the most severe triggered rule, a routing instruction) before
  `nextQuestion.prompt`.
- There is no "that transcript looks empty, ask again" path. A poor transcript is
  posted with its real confidence and the engine decides.
- A 4xx from `/turns` is final. It is never retried — that would write the same
  fact twice — and never reinterpreted.
- An interim transcript is never posted. See _Why not preemptive_ below.

## Files

| File                       | What it is                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `agent.py`                 | The worker: entrypoint, `AgentSession`, the turn loop                                  |
| `stt_adapter.py`           | faster-whisper over HTTP, presented to LiveKit as a streaming STT with interim results |
| `sidecar.py`               | `/stt`, `/tts` and `/tts/stream` client; passes the language refusals through          |
| `llm.py`                   | Streaming `gemma3:4b` phrasing, off by default. Wording only, never clinical state     |
| `engine.py`                | `/turns` client; the clinical boundary                                                 |
| `audio.py`                 | WAV ↔ `rtc.AudioFrame`, and the sample rates at each hop                               |
| `config.py`                | Every environment variable, with redaction for secrets                                 |
| `health.py`                | `GET /healthz` — connected, models, RSS                                                |
| `httpclient.py`            | One shared SSL context, built off the event loop                                       |
| `run.ps1`                  | Launcher, mirroring `ai-sidecar/run.ps1`                                               |
| `tools/selftest.py`        | Everything except LiveKit, in one pass                                                 |
| `tools/speak_into_room.py` | A fake patient that speaks into a real room                                            |
| `tools/mint_token.py`      | A development LiveKit token                                                            |
| `tools/fake_engine.py`     | A contract-shaped stand-in for Nest                                                    |
| `tools/verify_imports.py`  | Post-install check across **both** venvs                                               |

## Running it

```powershell
# 1. the sidecar (separate terminal) — this is where Whisper and Piper live
cd ..\ai-sidecar; .\run.ps1

# 2. the worker
cd ..\voice-agent; .\run.ps1
```

`run.ps1` passes its arguments through to the LiveKit CLI:

| Command                                | What it does                                            |
| -------------------------------------- | ------------------------------------------------------- |
| `.\run.ps1`                            | `dev` — take whatever room is dispatched to this worker |
| `.\run.ps1 start`                      | Production worker registration                          |
| `.\run.ps1 connect --room case-abc123` | Join one named room now                                 |
| `.\run.ps1 console`                    | Local microphone and speaker, no LiveKit room           |

### First-time setup

```powershell
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe tools\verify_imports.py
```

**Do not install these into `..\ai-sidecar\.venv`.** `requirements.txt` explains
why at length; the short version is that this worker runs no model, so sharing
the venv would share disk but not memory, while risking the sidecar's Smart App
Control pins on a resolver run.

### How a session is addressed

The worker needs a **case-taking session id** and a **bearer token**. Three
sources, most specific first:

1. **Job dispatch metadata** — JSON on the LiveKit dispatch, which is how
   production should do it. Nest knows who the patient is and mints a scoped
   token; the worker never holds a long-lived credential:
   ```json
   { "sessionId": "abc123", "token": "eyJ…", "language": "en" }
   ```
2. **The room name**, when it is `case-<sessionId>` (`MEDIHIVE_ROOM_PREFIX`).
3. **`MEDIHIVE_SESSION_ID` / `MEDIHIVE_API_TOKEN`** in the environment, for
   development.

With no session id or token the worker still joins and listens, logs a warning,
and posts nothing.

## Environment variables

Credentials live in `hms_v2/.env.local` (untracked), which `agent.py` loads at
import. Anything already set in the shell wins, so a single run can be tuned
with `$env:SILERO_MIN_SILENCE_MS=900; .\run.ps1`.

### Required

| Variable             | Default | Meaning                                |
| -------------------- | ------- | -------------------------------------- |
| `LIVEKIT_URL`        | —       | `wss://…livekit.cloud`. Fatal if unset |
| `LIVEKIT_API_KEY`    | —       | Fatal if unset                         |
| `LIVEKIT_API_SECRET` | —       | Fatal if unset. Never logged           |

### Services

| Variable               | Default                     | Meaning                                             |
| ---------------------- | --------------------------- | --------------------------------------------------- |
| `AI_SIDECAR_URL`       | `http://127.0.0.1:8801`     | Whisper and Piper. Same name Nest uses              |
| `MEDIHIVE_API_URL`     | `http://127.0.0.1:3000/api` | Nest, including the global prefix                   |
| `MEDIHIVE_API_TOKEN`   | _(empty)_                   | Bearer token. Prefer dispatch metadata              |
| `MEDIHIVE_API_TIMEOUT` | `15.0`                      | Seconds. The engine answers in ~0.015 s             |
| `MEDIHIVE_STT_TIMEOUT` | `60.0`                      | Seconds. Not a budget — a "something is wrong" line |
| `MEDIHIVE_TTS_TIMEOUT` | `60.0`                      | Seconds                                             |

### Session

| Variable                    | Default   | Meaning                                                 |
| --------------------------- | --------- | ------------------------------------------------------- |
| `MEDIHIVE_SESSION_LANGUAGE` | `en`      | Whisper hears 11 of 12; Piper speaks `en` and `hi` only |
| `MEDIHIVE_SESSION_ID`       | _(empty)_ | Development fallback                                    |
| `MEDIHIVE_ROOM_PREFIX`      | `case-`   | Strip this from the room name to get a session id       |

### Silero VAD — STT segmentation

The reference implementation's tuned values, not the library's defaults. They
are chosen for a patient who pauses mid-symptom: Silero's own defaults (550 ms
silence, 0.5 activation) cut a hesitant speaker off.

| Variable                     | Default | Meaning                                                         |
| ---------------------------- | ------- | --------------------------------------------------------------- |
| `SILERO_MIN_SILENCE_MS`      | `650`   | Silence before the turn ends. Raise to hold the mic open longer |
| `SILERO_ACTIVATION`          | `0.26`  | Start threshold; lower catches short words                      |
| `SILERO_DEACTIVATION`        | `0.16`  | Stop threshold; lower listens through small breaths             |
| `SILERO_PREFIX_PAD_MS`       | `900`   | Pre-roll kept so consonant onsets are not clipped               |
| `SILERO_MIN_SPEECH_MS`       | `50`    | Allows a single-letter answer                                   |
| `SILERO_MAX_BUFFERED_SPEECH` | `60.0`  | Seconds. Also near the sidecar's 10 MB upload ceiling           |
| `SILERO_FORCE_CPU`           | `1`     | The GPU is holding Ollama; Silero is faster on CPU anyway       |

### Silero VAD — barge-in (a second instance)

| Variable                       | Default | Meaning                                               |
| ------------------------------ | ------- | ----------------------------------------------------- |
| `BARGE_MIN_SEC`                | `0.2`   | Speech needed to cut off the question. About one word |
| `BARGE_MIN_SILENCE_MS`         | `250`   | This instance only has to notice speech starting      |
| `MEDIHIVE_ALLOW_INTERRUPTIONS` | `1`     | Whether the patient can talk over the question        |

### Interim transcripts

| Variable                          | Default | Meaning                                                       |
| --------------------------------- | ------- | ------------------------------------------------------------- |
| `MEDIHIVE_INTERIM_TRANSCRIPTS`    | `1`     | Off costs nothing at all — the accumulator is not even filled |
| `MEDIHIVE_INTERIM_EVERY_SEC`      | `1.4`   | A floor, not a cadence. See below                             |
| `MEDIHIVE_INTERIM_MIN_SPEECH_SEC` | `3.0`   | Do not start an interim before this much speech               |

### Streaming synthesis

| Variable                 | Default | Meaning                                                                   |
| ------------------------ | ------- | ------------------------------------------------------------------------- |
| `MEDIHIVE_TTS_STREAMING` | `1`     | `/tts/stream` (PCM, chunked) rather than `/tts` (one WAV). See note below |

On, the question starts playing while the rest of it is still being synthesised,
and a barge-in cancels the synthesiser as well as the speaker — cancelling the
worker's task closes the HTTP stream, so the sidecar stops generating audio
nobody will hear. Measured on this box, Piper English, two sentences:

| Path          | First audio | Whole utterance | Audio produced |
| ------------- | ----------- | --------------- | -------------- |
| `/tts/stream` | **657 ms**  | 1 391 ms        | 2 920 ms       |
| `/tts`        | 1 391 ms    | 1 391 ms        | 2 920 ms       |

Set it to `0` to fall back to whole-WAV synthesis — worth doing exactly once, to
find out whether a stutter is the stream or the box.

### Gemma, for wording only

**Off by default, and that is a clinical decision rather than a performance
one.** With it on, `gemma3:4b` rewords each question before it is spoken; the
engine still chooses the field, the phrasebook still supplies the meaning, red
flags still fire on the engine's own text, and any model failure falls back to
the reviewed wording. What no guard in `llm.py` can catch is a _fluent_
rewording that asks something subtly different, and nobody has reviewed it. The
red-flag `patientMessage` is never sent to the model.

| Variable                       | Default                 | Meaning                                                       |
| ------------------------------ | ----------------------- | ------------------------------------------------------------- |
| `MEDIHIVE_LLM_PHRASING`        | `0`                     | Master switch. Off means every question is the phrasebook's   |
| `OLLAMA_URL`                   | `http://127.0.0.1:8080` | **8080 on this deployment**, not Ollama's stock 11434         |
| `MEDIHIVE_LLM_MODEL`           | `gemma3:4b`             | Matched against `/api/tags` by prefix at join                 |
| `MEDIHIVE_LLM_TIMEOUT`         | `20.0`                  | The whole generation. Not what the patient waits on           |
| `MEDIHIVE_LLM_FIRST_TOKEN_SEC` | `2.5`                   | What the patient waits on. Past it, the engine's wording wins |
| `MEDIHIVE_LLM_MAX_CHARS`       | `320`                   | About two spoken sentences. Nothing past it is spoken         |

Measured warm, first sentence out of `/api/chat`: **~800 ms** in English, Hindi
and Tamil, each in its own script. Cold — `OLLAMA_KEEP_ALIVE` is 5 min — the
first call is ~17 s, which is what the 2.5 s first-token deadline exists to give
up on rather than sit through.

### Operations

| Variable             | Default | Meaning                                                      |
| -------------------- | ------- | ------------------------------------------------------------ |
| `AGENT_HEALTH_PORT`  | `9090`  | `GET /healthz` on 127.0.0.1. Never fatal if the port is busy |
| `MEDIHIVE_LOG_LEVEL` | `INFO`  |                                                              |
| `MEDIHIVE_FRAME_MS`  | `20`    | Frame duration for published audio, at any sample rate       |

## Audio formats, hop by hop

| Hop                       | Rate                                  | Who converts                                                                                                                               |
| ------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Phone → LiveKit room      | 48 kHz Opus                           | WebRTC                                                                                                                                     |
| Room → `AgentSession`     | 24 kHz PCM                            | `RoomInputOptions` default                                                                                                                 |
| → Silero VAD and Whisper  | **16 kHz mono int16**                 | `RecognizeStream(sample_rate=16000)`; livekit-agents resamples before our code sees a frame                                                |
| VAD buffer → `/stt`       | 16 kHz mono WAV                       | `audio.frames_to_wav`, rate read from the frames                                                                                           |
| `/tts` → `rtc.AudioFrame` | **22 050 Hz** (Piper's English voice) | `audio.wav_to_frames`, **no resampling**                                                                                                   |
| Frames → room             | 24 kHz                                | livekit-agents builds an `AudioResampler` when `frame.sample_rate` differs from the output — `voice/generation.py::_audio_forwarding_task` |

Piper's native rate is passed straight through on purpose, as the reference
implementation does. Resampling 22 050 → 48 000 in numpy first would be a
non-integer ratio done worse than the native SDK does it, plus one extra copy of
every utterance on a box that has run with a gigabyte free.

One caveat in that path: livekit-agents decides the resampler from the **first**
frame of a `say()` call. Every frame in one call comes from one WAV, so this is
safe — but do not concatenate frames from two different voices into a single
`say()`.

## Language refusals, which are passed through and never papered over

- **Odia (`or`) has no Whisper model.** `/stt` answers `400` with _"We cannot
  listen in Odia yet. Please type your answer."_ The worker surfaces it and posts
  nothing. It must never be retried, and the language hint must never be dropped
  to let Whisper auto-detect — that returns fluent Hindi labelled Odia at `200`.
- **Piper speaks `en` and `hi` only.** Every other language 503s. The worker does
  **not** substitute another voice; it publishes the question as text on the
  `medihive.case-taking` data topic so it can be read. `X-TTS-Provider` on the
  response is checked, not trusted.

## Data messages to the client

Audio alone loses the structure of a question — `fieldPath`, `kind`, and the
`choices` a patient taps rather than speaks. Every turn is also published on the
LiveKit data topic `medihive.case-taking`:

```jsonc
{"type": "turn",  "turnId": "…", "interviewStatus": "in_progress",
 "patientMessage": null, "redFlags": [], "serverTimeMs": 16.0,
 "nextQuestion": {"fieldPath": "hpi.duration", "kind": "text",
                  "prompt": "How long have you had this for?",
                  "choices": [], "remaining": 2}}

{"type": "speak", "text": "How long have you had this for?",
 "spoken": true, "provider": "piper", "sampleRate": 22050}
```

`spoken: false` means TTS refused the language and the text must be displayed.

## Design notes

### Why not LiveKit's built-in pipeline

`AgentSession` is built with `stt=` and `vad=` and **no `llm=` and no `tts=`**.
With those set, livekit-agents owns the turn: it calls an LLM with a chat
context and speaks the reply. That is the wrong shape for a clinical interview.
The loop is hand-rolled instead: `user_input_transcribed` → `POST /turns` →
`session.say(text=…, audio=…)`.

### Why not preemptive

The reference implementation starts its LLM on a _partial_ transcript and throws
the result away if the patient keeps talking. That is free when the discarded
work is a token stream. Here the equivalent is posting half a sentence to
`/turns`, and a turn is a clinical write: it derives presence, may trigger a red
flag, and creates a fact with an id. _"I don't have chest pain"_ posted at the
word _"chest"_ is a different medical record from the one the patient dictated.

### Two VAD instances

They want opposite tunings. The endpointer waits 650 ms so a patient who pauses
is not cut off; the interrupter must react in about one word. Sharing one — as
the reference ends up doing, both handles resolving to the same
`proc.userdata["silero_vad"]` — forces one `min_silence_duration` to serve both,
and 650 ms of patience in the endpointer is 650 ms of the agent talking over the
patient. A second Silero is a 1.8 MB ONNX graph, and loading it cost 110 ms.

### Interim transcripts: what they actually cost

faster-whisper has no partial-decode API, so every interim re-transcribes
everything said so far. Measured on this box (Whisper `small`, int8, CPU, while
the sidecar and Ollama were also up), for a 12.9 s utterance:

```
[  0.17s] start_of_speech
[  3.48s] interim   I have had a very bad
[  5.45s] interim   have had a very bad headache for about three days.
[  7.55s] interim   …now it started
[  9.73s] interim   …It started on M
[ 12.25s] interim   …
[ 14.80s] interim   …
[ 17.45s] interim   …
[ 20.14s] end_of_speech
[ 23.48s] final     I have had a very bad headache for about three days now. …
```

Three things follow, and all three are load-bearing:

1. **The spacing is the decode time, not `MEDIHIVE_INTERIM_EVERY_SEC`.** Only one
   interim runs at a time, and a decode takes 2–3.5 s here. That variable is a
   floor almost never reached.
2. **Interims lag, and the lag grows.** Each decode covers more audio than the
   last. The text still grows monotonically, which is what a screen wants.
3. **Short answers get no interims, by design.** An interim still in flight when
   the patient stops is cancelled — a partial landing after the final would
   overwrite good text with worse. Since a decode takes 2–3.5 s, any utterance
   under about 4 s always loses that race. Worse, cancelling the HTTP request does
   not stop the sidecar decoding, so that dead decode competes for the CPU the
   real transcript needs. `MEDIHIVE_INTERIM_MIN_SPEECH_SEC` is therefore `3.0`,
   raised from `0.9` on this measurement: short answers like _"three days"_ now
   cost nothing, and a long narrative still gets partials from ~5.5 s onward.

### The opening question is under a different key

The two routes name the same `NextQuestionView` differently, and getting it
wrong is silent:

| Route                      | Key               | Which question                        |
| -------------------------- | ----------------- | ------------------------------------- |
| `POST /sessions/:id/turns` | `nextQuestion`    | the one _after_ the answer just given |
| `GET /sessions/:id`        | `currentQuestion` | the one the patient is looking at now |

`describeSession` explains the split: `currentQuestion` is read "off the turn
log, not the selector: the selector skips what is pending, so re-running it here
would hand back the question _after_ the one the patient is looking at."

The agent asks for the opening question with the **GET**, so reading only
`nextQuestion` would have left `next_question` as `None` on every real session
and the agent would have joined and said nothing. `TurnResult.from_payload`
accepts either. `tools/fake_engine.py` originally answered `nextQuestion` on
both routes, which is precisely why the stub did not catch it — it now answers
the real `describeSession` shape.

That GET also carries `inputLanguage` and `outputLanguage`, and the agent adopts
both: the session is the authority on which language the patient speaks and
which one the questions are written in, not `MEDIHIVE_SESSION_LANGUAGE`. Since
the STT stream is created inside `session.start()` and the languages are only
known afterwards, `SidecarSTT.language` is a property whose setter reaches a
live stream.

### The turn budget, on one line

Every turn logs its own stages at INFO, and puts the same numbers on `/healthz`
as `lastLatency`:

```
INFO  latency hpi.duration: stt_partial=1710ms stt_final=2380ms engine=19ms
      llm_first_token=- tts_first_audio=657ms total=3056ms
```

Two kinds of number, and mixing them up is how a budget stops adding up.
`stt_partial`, `stt_final` and `total` are measured from the moment Silero says
the patient started speaking — the only anchor the patient shares with the
system. `engine`, `llm_first_token` and `tts_first_audio` are each measured from
the end of the hop before them, so they are per-stage costs. `total` is
time-to-**first audio**, not time-to-finish: it is what the patient experiences
as "the pause".

A `-` means the stage did not happen, and all three ways are ordinary: no interim
(the answer was shorter than `MEDIHIVE_INTERIM_MIN_SPEECH_SEC`), no LLM (phrasing
off, or it fell back), no audio (TTS refused the language and the question went
down as text).

Measured live, one room, `fake_engine.py` standing in for Nest so the engine hop
is a stub rather than the real ~15 ms:

| Turn                           | stt_partial | stt_final | engine | llm_first_token | tts_first_audio | total |
| ------------------------------ | ----------- | --------- | ------ | --------------- | --------------- | ----- |
| `hpi.associated.fever`         | 2125        | 4235      | 47     | —               | 1062            | 5344  |
| `hpi.duration` (interrupted)   | —           | 1750      | 16     | —               | **78**          | 1844  |
| `ros.constitutional.rigors`    | 1985        | 3235      | 15     | —               | **172**         | 3422  |
| `hpi.associated.fever`, LLM on | 1875        | 2766      | 78     | **1047**        | 203             | 4094  |

`stt_final` dominates: Whisper `small` on CUDA is 1.7–4.2 s for these
utterances, and everything after it is under a quarter of a second once Piper is
warm. That is where to look first, not at the synthesiser.

**Each turn holds its own copy of this record**, snapshotted in `run_turn`
before it posts. It has to: a barge-in is a new utterance, so it resets the live
record, and a turn reporting the reset one logged `tts_first_audio=- total=-`
for audio that had demonstrably played. See the note on `TurnLatency`.

`MEDIHIVE_TIMING_LOG` is still the authority for a real budget — it records every
hop as NDJSON with `perf_counter` timestamps two processes can be joined on, and
`tools/report_budget.py` reads it. This line is the same measurement where an
operator watching a live call is already looking.

### The microphone never follows another agent

A phone that loses signal comes back as a _new_ participant, and livekit-agents
does not follow it, so the worker re-links audio input itself when the
participant it was listening to has gone. The guard used to be only "is anybody
linked" — which is not enough, because the next participant to join is not
necessarily a person.

Measured in a live room: two `POST /voice/token` calls created two dispatches,
a second `medihive` worker joined the same session, and this handler gave it the
microphone. The worker then transcribed the other agent's questions and posted
them to `/turns` as the patient's answers —

```
final: On a scale of nothing at all to the worst you can imagine,
       where would you put it right now? 0 to 10. (confidence 0.82)
```

— six turns written into a clinical record with nobody speaking. `_is_agent`
now refuses any participant whose `kind` is `PARTICIPANT_KIND_AGENT` (4, read
off the wire enum), and an unknown `kind` is treated as a person, because a
microphone linked to somebody silent is recoverable and an interview conducted
with a robot is not.

### Barge-in stops three things, and the library only stops one

`turn_handling.interruption` stops the **playback** after `BARGE_MIN_SEC` of
speech. That is livekit-agents' whole responsibility and it knows nothing about
the other two things that are still running: the sidecar synthesising the rest of
the sentence, and Ollama generating the rest of the question. Left alone, both
run to completion for a patient who is already talking, on the same CPU the next
transcription needs — so interrupting the agent used to make the box _slower_.

So the worker subscribes to `user_state_changed`, and the transition into
`speaking` cancels one task that owns all three:

```
patient speaks
  -> user_state_changed(new_state="speaking")
  -> stop_speaking()                 cancels the speaking task
     -> SpeechHandle.interrupt()     playback stops
     -> `async with speak_stream`    exits; the /tts/stream socket closes,
                                     so the sidecar stops synthesising
     -> `llm.phrase` CancelledError  Ollama stops generating
```

The remaining lines of a multi-line reply are **dropped rather than queued**. A
red-flag turn is two lines — the routing instruction and the next question — and
a patient who talked over the first one used to get the second one anyway, which
from their side is an agent that ignored them and carried on.

Nothing is replayed afterwards (`resume_false_interruption: False`). Whatever is
still clinically outstanding comes back from the engine on the next turn.

Measured in a real LiveKit room with `tools/barge_probe.py --runs 3`, from the
patient's first sample on the wire to the agent's last audible frame **at the
ear** — so it includes WebRTC both ways and whatever was already in the
patient's own jitter buffer, none of which the worker can do anything about:

```
[0] interrupted 1705 ms into the reply; agent audio stopped 8718.3 ms later
[1] interrupted 1722 ms into the reply; agent audio stopped  628.3 ms later
[2] interrupted 1695 ms into the reply; agent audio stopped  765.8 ms later
```

Median **766 ms**, against a configured `BARGE_MIN_SEC` of 200 ms. Run `[0]` is
the first barge-in of the process and is an outlier in every run of this probe;
it is not the steady state and it is not currently explained.

### Barge-in is invisible unless you instrument it

livekit-agents logs **nothing** when a speech is cut off. Grepping its output for
`interrupt` finds only _"adaptive interruption is disabled by default"_ and
_"resumed false interrupted speech"_. On the streaming path the worker reads
`SpeechHandle.interrupted` directly; on the whole-WAV path there is no such
signal until the handle resolves, so `say()` times itself against the audio it
handed over and a wall time under 75% of the audio duration is recorded as an
interruption. Either way it lands in the log and in `interruptions` on
`/healthz`. Without it there is no way for an operator to answer "is barge-in
even working".

Measured, with a 15.35 s utterance and the patient speaking over it:

```
13:26:26,176 DEBUG agent state listening -> speaking
13:26:31,966 DEBUG agent state speaking -> listening
13:26:31,969 INFO  interrupted after 5.81s of 15.35s: Hello, and thank you for waiting…
```

The 75% margin exists because playout starts slightly before the first frame
lands and the last frame drains after the handle resolves; an uninterrupted
utterance measures within a few tens of milliseconds (`spoke 1.61s of 1.59s`).
One case reads oddly and is benign: the **opening** question is spoken before any
participant has subscribed, so playout blocks on the subscription and the first
`say()` reports a wall time _longer_ than its audio (`spoke 3.97s of 1.42s`).

### Two deviations from the reference's API

The reference implementation is written against livekit-agents 1.3.12; this runs
1.8.2, where two of the calls it uses now warn:

| Reference (1.3)                                            | Here (1.8.2)                            |
| ---------------------------------------------------------- | --------------------------------------- |
| `min_interruption_duration=`, `resume_false_interruption=` | `turn_handling={"interruption": {...}}` |
| `RoomInputOptions` + `RoomOutputOptions`                   | one `RoomOptions`                       |

The values are unchanged — same 0.2 s, same disabled resume, same transcription
output. Only the spelling moved, and the old one is removed in v2.0.

`"mode": "vad"` is named explicitly rather than left to auto-detect: `"adaptive"`
wants the end-of-turn transformer from `livekit-plugins-turn-detector`, which is
deliberately not installed.

### Confidence is carried around a gap in livekit-agents

`stt.SpeechData` has a `confidence` field and it is filled with Whisper's
exponentiated average log-probability, but `UserInputTranscribedEvent` — what
`session.on("user_input_transcribed")` actually receives — carries only
`transcript`, `is_final`, `item_id`, `speaker_id`, `language` and `created_at`.
The number is dropped in between.

It matters because `SubmitTurnDto.transcriptConfidence` exists for it; the DTO
calls it _"a real measurement, unlike anything a language model reports about
itself"_. `SidecarSTT` parks the last few finals by exact text and the handler
claims one. Without it every turn would post `0.0` and tell the engine that
every transcript is worthless.

## Memory

This box has 11.7 GB and has been running at 0.6–1.7 GB free with Ollama,
Docker, Nest and an ngrok tunnel up. Measured with everything running and one
interview turn completed:

| Process                      |        RSS |       Peak |     VMS |
| ---------------------------- | ---------: | ---------: | ------: |
| **voice-agent worker**       | **481 MB** | **483 MB** |  821 MB |
| ai-sidecar (Whisper + Piper) |     757 MB |    1003 MB | 3226 MB |

The worker was 452 MB immediately after joining and 483 MB after two turns, so
per-turn growth is roughly 30 MB of session state and then flat. The 481 MB is
almost entirely livekit-agents, its native `livekit` SDK and onnxruntime;
**Whisper and Piper are not in it**, which is the whole point of reaching them
over HTTP. Loading them in-process would have added another ~500 MB.

`GET http://127.0.0.1:9090/healthz` reports this live:

```json
{
  "status": "ok",
  "connected": true,
  "room": "case-final",
  "sessionId": "final",
  "language": "en",
  "turns": 1,
  "interimTranscripts": 2,
  "interruptions": 0,
  "agentState": "listening",
  "lastError": null,
  "spokenVia": "piper",
  "llm": "off (MEDIHIVE_LLM_PHRASING=0)",
  "lastLatency": {
    "sttFirstPartialMs": 1710.4,
    "sttFinalMs": 2380.1,
    "engineMs": 18.7,
    "llmFirstTokenMs": null,
    "ttsFirstAudioMs": 657.2,
    "totalMs": 3056.0
  },
  "models": {
    "sileroVad": "loaded (x2: stt segmentation, barge-in)",
    "whisper": "remote at http://127.0.0.1:8801/stt",
    "piper": "remote at http://127.0.0.1:8801/tts"
  },
  "memory": {
    "rssMb": 482.6,
    "systemAvailableMb": 669.6,
    "systemPercentUsed": 94.4
  }
}
```

It answers **503** until the worker is actually in a room, so a monitor can tell
"process alive" from "agent working".

## Testing without the phone

```powershell
# everything except LiveKit: both sidecar routes, every sample-rate hop,
# VAD endpointing, and both language refusals
.\.venv\Scripts\python.exe tools\selftest.py

# a full round trip through LiveKit Cloud, driven by a synthesised patient
.\.venv\Scripts\python.exe tools\fake_engine.py --port 3099      # terminal 1
$env:MEDIHIVE_API_URL="http://127.0.0.1:3099/api"                # terminal 2
$env:MEDIHIVE_API_TOKEN="dev"
.\run.ps1 connect --room case-demo
.\.venv\Scripts\python.exe tools\speak_into_room.py `            # terminal 3
    --room case-demo --say "I have had a headache for three days" --record reply.wav
```

`speak_into_room.py` synthesises the patient's line with the sidecar's own
`/tts` and publishes it as a real audio track, so the audio genuinely crosses
WebRTC, gets resampled by the SDK, endpointed by Silero and decoded by Whisper.
What it does **not** exercise is a microphone: no room noise, no AGC, no packet
loss, and Piper's output is cleaner than any phone will deliver.

## Smart App Control

Windows SAC is enforced on this box and refuses to load unsigned native binaries
it has not seen before. `../ai-sidecar/requirements.txt` documents the failure
mode, including a blocked numpy that presents as torch failing to import torch.

The reputation is per-binary and machine-wide, not per-venv, which gives a cheap
rule for a new venv on an old box: resolve every native wheel to a version the
box has already loaded. Thirteen of the twenty-one here matched `ai-sidecar/.venv`
without being asked; four are pinned to force the match (`numpy`, `onnxruntime`,
`propcache`, `yarl`). Six were unavoidably new — `livekit`, `grpcio`, `jiter`,
`livekit-blingfire`, `livekit-local-inference`, `sounddevice` — and all six
imported cleanly.

Run `tools\verify_imports.py` after any `pip install` in either venv. It checks
both, and names a SAC block when it sees one.
