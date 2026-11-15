from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Callable, Dict, Optional
from urllib.parse import quote, urlencode

from ._transport import camel

if TYPE_CHECKING:
    from ._transport import _BaseTransport


def then(transport: "_BaseTransport", value: Any, fn: Callable[[Any], Any]) -> Any:
    """Apply ``fn`` to a sync result, or chain it onto an awaitable in async mode."""
    if transport.is_async:

        async def run() -> Any:
            return fn(await value)

        return run()
    return fn(value)


class Record:
    """Read-only view over a server JSON object; ``obj.proxy_id`` reads ``proxyId``."""

    def __init__(self, data: Dict[str, Any]) -> None:
        self._data = dict(data or {})

    def __getattr__(self, name: str) -> Any:
        data = self.__dict__.get("_data", {})
        for key in (name, camel(name)):
            if key in data:
                value = data[key]
                return Record(value) if isinstance(value, dict) else value
        raise AttributeError(name)

    def __getitem__(self, key: str) -> Any:
        return self._data[key]

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, default)

    def to_dict(self) -> Dict[str, Any]:
        return dict(self._data)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, Record) and other._data == self._data

    def __repr__(self) -> str:
        label = self._data.get("name") or self._data.get("id") or ""
        return f"<{type(self).__name__} {label!r}>"


@dataclass(frozen=True)
class CdpEndpoint:
    """Where and how to open a CDP connection to one session's browser."""

    session_id: str
    ws_url: str
    http_url: str
    headers: Dict[str, str] = field(repr=False)
    browser: Optional[str] = None
    protocol_version: Optional[str] = None
    user_agent: Optional[str] = None
    api_key: str = field(default="", repr=False)

    @classmethod
    def from_response(cls, session_id: str, data: Dict[str, Any], api_key: str) -> "CdpEndpoint":
        return cls(
            session_id=session_id,
            ws_url=data["wsUrl"],
            http_url=data["httpUrl"],
            headers={"Authorization": f"Bearer {api_key}"},
            browser=data.get("browser"),
            protocol_version=data.get("protocolVersion"),
            user_agent=data.get("userAgent"),
            api_key=api_key,
        )

    @property
    def ws_url_with_token(self) -> str:
        """WebSocket URL that carries the key in the query string, for tools that cannot send headers."""
        return f"{self.ws_url}?{urlencode({'token': self.api_key})}"

    def page_ws_url(self, target_id: str, *, with_token: bool = False) -> str:
        url = f"{self.ws_url}/page/{quote(target_id, safe='')}"
        return f"{url}?{urlencode({'token': self.api_key})}" if with_token else url


class Proxy(Record):
    pass


class Group(Record):
    pass


class Window(Record):
    pass


class FileEntry(Record):
    pass
