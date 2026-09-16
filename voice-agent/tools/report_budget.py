"""Join the worker's timing log to the probe's, and print the budget.

Two processes measured the same turns. The worker wrote NDJSON from inside the
loop (timing.py); the probe wrote JSON from the patient's seat
(tools/latency_probe.py). Both stamp `time.perf_counter()`, which on Windows is
`QueryPerformanceCounter` — 100 ns resolution, and an origin that belongs to the
machine rather than the process, so the two series can be subtracted directly.
The `wall` field in both files is `time.time()`, which this box resolves to
15.625 ms; it is there to be read, never to be subtracted.

This walks each turn the probe recorded, finds the worker's events for it, and
lays the hops end to end:

    hop 1  end of speech at the wire   -> VAD endpoint fires
    hop 2  VAD endpoint                -> WAV built and POSTed to /stt
    hop 3  /stt request                -> transcript in hand
    hop 4  transcript                  -> POST /turns answered
    hop 5  turn answered               -> /tts WAV in hand
    hop 6  WAV in hand                 -> first audible frame at the patient
    hop 7  the whole thing, measured independently by the probe

The **residual** line is the point of the exercise. It is hop 7 minus the sum of
hops 1-6, and it is printed for every turn. If it is not near zero, a hop has
been left out of the accounting and the budget is lying; a budget that always
adds up because nobody checked is worth nothing.

Turns are matched by time: the worker's `vad.end_of_speech` nearest to — and
after — the probe's `speechEndMono`. The probe leaves seconds of silence between
utterances, so the match is never ambiguous, and any match further than
[MATCH_WINDOW] seconds is reported as unmatched rather than guessed.

    python tools/report_budget.py --worker <ndjson> --probe <json>
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# How far after the probe's end-of-speech a VAD endpoint may be and still be
# this turn's. Generous: it has to cover a badly stalled box, and the next
# utterance is seconds away.
MATCH_WINDOW = 12.0


def _load_ndjson(path: Path) -> list[dict]:
    rows: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    rows.sort(key=lambda r: r.get("mono", 0.0))
    return rows


def _first(events: list[dict], name: str, after: float, **match) -> dict | None:
    for event in events:
        if event.get("ev") != name or event.get("mono", 0.0) < after:
            continue
        if all(event.get(k) == v for k, v in match.items()):
            return event
    return None


def _ms(a: float | None, b: float | None) -> float | None:
    if a is None or b is None:
        return None
    return round((b - a) * 1000.0, 1)


def _stats(values: list) -> dict:
    ok = [v for v in values if isinstance(v, (int, float))]
    if not ok:
        return {"n": 0}
    ordered = sorted(ok)
    return {
        "n": len(ordered),
        "min": round(ordered[0], 1),
        "median": round(statistics.median(ordered), 1),
        "max": round(ordered[-1], 1),
    }


def build(worker: list[dict], probe: dict) -> list[dict]:
    turns: list[dict] = []
    for row in probe.get("rows", []):
        speech_end = row.get("speechEndMono")
        if speech_end is None:
            continue

        eos = None
        for event in worker:
            if event.get("ev") != "vad.end_of_speech":
                continue
            delta = event["mono"] - speech_end
            if -0.5 <= delta <= MATCH_WINDOW:
                eos = event
                break
        if eos is None:
            turns.append({**row, "matched": False})
            continue

        t0 = eos["mono"]
        wav = _first(worker, "stt.wav_built", t0, final=True)
        stt_start = _first(worker, "stt.http_start", t0)
        stt_end = _first(worker, "stt.http_end", t0)
        final_ready = _first(worker, "stt.final_ready", t0)
        transcribed = _first(worker, "transcript.final", t0)
        turn_start = _first(worker, "turn.http_start", t0)
        turn_end = _first(worker, "turn.http_end", t0)
        turn_parsed = _first(worker, "turn.parsed", t0)
        say_begin = _first(worker, "say.begin", t0)
        tts_start = _first(worker, "tts.http_start", t0)
        tts_end = _first(worker, "tts.http_end", t0)
        decode_end = _first(worker, "say.decode_end", t0)
        first_frame = _first(worker, "say.first_frame_out", t0)

        audible_wall = (
            speech_end + (row["endToFirstAudioMs"] / 1000.0)
            if row.get("endToFirstAudioMs")
            else None
        )

        # Interims that were started and then thrown away during this utterance.
        speech_start = row.get("speechStartMono") or t0
        wasted = [
            e
            for e in worker
            if e.get("ev") == "interim.cancelled" and speech_start <= e["mono"] <= t0 + 1.0
        ]

        turn = {
            **row,
            "matched": True,
            # ── hop 1 ────────────────────────────────────────────────────────
            "hop1_endpoint_ms": _ms(speech_end, t0),
            "hop1_vad_patience_ms": round(
                (eos.get("silence_ms") or 0) + (eos.get("inference_ms") or 0), 1
            ),
            "hop1_silence_ms": eos.get("silence_ms"),
            "hop1_inference_ms": eos.get("inference_ms"),
            "hop1_transport_ms": round(
                (_ms(speech_end, t0) or 0)
                - ((eos.get("silence_ms") or 0) + (eos.get("inference_ms") or 0)),
                1,
            ),
            "vad_buffered_ms": eos.get("buffered_ms"),
            # ── hop 2 ────────────────────────────────────────────────────────
            "hop2_buffer_post_ms": _ms(t0, stt_start["mono"] if stt_start else None),
            "hop2_wav_build_ms": (wav or {}).get("ms"),
            "hop2_wav_kb": round(((wav or {}).get("bytes") or 0) / 1024, 1),
            # ── hop 3 ────────────────────────────────────────────────────────
            "hop3_stt_ms": (stt_end or {}).get("ms"),
            # ── hop 4 ────────────────────────────────────────────────────────
            "hop4_plumbing_ms": _ms(
                stt_end["mono"] if stt_end else None, turn_start["mono"] if turn_start else None
            ),
            "hop4_turn_http_ms": (turn_end or {}).get("ms"),
            "hop4_server_ms": (turn_parsed or {}).get("server_ms"),
            # ── hop 5 ────────────────────────────────────────────────────────
            "hop5_to_tts_ms": _ms(
                turn_end["mono"] if turn_end else None, tts_start["mono"] if tts_start else None
            ),
            "hop5_tts_ms": (tts_end or {}).get("ms"),
            "hop5_reply_chars": (tts_end or {}).get("chars"),
            # ── hop 6 ────────────────────────────────────────────────────────
            "hop6_wav_decode_ms": (decode_end or {}).get("ms"),
            "hop6_to_first_frame_ms": _ms(
                tts_end["mono"] if tts_end else None,
                first_frame["mono"] if first_frame else None,
            ),
            "hop6_frame_to_audible_ms": _ms(
                first_frame["mono"] if first_frame else None, audible_wall
            ),
            "hop6_total_ms": _ms(tts_end["mono"] if tts_end else None, audible_wall),
            # ── hop 7 ────────────────────────────────────────────────────────
            "hop7_total_ms": row.get("endToFirstAudioMs"),
            "wasted_interims": len(wasted),
            "reply_audio_ms": (decode_end or {}).get("audio_ms"),
        }

        parts = [
            turn["hop1_endpoint_ms"],
            turn["hop2_buffer_post_ms"],
            turn["hop3_stt_ms"],
            turn["hop4_plumbing_ms"],
            turn["hop4_turn_http_ms"],
            turn["hop5_to_tts_ms"],
            turn["hop5_tts_ms"],
            turn["hop6_total_ms"],
        ]
        if all(p is not None for p in parts) and turn["hop7_total_ms"] is not None:
            turn["accounted_ms"] = round(sum(parts), 1)
            turn["residual_ms"] = round(turn["hop7_total_ms"] - sum(parts), 1)

        # A turn matched to the wrong VAD event, quarantined rather than
        # averaged in.
        #
        # The first utterance of a run is the one at risk: the worker has just
        # joined and is still speaking its opening question, so there are two
        # sets of `stt.*` and `tts.*` events in flight and `_first(...)` can
        # pick up the greeting's. It shows itself immediately — hop 6 comes out
        # **negative**, because the /tts call it found finished after the audio
        # it is supposed to precede.
        #
        # This is what the residual line is for. A budget that silently averaged
        # this turn in would have reported hop 1 as 11.7 s and blamed the VAD.
        reasons = []
        if (turn.get("hop6_total_ms") or 0) < 0:
            reasons.append("hop 6 is negative: matched to another utterance's /tts")
        if (turn.get("hop1_endpoint_ms") or 0) > 5000:
            reasons.append("hop 1 over 5 s: matched to a later endpoint")
        if reasons:
            turn["suspect"] = "; ".join(reasons)
        turns.append(turn)
    return turns


HOPS = [
    ("hop1_endpoint_ms", "1  end of speech -> VAD endpoint fires"),
    ("hop1_transport_ms", "     of which: WebRTC in + jitter buffer"),
    ("hop1_vad_patience_ms", "     of which: Silero silence + inference"),
    ("hop2_buffer_post_ms", "2  endpoint -> WAV built and POSTed"),
    ("hop3_stt_ms", "3  /stt request -> transcript in hand"),
    ("hop4_plumbing_ms", "4a transcript -> POST /turns issued"),
    ("hop4_turn_http_ms", "4b POST /turns round trip"),
    ("hop4_server_ms", "     of which: engine's own serverTimeMs"),
    ("hop5_to_tts_ms", "5a turn answered -> /tts issued"),
    ("hop5_tts_ms", "5b /tts round trip -> WAV in hand"),
    ("hop6_wav_decode_ms", "6a WAV -> frames (in worker)"),
    ("hop6_to_first_frame_ms", "6b WAV in hand -> first frame handed over"),
    ("hop6_frame_to_audible_ms", "6c first frame -> audible at the patient"),
    ("hop6_total_ms", "6  WAV in hand -> audible at the patient"),
    ("hop7_total_ms", "7  TOTAL: end of speech -> reply audible"),
    ("accounted_ms", "   (sum of hops 1-6)"),
    ("residual_ms", "   residual, hop 7 minus the sum"),
]


def report(turns: list[dict], label: str) -> None:
    matched = [t for t in turns if t.get("matched") and not t.get("suspect")]
    print(f"\n=== {label}  ({len(matched)}/{len(turns)} turns used) ===")
    for t in turns:
        if t.get("suspect"):
            print(f"  excluded turn {t.get('index')}: {t['suspect']}")
        elif not t.get("matched"):
            print(f"  excluded turn {t.get('index')}: no VAD endpoint found for it")
    if not matched:
        return
    print(f"{'hop':<48}{'median':>10}{'worst':>10}{'n':>5}")
    print("-" * 73)
    for key, title in HOPS:
        s = _stats([t.get(key) for t in matched])
        if not s.get("n"):
            continue
        print(f"{title:<48}{s['median']:>10.1f}{s['max']:>10.1f}{s['n']:>5}")


def main() -> None:
    temp = Path(tempfile.gettempdir()) / "medihive-timing"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker", default=str(temp / "worker.ndjson"))
    parser.add_argument("--probe", default=str(temp / "latency_probe.json"))
    parser.add_argument("--out", default=str(temp / "budget.json"))
    args = parser.parse_args()

    worker = _load_ndjson(Path(args.worker))
    probe = json.loads(Path(args.probe).read_text(encoding="utf-8"))
    turns = build(worker, probe)

    report(turns, "ALL TURNS")
    report([t for t in turns if t.get("kind") == "short"], "SHORT ANSWERS")
    report([t for t in turns if t.get("kind") == "long"], "LONGER SENTENCES")

    matched = [t for t in turns if t.get("matched") and not t.get("suspect")]
    wasted = sum(t.get("wasted_interims") or 0 for t in matched)
    hurt = [t for t in matched if (t.get("wasted_interims") or 0) > 0]
    clean = [t for t in matched if not (t.get("wasted_interims") or 0)]
    if hurt and clean:
        # The cost of an interim nobody saw. Cancelling the HTTP request does
        # not stop the sidecar decoding, so the final queues behind a decode
        # that was already thrown away.
        print("")
        print(f"/stt with a cancelled interim still decoding: "
              f"{json.dumps(_stats([t.get('hop3_stt_ms') for t in hurt]))}")
        print(f"/stt with nothing else in flight:            "
              f"{json.dumps(_stats([t.get('hop3_stt_ms') for t in clean]))}")
    print(f"\ninterim decodes started and then cancelled: {wasted} across {len(matched)} turns")
    print(f"join: {json.dumps(probe.get('join'))}")

    Path(args.out).write_text(json.dumps(turns, indent=2), encoding="utf-8")
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
