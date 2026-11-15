"""Minimal asyncio CDP client for talking to a session browser without Playwright."""

from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from typing import Any, Awaitable, Callable, DefaultDict, Dict, List, Optional, Union

from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import ConnectionClosed

from ._errors import NyaError, SessionStoppedError
from ._models import CdpEndpoint

CLOSE_SESSION_STOPPED = 4001
CLOSE_BROWSER_CLOSED = 4002

Handler = Callable[[Dict[str, Any], Optional[str]], Union[None, Awaitable[None]]]


class CdpError(NyaError):
    pass


class CdpClient:
    """``async with CdpClient.connect(endpoint) as cdp: await cdp.send("Target.getTargets")``.

    Events are delivered to handlers registered with :meth:`on` as ``handler(params, session_id)``.
    """

    def __init__(self, ws: ClientConnection) -> None:
        self._ws = ws
        self._next_id = 0
        self._pending: Dict[int, asyncio.Future] = {}
        self._handlers: DefaultDict[str, List[Handler]] = defaultdict(list)
        self._closed_error: Optional[Exception] = None
        self._reader = asyncio.create_task(self._read())

    @classmethod
    def connect(cls, endpoint: CdpEndpoint, *, target_id: Optional[str] = None) -> "_Connector":
        url = endpoint.page_ws_url(target_id) if target_id else endpoint.ws_url
        return _Connector(url, endpoint.headers)

    async def send(
        self,
        method: str,
        params: Optional[Dict[str, Any]] = None,
        *,
        session_id: Optional[str] = None,
        timeout: Optional[float] = 60.0,
    ) -> Dict[str, Any]:
        if self._closed_error:
            raise self._closed_error
        self._next_id += 1
        msg: Dict[str, Any] = {"id": self._next_id, "method": method, "params": params or {}}
        if session_id:
            msg["sessionId"] = session_id
        fut = asyncio.get_running_loop().create_future()
        self._pending[self._next_id] = fut
        try:
            await self._ws.send(json.dumps(msg))
            return await asyncio.wait_for(fut, timeout)
        finally:
            self._pending.pop(msg["id"], None)

    def on(self, event: str, handler: Handler) -> None:
        self._handlers[event].append(handler)

    def off(self, event: str, handler: Handler) -> None:
        if handler in self._handlers.get(event, []):
            self._handlers[event].remove(handler)

    async def close(self) -> None:
        await self._ws.close()
        self._reader.cancel()

    async def _read(self) -> None:
        try:
            async for raw in self._ws:
                msg = json.loads(raw)
                if "id" in msg:
                    fut = self._pending.get(msg["id"])
                    if fut and not fut.done():
                        if "error" in msg:
                            err = msg["error"]
                            fut.set_exception(CdpError(err.get("message", "CDP error"), code=str(err.get("code"))))
                        else:
                            fut.set_result(msg.get("result", {}))
                    continue
                for handler in list(self._handlers.get(msg.get("method", ""), [])):
                    result = handler(msg.get("params", {}), msg.get("sessionId"))
                    if asyncio.iscoroutine(result):
                        asyncio.ensure_future(result)
        except ConnectionClosed:
            pass
        finally:
            self._fail_pending()

    def _fail_pending(self) -> None:
        code = self._ws.close_code
        if code in (CLOSE_SESSION_STOPPED, CLOSE_BROWSER_CLOSED):
            reason = "session_stopped" if code == CLOSE_SESSION_STOPPED else "browser_closed"
            error: Exception = SessionStoppedError(f"CDP connection closed: {reason}", code=reason)
        else:
            error = CdpError("CDP connection closed")
        self._closed_error = error
        for fut in self._pending.values():
            if not fut.done():
                fut.set_exception(error)


class _Connector:
    def __init__(self, url: str, headers: Dict[str, str]) -> None:
        self._url = url
        self._headers = headers
        self._client: Optional[CdpClient] = None

    def __await__(self):
        return self._open().__await__()

    async def _open(self) -> CdpClient:
        ws = await connect(self._url, additional_headers=self._headers, max_size=None, ping_interval=20)
        self._client = CdpClient(ws)
        return self._client

    async def __aenter__(self) -> CdpClient:
        return await self._open()

    async def __aexit__(self, *exc: Any) -> None:
        if self._client:
            await self._client.close()
