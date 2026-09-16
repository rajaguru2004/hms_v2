"""Timestamps at every hop of the turn, as NDJSON, or nothing at all.

The worker already logs *that* things happened. This logs **when**, to a
resolution the turn budget needs, and in a form a second process can join
against.

## `mono` is the join key, not `wall`, and that is not a detail

Every line carries both. `wall` is `time.time()`, which is readable and which
`time.get_clock_info` on this box reports as `GetSystemTimeAsFileTime()` with a
**resolution of 15.625 ms**. Three events microseconds apart get the same `wall`.
A budget whose smallest hops are single-digit milliseconds cannot be built on a
clock that quantises to 15.6 ms, and the first version of this module said
otherwise in its own docstring, which is how the mistake nearly survived.

`mono` is `time.perf_counter()`, which on Windows is `QueryPerformanceCounter()`
at 100 ns resolution. CPython does not subtract a per-process origin from it, so
its zero is the machine's, not the process's: two processes started minutes
apart produce directly comparable values. Checked, not assumed — three separate
interpreters agreed on `time.time() - time.perf_counter()` to within the coarse
clock's own resolution.

So the fake patient in tools/latency_probe.py stamps `perf_counter` too, and
tools/report_budget.py subtracts one from the other.

## Off by default, and off means off

`MEDIHIVE_TIMING_LOG` unset -> [ENABLED] is False -> [mark] returns on its first
line. No file is opened, no thread is started, no dict is built. Measurement
instrumentation that costs something when nobody is measuring is instrumentation
that gets ripped out the first time somebody profiles the profiler.

## Why it buffers instead of writing

`mark` is called from the event loop, on the same task that is supposed to be
reading audio frames. A `write()` plus `flush()` to a file under
C:\\Users\\...\\OneDrive is not reliably a microsecond — OneDrive's filter driver
sits in that path, and a sync that lands mid-turn would show up in the
measurement as latency that is not there. So `mark` appends to a list under a
lock (tens of nanoseconds, no I/O) and a daemon thread drains it every 250 ms.

For the same reason the **default log location is the system temp directory,
not the project**: the thing being measured must not be measured through a file
synchroniser. Pass an explicit path to override.
"""

from __future__ import annotations

import atexit
import json
import os
import tempfile
import threading
import time
from pathlib import Path

_RAW = os.environ.get("MEDIHIVE_TIMING_LOG", "").strip()

#: True when this process was asked to record timings. Checked first in [mark].
ENABLED: bool = bool(_RAW)

#: Where the NDJSON goes. `MEDIHIVE_TIMING_LOG=1` picks a default under the
#: system temp dir rather than the project, which is OneDrive-synced here.
PATH: Path | None = None
if ENABLED:
    if _RAW in {"1", "true", "on", "yes"}:
        PATH = Path(tempfile.gettempdir()) / "medihive-timing" / f"worker-{os.getpid()}.ndjson"
    else:
        PATH = Path(_RAW)
    PATH.parent.mkdir(parents=True, exist_ok=True)

_buffer: list[str] = []
_lock = threading.Lock()
_stop = threading.Event()

# A label the marks carry until something sets it: the utterance or turn being
# measured. Purely for reading the log by eye — the report joins on time.
context: str = ""


def set_context(label: str) -> None:
    """Tag subsequent marks. Cosmetic; the analysis joins on `mono`."""
    global context
    context = label


def mark(event: str, **fields: object) -> float:
    """Record `event` at now. Returns the **`perf_counter`** it recorded.

    Not the wall clock, and the difference is the whole point. The return value
    is what [span] subtracts to get a duration, and a duration taken from a
    clock that ticks every 15.625 ms would report the `POST /turns` round trip —
    genuinely about 20 ms — as either 15.6 or 31.2 and never anything else.

        t0 = timing.mark("stt.http_start", bytes=len(wav))
        ...
        timing.span("stt.http_end", t0)
    """
    if not ENABLED:
        return 0.0
    mono = time.perf_counter()
    record = {
        "ev": event,
        # Readable, and 15.625 ms coarse. For humans reading the log.
        "wall": time.time(),
        # The one every measurement is actually made from.
        "mono": mono,
        "pid": os.getpid(),
    }
    if context:
        record["ctx"] = context
    if fields:
        record.update(fields)
    line = json.dumps(record, default=str)
    with _lock:
        _buffer.append(line)
    return mono


def span(event: str, started: float, **fields: object) -> None:
    """`mark`, with `ms` filled in from the `perf_counter` an earlier mark returned."""
    if not ENABLED:
        return
    mark(event, ms=round((time.perf_counter() - started) * 1000.0, 3), **fields)


def _drain() -> None:
    if PATH is None:
        return
    with _lock:
        if not _buffer:
            return
        chunk = "\n".join(_buffer) + "\n"
        _buffer.clear()
    with PATH.open("a", encoding="utf-8") as fh:
        fh.write(chunk)


def _pump() -> None:
    while not _stop.wait(0.25):
        try:
            _drain()
        except Exception:
            # A measurement harness must never be the reason a patient's
            # interview stops. A lost line is a lost line.
            pass
    try:
        _drain()
    except Exception:
        pass


if ENABLED:
    threading.Thread(target=_pump, daemon=True, name="timing").start()
    atexit.register(lambda: (_stop.set(), _drain()))
    mark("timing.open", path=str(PATH))
