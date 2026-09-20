"""The two places this worker was silently wrong, pinned against fakes.

    python tools/test_delivery.py

No sidecar, no LiveKit, no patient. Exits non-zero on the first failure, in the
style of tools/selftest.py, so it can gate a deploy.

Every case here is a transcript of something that actually happened. The
measurements quoted are from voice-agent/agent.log, session
`case-cmu9lvb6r00045eijv8xe1o2y` on 2026-09-20 unless another is named.
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from delivery import TurnBuffer, speak_all  # noqa: E402

FAILURES: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'OK   ' if ok else 'FAIL '} {name}{'  — ' + detail if detail else ''}")
    if not ok:
        FAILURES.append(name)


# ── speak_all ───────────────────────────────────────────────────────────────


async def test_speaks_every_piece_in_order() -> None:
    """Also pins the *shape*: whatever `synthesise` returns reaches `play` whole.

    The worker's `synthesise` returns `(frames, provider)` and its `play` takes
    that pair as one argument. A fake that returned a bare string passed this
    file while the worker raised `play() missing 1 required positional argument`
    on the first question of a live room — so the fakes here carry the real
    shape, opaque to `speak_all` and unpacked only by `play`.
    """
    spoken: list[str] = []

    async def synthesise(text: str) -> tuple[list[str], str]:
        return ([f"frame:{text}"], "piper")

    async def play(text: str, audio: tuple[list[str], str]) -> bool:
        frames, provider = audio
        assert frames == [f"frame:{text}"] and provider == "piper"
        spoken.append(text)
        return True

    heard = await speak_all(["one", "two", "three"], synthesise, play)
    check("speaks every piece, in order", spoken == ["one", "two", "three"], str(spoken))
    check("reports the whole message heard", heard is True)


async def test_synthesis_runs_one_piece_ahead() -> None:
    """The seam between two pieces must not cost a Piper round trip.

    Before this, synthesis started only after the previous piece had finished
    *playing*, so a two-sentence red-flag message came out as a sentence, a few
    hundred milliseconds of nothing, and another sentence. Timed rather than
    asserted structurally: three 60 ms syntheses and three 60 ms plays take
    ~360 ms serialised and ~240 ms pipelined.
    """
    order: list[str] = []

    async def synthesise(text: str) -> tuple[list[str], str]:
        order.append(f"synth:{text}")
        await asyncio.sleep(0.06)
        return ([f"frame:{text}"], "piper")

    async def play(text: str, audio: tuple[list[str], str]) -> bool:
        order.append(f"play:{text}")
        await asyncio.sleep(0.06)
        return True

    started = time.monotonic()
    await speak_all(["one", "two", "three"], synthesise, play)
    elapsed = time.monotonic() - started

    # "two" is synthesised while "one" is still in the patient's ear.
    check(
        "synthesises the next piece while the current one plays",
        order.index("synth:two") < order.index("play:one") + 2
        and order.index("synth:two") < order.index("play:two"),
        " ".join(order),
    )
    check(
        "costs no round trip at the seam",
        elapsed < 0.32,
        f"{elapsed * 1000:.0f} ms (serialised would be ~360 ms)",
    )


async def test_interruption_stops_the_rest() -> None:
    """A barge-in ends the message. It used to read the remaining sentences out."""
    spoken: list[str] = []

    async def synthesise(text: str) -> tuple[list[str], str]:
        return ([f"frame:{text}"], "piper")

    async def play(text: str, audio: tuple[list[str], str]) -> bool:
        spoken.append(text)
        return text != "two"  # cut off during the second piece

    heard = await speak_all(["one", "two", "three"], synthesise, play)
    check("stops speaking when the patient cuts in", spoken == ["one", "two"], str(spoken))
    check("reports the message as not heard", heard is False)


async def test_no_voice_still_counts_as_delivered() -> None:
    """TTS refusing a language is not the patient missing the question.

    A session in a language with no voice file gets its questions as text and
    the patient reads them. Counting that as non-delivery would leave every
    answer in the session unattributed and the engine re-asking forever — which
    is a worse bug than the one the delivery flag exists to fix.
    """
    played: list[str] = []

    async def synthesise(text: str) -> None:
        return None  # 503: no voice for this language

    async def play(text: str, audio: object) -> bool:
        played.append(text)
        return True

    heard = await speak_all(["one", "two"], synthesise, play)
    check("does not try to play what has no audio", played == [], str(played))
    check("treats a text-only question as delivered", heard is True)


async def test_read_ahead_is_never_left_running() -> None:
    """A cut-off message must not leave a Piper request in flight."""
    live = {"count": 0}

    async def synthesise(text: str) -> tuple[list[str], str]:
        live["count"] += 1
        try:
            await asyncio.sleep(0.2)
            return ([f"frame:{text}"], "piper")
        finally:
            live["count"] -= 1

    async def play(text: str, audio: tuple[list[str], str]) -> bool:
        return False  # interrupted on the first piece

    await speak_all(["one", "two", "three"], synthesise, play)
    await asyncio.sleep(0)
    check("awaits the read-ahead it cancels", live["count"] == 0, f"{live['count']} left running")


# ── TurnBuffer ──────────────────────────────────────────────────────────────


async def test_commit_joins_a_split_answer() -> None:
    """Two finals, one answer.

    Silero endpoints after 650 ms of silence, so "I have had a headache since
    Monday" said with a pause in it arrives as two finals. Posting each one
    separately is what filed "Since Monday" against a question about fainting.
    """
    posted: list[tuple[str, float]] = []
    turns = TurnBuffer(grace=5.0, start=lambda t, c: posted.append((t, c)))

    turns.hold("I have had a headache", 0.8)
    turns.hold("since Monday", 0.6)
    check("holds finals rather than posting them", posted == [], str(posted))

    turns.commit("I have had a headache since Monday", 0.7)
    turns.cancel()
    check(
        "posts the library's joined transcript once",
        posted == [("I have had a headache since Monday", 0.7)],
        str(posted),
    )


async def test_commit_without_a_transcript_falls_back() -> None:
    posted: list[tuple[str, float]] = []
    turns = TurnBuffer(grace=5.0, start=lambda t, c: posted.append((t, c)))

    turns.hold("three days", 0.5)
    turns.hold("about three days", 0.9)
    turns.commit("", 0.0)
    turns.cancel()
    check(
        "falls back to the held text and its mean confidence",
        posted == [("three days about three days", 0.7)],
        str(posted),
    )


async def test_watchdog_posts_a_lost_turn() -> None:
    """The backstop. Never seen in the log, and the reason the commit is safe
    to depend on: an answer the library never closes a turn for would otherwise
    be a patient talking into silence for the rest of the interview."""
    posted: list[tuple[str, float]] = []
    lost: list[str] = []
    turns = TurnBuffer(
        grace=0.05, start=lambda t, c: posted.append((t, c)), on_lost=lost.append
    )

    turns.hold("no fever", 0.9)
    await asyncio.sleep(0.12)
    check("posts an answer the library never committed", posted == [("no fever", 0.9)], str(posted))
    check("counts it so an operator can see it", lost == ["no fever"], str(lost))


async def test_commit_disarms_the_watchdog() -> None:
    posted: list[tuple[str, float]] = []
    turns = TurnBuffer(grace=0.05, start=lambda t, c: posted.append((t, c)))

    turns.hold("no fever", 0.9)
    turns.commit("no fever", 0.9)
    await asyncio.sleep(0.12)
    check("posts a committed turn exactly once", len(posted) == 1, str(posted))


async def test_empty_input_is_not_a_turn() -> None:
    posted: list[tuple[str, float]] = []
    turns = TurnBuffer(grace=0.05, start=lambda t, c: posted.append((t, c)))

    turns.hold("   ", 0.9)
    turns.commit("  ", 0.0)
    await asyncio.sleep(0.12)
    turns.cancel()
    check("never posts an empty turn", posted == [], str(posted))
    check("does not arm a backstop for nothing", turns.waiting is False)


async def main() -> int:
    tests = [
        ("speak_all", [
            test_speaks_every_piece_in_order,
            test_synthesis_runs_one_piece_ahead,
            test_interruption_stops_the_rest,
            test_no_voice_still_counts_as_delivered,
            test_read_ahead_is_never_left_running,
        ]),
        ("TurnBuffer", [
            test_commit_joins_a_split_answer,
            test_commit_without_a_transcript_falls_back,
            test_watchdog_posts_a_lost_turn,
            test_commit_disarms_the_watchdog,
            test_empty_input_is_not_a_turn,
        ]),
    ]
    for group, cases in tests:
        print(f"\n{group}")
        for case in cases:
            await case()

    print()
    if FAILURES:
        print(f"{len(FAILURES)} failed: {', '.join(FAILURES)}")
        return 1
    print("all delivery checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
