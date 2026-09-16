"""One SSL context, built once at import, shared by every HTTP client here.

This module exists because of a measurement, not a preference.

Constructing `httpx.AsyncClient()` eagerly builds an `ssl.SSLContext`, and
building one means reading and parsing certifi's CA bundle off disk — about
300 KB of PEM. On this box that took **387 ms**, and because the two clients
were being constructed inside the async entrypoint, all of it was spent on the
event loop. livekit-agents' own stall detector caught it:

    livekit.agents: blocking the event loop delays audio and turn handling,
    move it to a thread or an async client
    {"duration": 0.387, "threshold": 0.1, "task": "job_user_entrypoint", ...
      File "agent.py", line 203, in entrypoint
        sidecar = SidecarClient(
      File "httpx/_config.py", line 35, in create_ssl_context
        ctx = ssl.create_default_context(cafile=os.environ["SSL_CERT_FILE"])

387 ms of blocked loop at the top of a job is 387 ms in which no audio frame is
read and no VAD inference runs. It happens to land before the patient says
anything, which is why it showed up as a warning rather than as clipped speech,
but the same construction on any later path would land mid-interview.

The fix is to pay for it at **import** time, where there is no event loop to
block and the cost is ordinary process startup. [SSL_CONTEXT] is built when this
module is first imported and handed to every client as `verify=`, so
`httpx.AsyncClient(...)` becomes cheap and can be called from anywhere.

Worth noting what is *not* the fix: both services this worker talks to are
`http://` on 127.0.0.1, so no TLS handshake ever actually happens. It would have
been tempting to pass `verify=False` and skip the context entirely. That would
work today and quietly disable certificate verification the first day somebody
points `AI_SIDECAR_URL` or `MEDIHIVE_API_URL` at a real host over https.
"""

from __future__ import annotations

import ssl

import httpx

# Built at import. `httpx.create_ssl_context()` rather than `ssl.create_default_context()`
# so it honours the same SSL_CERT_FILE / SSL_CERT_DIR environment that httpx
# would have used, including the one livekit-agents sets for itself on Windows
# ("no system trust store found, setting SSL_CERT_FILE to the certifi bundle").
SSL_CONTEXT: ssl.SSLContext = httpx.create_ssl_context()


def async_client(timeout: float) -> httpx.AsyncClient:
    """An `httpx.AsyncClient` that does not block the loop to build itself."""
    return httpx.AsyncClient(timeout=httpx.Timeout(timeout), verify=SSL_CONTEXT)
