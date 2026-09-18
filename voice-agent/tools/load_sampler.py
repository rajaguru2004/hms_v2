"""What else the box was doing while the measurement was taken.

A latency budget is a statement about a machine, and this machine is shared:
Ollama, the Whisper/Piper sidecar, Nest, Docker, an ngrok tunnel, and — while
these measurements were being taken — a second voice-agent worker belonging to
somebody else's experiment. The sidecar serves `/stt` from a **blocking** call
inside an `async def`, so two clients do not share it, they queue behind each
other, and a decode timed while another client is mid-decode is a decode plus a
queue.

A number with no load figure beside it cannot be compared to a number taken
later, so every probe here samples CPU and free memory on a background thread
and reports the mean and peak over each measured span. When a median looks
unrepeatable, this is the column that says why.

Cheap on purpose: `psutil.cpu_percent(None)` is a delta against the previous
call, not a busy-wait, and a 250 ms cadence is nothing next to a two-second
Whisper decode.
"""

from __future__ import annotations

import threading
import time


class LoadSampler:
    """System CPU and free memory, sampled on a daemon thread.

    Used as a context manager for a whole run, then interrogated with
    [since] for each individual measurement inside it.
    """

    def __init__(self, interval: float = 0.25) -> None:
        self._interval = interval
        self._samples: list[tuple[float, float, float]] = []  # (wall, cpu%, availMB)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def __enter__(self) -> "LoadSampler":
        self.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self.stop()

    def start(self) -> None:
        try:
            import psutil  # noqa: F401
        except Exception:
            return
        self._thread = threading.Thread(target=self._pump, daemon=True, name="load")
        self._thread.start()

    def _pump(self) -> None:
        import psutil

        psutil.cpu_percent(None)  # prime the delta
        while not self._stop.wait(self._interval):
            try:
                self._samples.append(
                    (
                        time.time(),
                        psutil.cpu_percent(None),
                        psutil.virtual_memory().available / (1024 * 1024),
                    )
                )
            except Exception:
                return

    def stop(self) -> None:
        self._stop.set()

    def since(self, start: float, end: float | None = None) -> dict:
        """Mean and peak CPU, and the low-water mark of free memory, in a window."""
        end = end if end is not None else time.time()
        window = [s for s in self._samples if start <= s[0] <= end]
        if not window:
            return {"n": 0}
        cpu = [s[1] for s in window]
        avail = [s[2] for s in window]
        return {
            "n": len(window),
            "cpuMean": round(sum(cpu) / len(cpu), 1),
            "cpuMax": round(max(cpu), 1),
            "availMbMin": round(min(avail), 0),
        }
