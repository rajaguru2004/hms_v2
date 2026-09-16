"""How far away LiveKit Cloud is, in milliseconds, four different ways.

The note that prompted this: the project URL is `wss://ash10-....livekit.cloud`.
`ash10` reads as Ashburn, US-East. This box is not in Ashburn. Every audio frame
the patient speaks crosses that distance on the way in and every frame of the
reply crosses it on the way back, and **both** legs land inside the one number a
patient actually feels — "I stopped talking, when do I hear something". If that
is 300 ms it is 300 ms that no amount of Whisper tuning will recover.

So this measures it, rather than assuming it:

  1. **DNS** for the signalling host.
  2. **TCP connect** to :443, which is one network round trip by definition —
     SYN out, SYN/ACK back — and is therefore the cleanest RTT available
     without ICMP (which this box's firewall and most clouds drop anyway).
  3. **TLS handshake** on top, which is one or two more round trips.
  4. **Application round trip through the SFU**: two real participants in one
     real room, one sending a data packet the other echoes. This is the number
     that matters, because it crosses the media server, not just the edge.
  5. **One-way audio**, the same two participants, one publishing a tone burst
     the other listens for. This includes Opus encode, the SFU forward, the
     receiver's jitter buffer and Opus decode — the whole of what audio costs
     in each direction, which is exactly what hops 1 and 6 of the turn budget
     are paying.

Both participants run in this one process, so (4) and (5) are measured against a
single clock and no clock-skew correction is needed or possible to get wrong.

    python tools/probe_transport.py --runs 10

## Reading the result

TCP connect is the honest lower bound for one network round trip. If the data
round trip through the SFU is roughly TCP connect, the media server is at the
edge you connected to and nothing is being relayed further. If audio one-way is
much more than half the data round trip, the difference is jitter buffering,
which is a receiver-side choice and not distance.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import socket
import ssl
import statistics
import sys
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402
from livekit import rtc  # noqa: E402

from config import Settings, load_env_file  # noqa: E402
from tools.mint_token import mint  # noqa: E402

RATE = 48000
FRAME = RATE * 20 // 1000  # 20 ms, what WebRTC carries
# Loud enough to be unmistakable against Opus's noise floor, quiet enough not to
# clip. The detector's threshold is an order of magnitude below it.
TONE_AMPLITUDE = 12000
DETECT_THRESHOLD = 1500


def _stats(values: list[float]) -> dict:
    if not values:
        return {"n": 0}
    ordered = sorted(values)
    return {
        "n": len(ordered),
        "min": round(ordered[0], 1),
        "median": round(statistics.median(ordered), 1),
        "p90": round(ordered[min(len(ordered) - 1, int(len(ordered) * 0.9))], 1),
        "max": round(ordered[-1], 1),
    }


def _host(url: str) -> str:
    parsed = urlparse(url)
    return parsed.hostname or url.replace("wss://", "").replace("https://", "").split("/")[0]


def probe_network(host: str, runs: int) -> dict:
    """DNS, TCP and TLS, from the socket layer. No LiveKit involved."""
    dns: list[float] = []
    for _ in range(runs):
        t = time.perf_counter()
        addresses = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
        dns.append((time.perf_counter() - t) * 1000.0)
    ip = addresses[0][4][0]

    tcp: list[float] = []
    tls: list[float] = []
    context = ssl.create_default_context()
    for _ in range(runs):
        # A fresh socket every time: a reused one measures nothing.
        t = time.perf_counter()
        sock = socket.create_connection((ip, 443), timeout=10)
        connected = time.perf_counter()
        tcp.append((connected - t) * 1000.0)
        try:
            with context.wrap_socket(sock, server_hostname=host):
                tls.append((time.perf_counter() - connected) * 1000.0)
        except Exception:
            sock.close()

    return {
        "host": host,
        "ip": ip,
        "dnsMs": _stats(dns),
        # One network round trip, by construction: SYN out, SYN/ACK back.
        "tcpConnectMs": _stats(tcp),
        "tlsHandshakeMs": _stats(tls),
    }


async def probe_room(url: str, room_name: str, runs: int) -> dict:
    """Two real participants, one real room: data RTT and one-way audio."""
    sender, receiver = rtc.Room(), rtc.Room()

    echo_at: dict[int, float] = {}
    got_echo = asyncio.Event()

    @receiver.on("data_received")
    def _echo(packet: rtc.DataPacket) -> None:
        # Bounce it straight back. The echo hop is the receiver's own publish,
        # so the measured round trip is sender->SFU->receiver->SFU->sender.
        asyncio.create_task(
            receiver.local_participant.publish_data(packet.data, reliable=True, topic="echo")
        )

    @sender.on("data_received")
    def _returned(packet: rtc.DataPacket) -> None:
        try:
            seq = int(bytes(packet.data).split(b":")[0])
        except Exception:
            return
        echo_at[seq] = time.perf_counter()
        got_echo.set()

    heard: list[tuple[float, float]] = []  # (wall time, peak amplitude)
    listening = asyncio.Event()

    @receiver.on("track_subscribed")
    def _subscribed(track, publication, participant) -> None:  # type: ignore[no-untyped-def]
        if track.kind != rtc.TrackKind.KIND_AUDIO:
            return
        listening.set()

        async def _drain() -> None:
            stream = rtc.AudioStream(track, sample_rate=RATE, num_channels=1)
            async for event in stream:
                # Stamped on arrival at the application, which is where a
                # patient's ear effectively is: past the jitter buffer, decoded.
                now = time.perf_counter()
                samples = np.frombuffer(bytes(event.frame.data), dtype=np.int16)
                if samples.size:
                    heard.append((now, float(np.abs(samples).max())))

        asyncio.create_task(_drain())

    t_connect = time.perf_counter()
    await receiver.connect(url, mint(room_name, "probe-listener", ttl_minutes=15))
    receiver_connected = (time.perf_counter() - t_connect) * 1000.0

    t_connect = time.perf_counter()
    await sender.connect(url, mint(room_name, "probe-speaker", ttl_minutes=15))
    sender_connected = (time.perf_counter() - t_connect) * 1000.0

    source = rtc.AudioSource(RATE, 1, queue_size_ms=1000)
    track = rtc.LocalAudioTrack.create_audio_track("probe-tone", source)
    t_pub = time.perf_counter()
    await sender.local_participant.publish_track(
        track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
    )
    published_ms = (time.perf_counter() - t_pub) * 1000.0

    try:
        await asyncio.wait_for(listening.wait(), timeout=20)
        subscribe_ms = (time.perf_counter() - t_pub) * 1000.0
    except asyncio.TimeoutError:
        subscribe_ms = -1.0

    # ── Data round trip through the SFU ──────────────────────────────────────
    rtts: list[float] = []
    for seq in range(runs):
        got_echo.clear()
        sent = time.perf_counter()
        await sender.local_participant.publish_data(
            f"{seq}:probe".encode(), reliable=True, topic="probe"
        )
        try:
            await asyncio.wait_for(got_echo.wait(), timeout=5)
        except asyncio.TimeoutError:
            continue
        if seq in echo_at:
            rtts.append((echo_at[seq] - sent) * 1000.0)
        await asyncio.sleep(0.2)

    # ── One-way audio ────────────────────────────────────────────────────────
    #
    # 400 ms of silence, then a 120 ms tone. The wire time of the tone's first
    # sample is computed from `queued_duration`, which is how much audio is
    # still ahead of it in the source's own queue — without that correction the
    # measurement is off by up to the queue size, which is a second.
    silence = np.zeros(FRAME, dtype=np.int16)
    phase = np.arange(FRAME, dtype=np.float64) * (2 * np.pi * 440.0 / RATE)
    tone_frame = (np.sin(phase) * TONE_AMPLITUDE).astype(np.int16)

    one_way: list[float] = []
    for _ in range(runs):
        for _ in range(25):  # 500 ms of silence to separate this burst
            await source.capture_frame(
                rtc.AudioFrame(silence.tobytes(), RATE, 1, FRAME)
            )
        await asyncio.sleep(0.05)
        mark = len(heard)

        await source.capture_frame(rtc.AudioFrame(tone_frame.tobytes(), RATE, 1, FRAME))
        # Everything still queued ahead of the frame just captured, minus the
        # frame itself: the wall clock at which its first sample goes out.
        ahead = max(0.0, source.queued_duration - (FRAME / RATE))
        wire = time.perf_counter() + ahead
        for _ in range(5):  # 100 ms more tone so the burst survives a lost packet
            await source.capture_frame(rtc.AudioFrame(tone_frame.tobytes(), RATE, 1, FRAME))

        deadline = time.perf_counter() + 3.0
        detected = 0.0
        while time.perf_counter() < deadline:
            for when, peak in heard[mark:]:
                if peak >= DETECT_THRESHOLD and when >= wire - 0.05:
                    detected = when
                    break
            if detected:
                break
            await asyncio.sleep(0.005)
        if detected:
            one_way.append((detected - wire) * 1000.0)

    await sender.disconnect()
    await receiver.disconnect()

    return {
        "room": room_name,
        "connectMs": {"receiver": round(receiver_connected, 1), "sender": round(sender_connected, 1)},
        "publishTrackMs": round(published_ms, 1),
        "trackSubscribedMs": round(subscribe_ms, 1),
        "dataRoundTripMs": _stats(rtts),
        "audioOneWayMs": _stats(one_way),
    }


async def run(args: argparse.Namespace) -> int:
    settings = Settings.load()
    if not settings.livekit_url:
        raise SystemExit("LIVEKIT_URL is not set; it lives in hms_v2/.env.local")

    host = _host(settings.livekit_url)
    print(f"LiveKit signalling host: {host}")

    network = probe_network(host, args.runs)
    print(f"  resolves to      : {network['ip']}")
    print(f"  DNS              : {json.dumps(network['dnsMs'])}")
    print(f"  TCP connect (1 RTT): {json.dumps(network['tcpConnectMs'])}")
    print(f"  TLS handshake    : {json.dumps(network['tlsHandshakeMs'])}")

    print(f"\njoining room {args.room!r} with two participants ...")
    room = await probe_room(settings.livekit_url, args.room, args.runs)
    print(f"  room.connect     : {json.dumps(room['connectMs'])} ms")
    print(f"  publish track    : {room['publishTrackMs']} ms")
    print(f"  track subscribed : {room['trackSubscribedMs']} ms after publish")
    print(f"  data round trip  : {json.dumps(room['dataRoundTripMs'])}")
    print(f"  audio ONE WAY    : {json.dumps(room['audioOneWayMs'])}")

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"network": network, "room": room}, indent=2), encoding="utf-8")
    print(f"\nwrote {out}")
    return 0


def main() -> None:
    load_env_file()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=int, default=10)
    parser.add_argument("--room", default="latency-transport-probe")
    parser.add_argument(
        "--out",
        default=str(Path(tempfile.gettempdir()) / "medihive-timing" / "probe_transport.json"),
    )
    raise SystemExit(asyncio.run(run(parser.parse_args())))


if __name__ == "__main__":
    main()
