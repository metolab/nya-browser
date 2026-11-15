from __future__ import annotations

import os
import re
from typing import Any, Callable, Dict, Optional

import httpx

from ._errors import NyaError, error_from_response

DEFAULT_TIMEOUT = 60.0

_CAMEL_RE = re.compile(r"_([a-z0-9])")


def camel(name: str) -> str:
    return _CAMEL_RE.sub(lambda m: m.group(1).upper(), name)


def camelize(value: Any) -> Any:
    """Convert snake_case keys (recursively) to the camelCase the server expects."""
    if isinstance(value, dict):
        return {camel(k) if isinstance(k, str) else k: camelize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [camelize(v) for v in value]
    return value


def resolve_config(base_url: Optional[str], api_key: Optional[str]):
    base = (base_url or os.environ.get("NYA_BASE_URL") or "").strip()
    key = (api_key or os.environ.get("NYA_API_KEY") or "").strip()
    if not base:
        raise NyaError("base_url is required (or set NYA_BASE_URL)")
    if not key:
        raise NyaError("api_key is required (or set NYA_API_KEY)")
    return base.rstrip("/"), key


def _decode(resp: httpx.Response) -> Any:
    try:
        data = resp.json() if resp.content else {}
    except ValueError:
        data = {"error": resp.text.strip() or f"HTTP {resp.status_code}"}
    if resp.is_error:
        raise error_from_response(resp.status_code, data if isinstance(data, dict) else {})
    return data


class _BaseTransport:
    is_async = False

    def __init__(self, base_url: str, api_key: str) -> None:
        self.base_url = base_url
        self.api_key = api_key
        self.api_url = f"{base_url}/api"

    @property
    def auth_headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"}


class SyncTransport(_BaseTransport):
    is_async = False

    def __init__(self, base_url: str, api_key: str, *, timeout: float, verify: Any) -> None:
        super().__init__(base_url, api_key)
        self.http = httpx.Client(
            base_url=self.api_url,
            headers=self.auth_headers,
            timeout=timeout,
            verify=verify,
            follow_redirects=True,
        )

    def call(self, method: str, path: str, *, parse: Optional[Callable[[Any], Any]] = None, **kw: Any) -> Any:
        data = _decode(self.http.request(method, path, **kw))
        return parse(data) if parse else data

    def stream_to(self, path: str, params: Dict[str, Any], write: Callable[[bytes], None]) -> None:
        with self.http.stream("GET", path, params=params) as resp:
            if resp.is_error:
                resp.read()
                _decode(resp)
            for chunk in resp.iter_bytes():
                write(chunk)

    def close(self) -> None:
        self.http.close()


class AsyncTransport(_BaseTransport):
    is_async = True

    def __init__(self, base_url: str, api_key: str, *, timeout: float, verify: Any) -> None:
        super().__init__(base_url, api_key)
        self.http = httpx.AsyncClient(
            base_url=self.api_url,
            headers=self.auth_headers,
            timeout=timeout,
            verify=verify,
            follow_redirects=True,
        )

    def call(self, method: str, path: str, *, parse: Optional[Callable[[Any], Any]] = None, **kw: Any) -> Any:
        async def run() -> Any:
            data = _decode(await self.http.request(method, path, **kw))
            return parse(data) if parse else data

        return run()

    async def stream_to(self, path: str, params: Dict[str, Any], write: Callable[[bytes], None]) -> None:
        async with self.http.stream("GET", path, params=params) as resp:
            if resp.is_error:
                await resp.aread()
                _decode(resp)
            async for chunk in resp.aiter_bytes():
                write(chunk)

    async def close(self) -> None:
        await self.http.aclose()
