"""Mint a LiveKit access token from the API key and secret. **Development only.**

In production the phone gets its token from Nest, which knows who the patient is
and can scope the grant to their own room. This script knows none of that: it
signs whatever identity and room it is told to, with the project's master
secret, because the thing holding that secret is a developer's shell.

Never ship this, never expose it, and never let the Flutter client call
anything shaped like it. It exists so the worker can be tested against a real
LiveKit Cloud room before the Nest endpoint that mints the real token is
finished.

    python tools/mint_token.py --room case-demo --identity patient-demo
"""

from __future__ import annotations

import argparse
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from livekit import api  # noqa: E402

from config import Settings, load_env_file  # noqa: E402


def mint(
    room: str,
    identity: str,
    *,
    name: str | None = None,
    ttl_minutes: int = 60,
    can_publish: bool = True,
    can_subscribe: bool = True,
) -> str:
    settings = Settings.load()
    if not settings.livekit_api_key or not settings.livekit_api_secret:
        raise SystemExit(
            "LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set "
            "(they live in hms_v2/.env.local)."
        )

    grants = api.VideoGrants(
        room_join=True,
        room=room,
        can_publish=can_publish,
        can_subscribe=can_subscribe,
        can_publish_data=True,
    )
    token = (
        api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(identity)
        .with_name(name or identity)
        .with_grants(grants)
        # Short by default. A development token that outlives the afternoon is
        # a credential somebody will paste into a test fixture.
        .with_ttl(timedelta(minutes=ttl_minutes))
    )
    return token.to_jwt()


def main() -> None:
    load_env_file()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--room", required=True)
    parser.add_argument("--identity", default="dev-participant")
    parser.add_argument("--name", default=None)
    parser.add_argument("--ttl-minutes", type=int, default=60)
    parser.add_argument(
        "--url", action="store_true", help="also print LIVEKIT_URL, for a client"
    )
    args = parser.parse_args()

    jwt = mint(args.room, args.identity, name=args.name, ttl_minutes=args.ttl_minutes)
    if args.url:
        print(Settings.load().livekit_url)
    print(jwt)


if __name__ == "__main__":
    main()
