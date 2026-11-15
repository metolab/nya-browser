"""Local unauthenticated CDP endpoint that relays to a session through the Nya gateway.

Useful for tools that only accept ``http://127.0.0.1:9222`` style endpoints (Selenium
``debuggerAddress``, chrome-devtools-mcp ``--browserUrl``, ``chrome://inspect``).
Bind it to loopback only: anyone who can reach the port controls the session.
"""

from __future__ import annotations

import asyncio
import json
import logging
from http import HTTPStatus
from typing import Any, Optional

from websockets.asyncio.client import connect
from websockets.asyncio.server import ServerConnection, serve
from websockets.exceptions import ConnectionClosed
from websockets.http11 import Request, Response

from ._client import AsyncNya
from ._errors import NyaError

log = logging.getLogger("nya.forward")


class CdpForwarder:
    def __init__(
        self,
        client: AsyncNya,
        session_id: str,
        *,
        host: str = "127.0.0.1",
        port: int = 9222,
        start: bool = False,
    ) -> None:
        self.client = client
        self.session_id = session_id
        self.host = host
        self.port = port
        self.start = start

    @property
    def local_url(self) -> str:
        return f"http://{self.host}:{self.port}"

    async def _endpoint(self):
        if self.start:
            session = await self.client.sessions.get(self.session_id)
            return await session.ensure_running()
        return await self.client.sessions.cdp(self.session_id)

    def _json(self, connection: ServerConnection, body: Any, status: int = 200) -> Response:
        response = connection.respond(HTTPStatus(status), json.dumps(body))
        del response.headers["Content-Type"]
        response.headers["Content-Type"] = "application/json; charset=UTF-8"
        return response

    async def _process_request(self, connection: ServerConnection, request: Request) -> Optional[Response]:
        path = request.path.split("?", 1)[0].rstrip("/")
        if path.startswith("/devtools/"):
            return None
        local_ws = f"ws://{self.host}:{self.port}"
        try:
            if path == "/json/version":
                if self.start:
                    await self._endpoint()
                data = await self.client._transport.call("GET", f"/sessions/{self.session_id}/cdp/json/version")
                data["webSocketDebuggerUrl"] = f"{local_ws}/devtools/browser/{self.session_id}"
                return self._json(connection, data)
            if path in ("/json", "/json/list"):
                targets = await self.client._transport.call("GET", f"/sessions/{self.session_id}/cdp/json/list")
                for t in targets:
                    t["webSocketDebuggerUrl"] = f"{local_ws}/devtools/page/{t['id']}"
                return self._json(connection, targets)
        except NyaError as err:
            return self._json(connection, {"error": err.message, "code": err.code}, err.status or 502)
        return self._json(connection, {"error": "Not found"}, 404)

    async def _handle(self, local: ServerConnection) -> None:
        path = local.request.path.split("?", 1)[0]
        try:
            endpoint = await self._endpoint()
        except NyaError as err:
            await local.close(1011, err.message[:120])
            return
        if path.startswith("/devtools/page/"):
            url = endpoint.page_ws_url(path.rsplit("/", 1)[-1])
        else:
            url = endpoint.ws_url
        try:
            remote = await connect(url, additional_headers=endpoint.headers, max_size=None, ping_interval=20)
        except Exception as err:  # noqa: BLE001
            log.warning("upstream connect failed: %s", err)
            await local.close(1011, "upstream connect failed")
            return

        async def pump(src, dst) -> None:
            try:
                async for message in src:
                    await dst.send(message)
            except ConnectionClosed:
                pass

        tasks = [asyncio.create_task(pump(local, remote)), asyncio.create_task(pump(remote, local))]
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in tasks:
            task.cancel()
        code = remote.close_code if remote.close_code and remote.close_code >= 4000 else 1000
        await remote.close()
        await local.close(code, remote.close_reason or "")

    async def serve_forever(self) -> None:
        async with serve(
            self._handle,
            self.host,
            self.port,
            process_request=self._process_request,
            max_size=None,
            ping_interval=20,
        ) as server:
            log.info("forwarding %s -> session %s", self.local_url, self.session_id)
            await server.serve_forever()
