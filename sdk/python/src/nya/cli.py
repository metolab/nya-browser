from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from typing import List, Optional

from ._client import AsyncNya, Nya
from ._errors import NyaError


def _client_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--base-url", help="Nya Browser URL (default: $NYA_BASE_URL)")
    p.add_argument("--api-key", help="API key (default: $NYA_API_KEY)")


def _resolve_session(nya: Nya, ref: str) -> str:
    for s in nya.sessions.list():
        if ref in (s.id, s.name):
            return s.id
    raise NyaError(f"No session with id or name {ref!r}")


def cmd_sessions(args: argparse.Namespace) -> int:
    with Nya(args.base_url, args.api_key) as nya:
        for s in nya.sessions.list():
            state = "running" if s.running else "stopped"
            print(f"{s.id}\t{state}\t{s.name}")
    return 0


def cmd_cdp_url(args: argparse.Namespace) -> int:
    with Nya(args.base_url, args.api_key) as nya:
        session = nya.sessions.get(_resolve_session(nya, args.session))
        endpoint = session.ensure_running() if args.start else session.cdp()
        print(endpoint.ws_url_with_token if args.with_token else endpoint.ws_url)
    return 0


def cmd_cdp_forward(args: argparse.Namespace) -> int:
    from .forward import CdpForwarder

    with Nya(args.base_url, args.api_key) as nya:
        session_id = _resolve_session(nya, args.session)
        base_url, api_key = nya.base_url, nya._transport.api_key

    async def run() -> None:
        async with AsyncNya(base_url, api_key) as client:
            forwarder = CdpForwarder(client, session_id, host=args.host, port=args.port, start=args.start)
            print(f"CDP for session {session_id} at {forwarder.local_url}  (Ctrl+C to stop)", flush=True)
            await forwarder.serve_forever()

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="nya", description="Nya Browser command line tools")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("sessions", help="list sessions")
    _client_args(p)
    p.set_defaults(func=cmd_sessions)

    p = sub.add_parser("cdp-url", help="print the CDP WebSocket URL of a session")
    _client_args(p)
    p.add_argument("session", help="session id or name")
    p.add_argument("--start", action="store_true", help="start the session if it is stopped")
    p.add_argument("--with-token", action="store_true", help="embed the API key in the URL")
    p.set_defaults(func=cmd_cdp_url)

    p = sub.add_parser("cdp-forward", help="expose a session as a local unauthenticated CDP endpoint")
    _client_args(p)
    p.add_argument("session", help="session id or name")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=9222)
    p.add_argument("--start", action="store_true", help="start the session on first use")
    p.set_defaults(func=cmd_cdp_forward)

    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    try:
        return args.func(args)
    except NyaError as err:
        print(json.dumps({"error": str(err)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
