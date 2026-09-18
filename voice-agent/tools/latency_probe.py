"""The number the patient feels: stopped talking -> heard something. Measured.

tools/speak_into_room.py proves the round trip happens. This one times it, from
the only vantage point that is not an opinion — the patient's. It joins the real
room over real WebRTC, speaks a real utterance, and records four arrivals:

    t_speech_end     the last sample of speech leaving this process's wire
    t_first_partial  the first interim transcript coming back
    t_turn_data      the engine's answer arriving as a data message
    t_reply_audible  the first audio frame of the reply above the noise floor

`t_reply_audible - t_speech_end` is hop 7 of the budget and the only figure that
decides whether this feels like a phone call. Everything else in the report is
an explanation of it.

    python tools/latency_probe.py --room case-<sessionId> --runs 5

## Getting `t_speech_end` right, which is the whole difficulty

`AudioSource.capture_frame` returns when a frame is *queued*, not when it is
sent — the source holds up to `queue_size_ms` and plays out at realtime — so
timing the last `capture_frame` overstates how early the patient stopped by up
to a second. Two corrections, both necessary:

  * The utterance is **trimmed of its trailing silence** before it is published.
    Piper ends every clip with a little, and the VAD's 650 ms of patience starts
    at the last *speech* sample, not the last sample in the file. Left in, that
    silence is charged to the VAD and the endpointing hop reads high.
  * After the last speech frame is queued, `await source.wait_for_playout()`
    blocks until the queue has drained. The wall clock at that moment is when
    the last sample went out, and that is `t_speech_end`.

## Getting `t_reply_audible` right

The received stream is scanned for the first 20 ms frame whose peak sample is
above a noise floor, after `t_speech_end`. Piper opens with a few tens of
milliseconds of near-silence, so "the first frame of the track" would be
optimistic by exactly that much and "the first loud frame" is what an ear does.
Both are recorded: `audibleMs` uses the threshold, `firstFrameMs` does not.

## What the run does not do

It does not simulate a phone. No room noise, no AGC, no packet loss, and Piper's
output is cleaner than any handset. Every number here is a **best case**.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import statistics
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402
from livekit import rtc  # noqa: E402

from config import Settings, load_env_file  # noqa: E402
from sidecar import SidecarClient  # noqa: E402
from tools.load_sampler import LoadSampler  # noqa: E402
from tools.mint_token import mint  # noqa: E402

PUBLISH_RATE = 48000
FRAME = PUBLISH_RATE * 20 // 1000

# Peak sample above which a 20 ms frame counts as audible. int16 full scale is
# 32767; Opus's comfort noise sits three orders of magnitude below this.
AUDIBLE_PEAK = 900
# The same threshold applied to the *outgoing* fixture when trimming, in peak
# terms, relative to the clip's own maximum. Piper's tail is true digital
# near-silence, so this is not delicate.
TRIM_FRACTION = 0.02

# The answers that dominate a real interview, and two that do not. The point of
# the split is that a budget built on the long one is a budget that flatters
# itself: Whisper's cost barely moves between "yes" and a full sentence, so the
# *proportion* of the turn that is model time is far worse for the short ones.
SHORT = [
    "yes",
    "three days",
    "on the left side",
    "about seven out of ten",
    "since yesterday morning",
    "no",
    "it comes and goes",
]
LONG = [
    "I have had a throbbing headache on the left side of my head for about three days now.",
    "It started on Saturday morning and it gets worse when I bend forward or cough.",
]


def _stats(values: list[float]) -> dict:
    ok = [v for v in values if v is not None and v == v]
    if not ok:
        return {"n": 0}
    ordered = sorted(ok)
    return {
        "n": len(ordered),
        "min": round(ordered[0], 1),
        "median": round(statistics.median(ordered), 1),
        "p90": round(ordered[min(len(ordered) - 1, int(len(ordered) * 0.9))], 1),
        "max": round(ordered[-1], 1),
    }


def _pcm_from_wav(wav: bytes) -> tuple[np.ndarray, int]:
    import io
    import wave as wavelib

    with wavelib.open(io.BytesIO(wav), "rb") as wf:
        rate, channels = wf.getframerate(), wf.getnchannels()
        raw = wf.readframes(wf.getnframes())
    samples = np.frombuffer(raw, dtype=np.int16)
    if channels > 1:
        samples = samples.reshape(-1, channels).astype(np.int32).mean(axis=1).astype(np.int16)
    return samples, rate


def _resample(samples: np.ndarray, src: int, dst: int) -> np.ndarray:
    if src == dst or samples.size == 0:
        return samples
    n = int(samples.size / src * dst)
    return np.interp(
        np.linspace(0, samples.size - 1, n),
        np.arange(samples.size, dtype=np.float64),
        samples.astype(np.float64),
    ).astype(np.int16)


def _trim_trailing_silence(samples: np.ndarray) -> np.ndarray:
    """Everything up to the last sample that is actually speech.

    Without this the VAD's 650 ms of patience is measured from the end of
    Piper's tail padding rather than from the end of the patient's voice, and
    hop 1 reports whatever that padding happens to be on top of the real figure.
    """
    if samples.size == 0:
        return samples
    threshold = max(1.0, float(np.abs(samples).max()) * TRIM_FRACTION)
    loud = np.nonzero(np.abs(samples) > threshold)[0]
    if loud.size == 0:
        return samples
    # A 30 ms lead-out so a fricative is not clipped, which would make the VAD
    # endpoint early and flatter hop 1.
    end = min(samples.size, int(loud[-1]) + int(PUBLISH_RATE * 0.03))
    return samples[:end]


class Probe:
    def __init__(self, room: rtc.Room, identity: str = "") -> None:
        self.room = room
        # Whose transcripts count as "the patient's words appearing". The room
        # carries the agent's transcript too — `TranscriptSynchronizer` forwards
        # the question it is speaking, word by word, as non-final segments — so
        # without this filter the "first partial" figure is the agent watching
        # itself talk, which is both wrong and flattering.
        self.identity = identity
        # (perf_counter, peak) per received 20 ms frame. `perf_counter`, not
        # `time.time()`: on this box the wall clock quantises to 15.625 ms,
        # while QueryPerformanceCounter resolves to 100 ns and shares its origin
        # across processes, so it is what the worker's timing log joins on.
        # See the note at the top of timing.py.
        self.heard: list[tuple[float, float]] = []
        self.data: list[tuple[float, dict]] = []
        self.transcripts: list[tuple[float, bool, str, str]] = []

    def attach(self) -> None:
        @self.room.on("data_received")
        def _on_data(packet: rtc.DataPacket) -> None:
            try:
                payload = json.loads(bytes(packet.data).decode("utf-8"))
            except Exception:
                return
            self.data.append((time.perf_counter(), payload))

        @self.room.on("transcription_received")
        def _on_tx(segments, participant, publication) -> None:  # type: ignore[no-untyped-def]
            who = getattr(participant, "identity", "") or ""
            if self.identity and who and who != self.identity:
                return
            now = time.perf_counter()
            for segment in segments:
                self.transcripts.append((now, bool(segment.final), segment.text, who))

        @self.room.on("track_subscribed")
        def _on_track(track, publication, participant) -> None:  # type: ignore[no-untyped-def]
            if track.kind != rtc.TrackKind.KIND_AUDIO:
                return

            async def _drain() -> None:
                stream = rtc.AudioStream(track, sample_rate=PUBLISH_RATE, num_channels=1)
                async for event in stream:
                    now = time.perf_counter()
                    samples = np.frombuffer(bytes(event.frame.data), dtype=np.int16)
                    if samples.size:
                        self.heard.append((now, float(np.abs(samples).max())))

            asyncio.create_task(_drain())

    def last_audible(self) -> float | None:
        """When the agent last said anything, or None if it never has.

        Not "when the last frame arrived": a subscribed track delivers 20 ms
        frames continuously whether or not anybody is talking into it, so
        `heard[-1]` is always about a twentieth of a second ago and a loop that
        waits for frames to stop never returns. That mistake cost a run.
        """
        for when, peak in reversed(self.heard):
            if peak >= AUDIBLE_PEAK:
                return when
        return None

    def first_audio_after(self, after: float) -> tuple[float | None, float | None]:
        """(first frame at all, first audible frame) arriving after `after`."""
        first = audible = None
        for when, peak in self.heard:
            if when <= after:
                continue
            if first is None:
                first = when
            if peak >= AUDIBLE_PEAK:
                audible = when
                break
        return first, audible

    def data_after(self, after: float, kind: str) -> tuple[float | None, dict | None]:
        for when, payload in self.data:
            if when > after and payload.get("type") == kind:
                return when, payload
        return None, None

    def transcript_after(self, after: float, final: bool) -> tuple[float | None, str]:
        for when, is_final, text, _who in self.transcripts:
            if when > after and is_final == final:
                return when, text
        return None, ""


async def _speak(source: rtc.AudioSource, samples: np.ndarray) -> tuple[float, float]:
    """Publish `samples` at realtime. Returns (first sample out, last sample out).

    Both ends need the queue correction, and for a while only one of them had
    it. `wait_for_playout` gives the end honestly, but the **start** was being
    read as "now, just before the first capture_frame" — and the run-in of
    silence before each utterance leaves up to `queue_size_ms` of that silence
    still ahead of it in the source's queue. The first speech sample therefore
    goes out as much as a second later than that timestamp says.

    It showed up as an absurdity: the worker's VAD appeared to notice speech
    starting 1360 ms after the patient started speaking, on a wire measured at
    86 ms one way. Subtracting the queue brings it to ~310 ms, which is what
    the same probe measures from the other end of the utterance.

    Anything derived from the start — the interim-transcript figure above all —
    is wrong by that amount without this.
    """
    first = samples[:FRAME]
    if first.size < FRAME:
        first = np.pad(first, (0, FRAME - first.size))
    await source.capture_frame(rtc.AudioFrame(first.tobytes(), PUBLISH_RATE, 1, FRAME))
    # Everything still queued ahead of the frame just captured, minus that
    # frame: when its first sample actually leaves.
    started = time.perf_counter() + max(0.0, source.queued_duration - (FRAME / PUBLISH_RATE))

    for i in range(FRAME, samples.size, FRAME):
        chunk = samples[i : i + FRAME]
        if chunk.size < FRAME:
            chunk = np.pad(chunk, (0, FRAME - chunk.size))
        await source.capture_frame(
            rtc.AudioFrame(chunk.tobytes(), PUBLISH_RATE, 1, FRAME)
        )
    await source.wait_for_playout()
    return started, time.perf_counter()


async def _wait_until_quiet(
    source: rtc.AudioSource, probe: "Probe", quiet_for: float, *, timeout: float
) -> None:
    """Hold the microphone open, publishing silence, until the agent stops.

    Keeps publishing rather than sleeping, because a source that is not fed
    still has a track and a patient who stops transmitting mid-interview is not
    what is being simulated.
    """
    deadline = time.perf_counter() + timeout
    while time.perf_counter() < deadline:
        await _silence(source, 0.2)
        last = probe.last_audible()
        if last is None or time.perf_counter() - last >= quiet_for:
            return


async def _silence(source: rtc.AudioSource, seconds: float) -> None:
    quiet = np.zeros(FRAME, dtype=np.int16)
    for _ in range(int(seconds * 50)):
        await source.capture_frame(rtc.AudioFrame(quiet.tobytes(), PUBLISH_RATE, 1, FRAME))


async def run(args: argparse.Namespace) -> int:
    settings = Settings.load()
    sidecar = SidecarClient(settings.sidecar_url)

    # `--runs` short answers, then `--long-runs` longer sentences. Short first
    # because they are the ones that dominate a real interview and the ones the
    # budget is most likely to be wrong about; if the box falls over halfway
    # through, the important half is already recorded.
    phrases: list[str] = []
    if args.say:
        phrases = [args.say] * args.runs
    else:
        if args.mode in ("short", "both"):
            phrases += [SHORT[i % len(SHORT)] for i in range(args.runs)]
        if args.mode in ("long", "both"):
            phrases += [LONG[i % len(LONG)] for i in range(args.long_runs)]

    print(f"synthesising {len(phrases)} utterance(s) via {settings.sidecar_url}/tts ...")
    fixtures: list[tuple[str, np.ndarray]] = []
    for phrase in phrases:
        wav, _ = await sidecar.speak(phrase, args.language)
        samples, rate = _pcm_from_wav(wav)
        samples = _trim_trailing_silence(_resample(samples, rate, PUBLISH_RATE))
        fixtures.append((phrase, samples))
        print(f"  {phrase[:48]!r:<52} {samples.size / PUBLISH_RATE:.2f}s")

    room = rtc.Room()
    probe = Probe(room, identity=args.identity)
    probe.attach()
    load = LoadSampler()
    load.start()

    # ── Join latency ─────────────────────────────────────────────────────────
    t = time.perf_counter()
    token = mint(args.room, args.identity, ttl_minutes=30)
    t_token = time.perf_counter()
    await room.connect(settings.livekit_url, token)
    t_connected = time.perf_counter()

    source = rtc.AudioSource(PUBLISH_RATE, 1, queue_size_ms=1000)
    track = rtc.LocalAudioTrack.create_audio_track("patient-mic", source)
    await room.local_participant.publish_track(
        track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
    )
    t_published = time.perf_counter()

    # The worker joins on dispatch, greets, and only then is listening. Wait for
    # audio from it rather than for a fixed sleep, so the first utterance is not
    # spoken into a room where nothing has subscribed yet.
    deadline = time.perf_counter() + args.join_timeout
    t_first_audio = None
    while time.perf_counter() < deadline:
        # The first frame we can *hear*, not the first frame that arrives: the
        # track starts delivering silence the moment it is subscribed.
        t_first_audio = probe.last_audible()
        if t_first_audio is not None:
            break
        await asyncio.sleep(0.05)

    if args.observe:
        # Join, say nothing, and report what the agent does on its own. This is
        # how the opening question gets proved end to end: the engine's
        # `GET /sessions/:id` answers with `currentQuestion`, not
        # `nextQuestion`, and a worker that read only the latter would join, go
        # silent, and look exactly like a worker with nothing to ask. Audio
        # arriving here is the proof that it read the right key.
        print(f"observing for {args.wait:.0f}s; not speaking ...")
        await _silence(source, args.wait)
        first, audible = probe.first_audio_after(t_connected)
        said = [d for _, d in probe.data if d.get("type") in ("turn", "speak")]
        when = round((audible - t_token) * 1000, 1) if audible else None
        print(f"\n  first audible audio : {when} ms after the token")
        for payload in said:
            if payload.get("type") == "turn":
                q = payload.get("nextQuestion") or {}
                print(f"  [turn]  status={payload.get('interviewStatus')} "
                      f"fieldPath={q.get('fieldPath')!r}")
                print(f"          prompt={q.get('prompt')!r}")
            else:
                print(f"  [speak] spoken={payload.get('spoken')} "
                      f"provider={payload.get('provider')} text={payload.get('text')!r}")
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(
            json.dumps(
                {
                    "observed": True,
                    "room": args.room,
                    "firstAudibleMsAfterToken": (
                        round((audible - t_token) * 1000, 1) if audible else None
                    ),
                    "audibleFrames": sum(1 for _, p in probe.heard if p >= AUDIBLE_PEAK),
                    "dataMessages": [d for _, d in probe.data],
                },
                indent=2,
            ),
            encoding="utf-8",
        )
        await room.disconnect()
        await sidecar.aclose()
        return 0 if audible else 1

    join = {
        "mintTokenMs": round((t_token - t) * 1000, 1),
        "roomConnectMs": round((t_connected - t_token) * 1000, 1),
        "publishTrackMs": round((t_published - t_connected) * 1000, 1),
        "toFirstAudioMs": round((t_first_audio - t) * 1000, 1) if t_first_audio else None,
        "agentParticipants": [p.identity for p in room.remote_participants.values()],
    }
    print(f"\njoin: {json.dumps(join)}")
    if not t_first_audio:
        print("  WARNING: no audio from the worker. Is it running and dispatched to this room?")

    # Let the greeting finish before the first utterance, or the first turn is a
    # barge-in and measures something else.
    await _silence(source, args.settle)
    await _wait_until_quiet(source, probe, args.settle, timeout=30.0)

    # ── The turns ────────────────────────────────────────────────────────────
    results: list[dict] = []
    for index, (phrase, samples) in enumerate(fixtures):
        # A run-in of silence so the VAD sees a clean onset.
        await _silence(source, 0.6)
        baseline = time.time()
        t_speech_start, t_speech_end = await _speak(source, samples)

        # Trailing silence, which is what lets the VAD endpoint at all, and then
        # room for the whole turn to come back.
        pushed = 0.0
        t_partial = t_turn = t_speak_msg = None
        t_first_frame = t_audible = None
        while pushed < args.wait:
            await _silence(source, 0.1)
            pushed += 0.1
            if t_partial is None:
                when, _ = probe.transcript_after(t_speech_start, final=False)
                t_partial = when
            if t_turn is None:
                t_turn, _ = probe.data_after(t_speech_end, "turn")
            if t_speak_msg is None:
                t_speak_msg, _ = probe.data_after(t_speech_end, "speak")
            t_first_frame, t_audible = probe.first_audio_after(t_speech_end + 0.05)
            if t_audible is not None:
                break

        _, final_text = probe.transcript_after(t_speech_start, final=True)
        _, turn_payload = probe.data_after(t_speech_end, "turn")
        row = {
            "index": index,
            "text": phrase,
            "kind": "short" if phrase in SHORT else "long",
            "audioS": round(samples.size / PUBLISH_RATE, 2),
            # perf_counter, the cross-process join key. Named `Mono` so nobody
            # subtracts one of these from a `time.time()` and gets 1789548449.
            "speechStartMono": t_speech_start,
            "speechEndMono": t_speech_end,
            "speechEndWall": time.time(),
            # Hop 7. The one that decides whether this is a call.
            "endToFirstAudioMs": round((t_audible - t_speech_end) * 1000, 1) if t_audible else None,
            "endToFirstFrameMs": (
                round((t_first_frame - t_speech_end) * 1000, 1) if t_first_frame else None
            ),
            "endToTurnDataMs": round((t_turn - t_speech_end) * 1000, 1) if t_turn else None,
            "endToSpeakDataMs": (
                round((t_speak_msg - t_speech_end) * 1000, 1) if t_speak_msg else None
            ),
            # Interim: measured from when the patient STARTED, which is the
            # question a patient asks ("when do I see my words appear").
            "startToFirstPartialMs": (
                round((t_partial - t_speech_start) * 1000, 1) if t_partial else None
            ),
            "transcript": final_text,
            # What else the box was doing. See tools/load_sampler.py.
            "load": load.since(baseline),
            "replyChars": len(
                ((turn_payload or {}).get("nextQuestion") or {}).get("prompt") or ""
            ),
            "baselineWall": baseline,
        }
        results.append(row)
        print(
            f"[{index}] {phrase[:34]!r:<38} audio={row['audioS']:>5.2f}s  "
            f"END->AUDIO {str(row['endToFirstAudioMs']):>8} ms   "
            f"turn-data {str(row['endToTurnDataMs']):>8} ms   "
            f"partial {str(row['startToFirstPartialMs']):>8} ms"
        )

        # Let the reply finish so the next utterance is not a barge-in.
        await _wait_until_quiet(source, probe, args.settle, timeout=40.0)

    load.stop()
    await room.disconnect()
    await sidecar.aclose()

    short = [r["endToFirstAudioMs"] for r in results if r["kind"] == "short"]
    long_ = [r["endToFirstAudioMs"] for r in results if r["kind"] == "long"]
    print("\n--- hop 7: end of speech -> first audio of the reply ---")
    print(f"  short answers : {json.dumps(_stats(short))}")
    print(f"  long answers  : {json.dumps(_stats(long_))}")
    print(f"  all           : {json.dumps(_stats([r['endToFirstAudioMs'] for r in results]))}")
    cpus = [(r.get('load') or {}).get('cpuMean') for r in results]
    print(f"  system CPU during the turns: {json.dumps(_stats(cpus))} %")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "join": join,
                "room": args.room,
                "rows": results,
                # Kept so a run can be audited after the fact: which transcript
                # segments arrived and from whom, and every data message.
                "transcripts": [
                    {"mono": w, "final": f, "text": t, "from": who}
                    for w, f, t, who in probe.transcripts
                ],
                "dataMessages": [{"mono": w, **d} for w, d in probe.data],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nwrote {out}")
    return 0


def main() -> None:
    load_env_file()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--room", required=True)
    parser.add_argument("--identity", default="patient-probe")
    parser.add_argument("--language", default="en")
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--mode", choices=["short", "long", "both"], default="both")
    parser.add_argument("--long-runs", type=int, default=3, help="longer sentences, after the short ones")
    parser.add_argument("--say", default=None, help="one phrase, repeated --runs times")
    parser.add_argument("--wait", type=float, default=25.0, help="seconds to wait for a reply")
    parser.add_argument("--settle", type=float, default=1.5, help="quiet needed between turns")
    parser.add_argument("--join-timeout", type=float, default=45.0)
    parser.add_argument(
        "--observe",
        action="store_true",
        help="join, say nothing, report what the agent asks unprompted",
    )
    parser.add_argument(
        "--out",
        default=str(Path(tempfile.gettempdir()) / "medihive-timing" / "latency_probe.json"),
    )
    args = parser.parse_args()
    with contextlib.suppress(KeyboardInterrupt):
        raise SystemExit(asyncio.run(run(args)))


if __name__ == "__main__":
    main()
