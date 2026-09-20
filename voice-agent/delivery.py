"""Getting the engine's sentences into the patient's ear, and knowing they got there.

Two pieces of logic, both lifted out of `entrypoint` in agent.py, and both here
for the same reason: they are where this worker was silently wrong, and neither
of them needs a LiveKit room to be wrong in. Testable in tools/test_delivery.py
against fakes, in milliseconds, with no cloud and no patient.

## [speak_all] — one question, no seams

`split_for_speech` cuts a long `patientMessage` into pieces the sidecar will
accept, and each piece is a separate Piper round trip. Synthesising a piece only
after the previous one had finished *playing* put that round trip — a few
hundred milliseconds on this box — into the middle of a sentence the patient was
listening to. This runs synthesis one piece ahead, so the next piece is already
in hand when the current one ends.

## [TurnBuffer] — a transcript is not a turn

Silero endpoints at 650 ms, so a patient who pauses mid-sentence produces two
final transcripts for one answer; livekit-agents joins them and closes the turn
a few hundred milliseconds later. The worker used to post on the first final,
which both split answers in half and raced the library into cutting off its own
question — see [CaseTakingAgent] in agent.py for the measurement.

So finals are held here and the turn starts on the commit. Which makes the
commit load-bearing, and load-bearing things need a backstop: a commit that
never arrives would otherwise be an answer nobody ever posted and a patient
waiting on a question that is never coming.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Awaitable, Callable, Generic, TypeVar

logger = logging.getLogger(__name__)

#: Whatever `synthesise` hands to `play` — frames and a provider name in the
#: worker, anything at all in a test. This module never looks inside it.
Audio = TypeVar("Audio")


async def speak_all(
    pieces: list[str],
    synthesise: Callable[[str], Awaitable[Audio | None]],
    play: Callable[[str, Audio], Awaitable[bool]],
) -> bool:
    """Speak every piece in order, synthesising one ahead. True if heard whole.

    Two failures, deliberately not the same thing:

      * **`synthesise` returns None** — there is no voice for this language. The
        caller has published the text, the patient reads it, and the interview
        carries on to the next piece. This does **not** count against delivery:
        counting it would leave every answer in a Tamil session unattributed and
        the engine re-asking the same question forever.
      * **`play` returns False** — the speech was cut off. The patient was
        listening and did not hear it. That is a real non-delivery, and it stops
        the rest of the message: reading the remaining sentences out over
        somebody who has started talking is the opposite of a conversation.

    The read-ahead task is always awaited before returning, including on
    cancellation, so a dropped turn cannot leave a Piper request running into a
    room that has moved on.
    """
    if not pieces:
        return True

    heard = True
    ahead: asyncio.Task[Audio | None] | None = asyncio.ensure_future(
        synthesise(pieces[0])
    )
    try:
        for index, piece in enumerate(pieces):
            current, ahead = ahead, (
                asyncio.ensure_future(synthesise(pieces[index + 1]))
                if index + 1 < len(pieces)
                else None
            )
            assert current is not None
            audio = await current
            if audio is None:
                continue
            if not await play(piece, audio):
                heard = False
                break
    finally:
        if ahead is not None:
            ahead.cancel()
            with contextlib.suppress(BaseException):
                await ahead
    return heard


class TurnBuffer(Generic[Audio]):
    """Final transcripts, held until the library closes the turn.

    `grace` is the backstop, not the normal path. Across every turn in
    agent.log the commit landed 0.13-0.84 s after the final, and the default is
    set above livekit-agents' own `max_delay` of 3.0 s so this only ever fires
    when the commit has genuinely been lost rather than merely been slow.
    """

    def __init__(
        self,
        *,
        grace: float,
        start: Callable[[str, float], None],
        on_lost: Callable[[str], None] | None = None,
    ) -> None:
        self._grace = grace
        self._start = start
        self._on_lost = on_lost
        self._texts: list[str] = []
        self._confidences: list[float] = []
        self._watchdog: asyncio.TimerHandle | None = None

    @property
    def waiting(self) -> bool:
        """Is there an answer held here that no turn has claimed yet?"""
        return bool(self._texts)

    def hold(self, text: str, confidence: float) -> None:
        """A final transcript. Kept, and the backstop timer rearmed."""
        text = (text or "").strip()
        if not text:
            return
        self._texts.append(text)
        self._confidences.append(confidence)
        self._arm()

    def commit(self, text: str, confidence: float) -> None:
        """The library has closed the user's turn, so ours can open.

        `text` is the library's own accumulation of every final in the turn,
        which is the better text — the two halves of a paused sentence arrive
        joined. It falls back to what is held for a commit that carried none,
        and so does the confidence, which is Whisper's exponentiated average
        log-probability either way.
        """
        self.cancel()
        held_text, held_confidence = self._take()
        text = (text or held_text).strip()
        if not text:
            return
        self._start(text, confidence if confidence > 0.0 else held_confidence)

    def cancel(self) -> None:
        """Disarm the backstop. Safe on a buffer that has none."""
        if self._watchdog is not None:
            self._watchdog.cancel()
            self._watchdog = None

    def _arm(self) -> None:
        self.cancel()
        self._watchdog = asyncio.get_running_loop().call_later(
            self._grace, self._lost
        )

    def _lost(self) -> None:
        self._watchdog = None
        text, confidence = self._take()
        if not text:
            return
        logger.warning(
            "no end-of-turn commit %.1fs after the final transcript; posting it "
            "anyway: %s",
            self._grace,
            text,
        )
        if self._on_lost is not None:
            self._on_lost(text)
        self._start(text, confidence)

    def _take(self) -> tuple[str, float]:
        text = " ".join(self._texts).strip()
        confidence = (
            sum(self._confidences) / len(self._confidences)
            if self._confidences
            else 0.0
        )
        self._texts.clear()
        self._confidences.clear()
        return text, confidence
