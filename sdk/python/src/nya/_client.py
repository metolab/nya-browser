from __future__ import annotations

from typing import Any, Optional

from ._models import Record
from ._resources import GroupsResource, ProxiesResource, SessionsResource
from ._transport import DEFAULT_TIMEOUT, AsyncTransport, SyncTransport, resolve_config


class _ClientBase:
    _transport: Any

    def _init_resources(self) -> None:
        self.sessions = SessionsResource(self)
        self.proxies = ProxiesResource(self)
        self.groups = GroupsResource(self)

    @property
    def base_url(self) -> str:
        return self._transport.base_url

    def me(self) -> Record:
        """The user that owns the API key."""
        return self._transport.call("GET", "/me", parse=lambda d: Record(d["user"]))


class Nya(_ClientBase):
    """Synchronous client.

    ``base_url`` is the public URL including any ``BASE_PATH`` (e.g. ``https://host/nya-browser``).
    Both arguments fall back to ``NYA_BASE_URL`` / ``NYA_API_KEY``.
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        *,
        timeout: float = DEFAULT_TIMEOUT,
        verify: Any = True,
    ) -> None:
        base, key = resolve_config(base_url, api_key)
        self._transport = SyncTransport(base, key, timeout=timeout, verify=verify)
        self._init_resources()

    def close(self) -> None:
        self._transport.close()

    def __enter__(self) -> "Nya":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()


class AsyncNya(_ClientBase):
    """Asyncio client. Every network method returns an awaitable."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        *,
        timeout: float = DEFAULT_TIMEOUT,
        verify: Any = True,
    ) -> None:
        base, key = resolve_config(base_url, api_key)
        self._transport = AsyncTransport(base, key, timeout=timeout, verify=verify)
        self._init_resources()

    async def close(self) -> None:
        await self._transport.close()

    async def __aenter__(self) -> "AsyncNya":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.close()
