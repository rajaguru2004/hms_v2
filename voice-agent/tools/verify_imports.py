"""Did this install break anything, and did Smart App Control block anything.

Run after every `pip install` in either venv. Two questions, because on this box
there are two ways an install goes wrong:

1. **Smart App Control blocked a new native binary.** A freshly published
   unsigned wheel has no reputation yet and Windows refuses to load it. The
   error always contains "An Application Control policy has blocked this file",
   but the traceback above it usually names something else entirely — see
   ai-sidecar/requirements.txt, where a blocked numpy presents as torch failing
   to import torch.
2. **The resolver moved a package the sidecar depends on.** These are separate
   venvs precisely so that cannot happen, and this checks that it did not.

    .venv\\Scripts\\python.exe tools\\verify_imports.py
"""

from __future__ import annotations

import importlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SIDECAR_PYTHON = ROOT.parent / "ai-sidecar" / ".venv" / "Scripts" / "python.exe"

# The agent venv. Every native binary the worker actually loads.
AGENT_MODULES = [
    "livekit.rtc",
    "livekit.agents",
    "livekit.plugins.silero",
    "livekit.api",
    "livekit.blingfire",
    "onnxruntime",
    "numpy.random",  # the specific submodule SAC blocked last time (_pcg64)
    "grpc",
    "jiter",
    "sounddevice",
    "av",
    "httpx",
    "psutil",
]

# The sidecar venv. The four the brief names, checked from here because this is
# the install that could have disturbed them.
SIDECAR_MODULES = ["faster_whisper", "piper", "rapidocr_onnxruntime", "tts"]

BLOCKED = "An Application Control policy has blocked this file"


def _check_here() -> list[str]:
    failures = []
    print(f"agent venv: {sys.executable}")
    for name in AGENT_MODULES:
        try:
            importlib.import_module(name)
            print(f"  OK    {name}")
        except Exception as exc:
            marker = "  <-- SMART APP CONTROL" if BLOCKED in str(exc) else ""
            print(f"  FAIL  {name}: {type(exc).__name__}: {exc}{marker}")
            failures.append(name)
    return failures


def _check_sidecar() -> list[str]:
    print(f"\nsidecar venv: {SIDECAR_PYTHON}")
    if not SIDECAR_PYTHON.exists():
        print("  (not present; skipping)")
        return []

    script = (
        "import importlib\n"
        f"for m in {SIDECAR_MODULES!r}:\n"
        "    try:\n"
        "        importlib.import_module(m)\n"
        "        print('  OK    ' + m)\n"
        "    except Exception as e:\n"
        "        print('  FAIL  %s: %s: %s' % (m, type(e).__name__, e))\n"
    )
    result = subprocess.run(
        [str(SIDECAR_PYTHON), "-c", script],
        capture_output=True,
        text=True,
        cwd=str(ROOT.parent / "ai-sidecar"),
    )
    print(result.stdout.rstrip() or result.stderr.rstrip())
    return [line for line in result.stdout.splitlines() if "FAIL" in line]


def main() -> int:
    failures = _check_here() + _check_sidecar()
    print()
    if failures:
        print(f"FAILED: {len(failures)} import(s) broken")
        if any(BLOCKED in f for f in failures):
            print("At least one is a Smart App Control block: pin an older build.")
        return 1
    print("All imports OK in both venvs.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
