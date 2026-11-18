from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, List, Optional
from urllib.parse import quote

from ._errors import NotFoundError
from ._models import CdpEndpoint, Group, Proxy, Record
from ._session import Session
from ._transport import camelize

if TYPE_CHECKING:
    from ._client import _ClientBase


def _q(value: str) -> str:
    return quote(str(value), safe="")


def _none(_data: Any) -> None:
    return None


class SessionsResource:
    """Create, edit, start and stop sessions. Creating/editing/stopping requires an admin key."""

    def __init__(self, client: "_ClientBase") -> None:
        self._c = client
        self._t = client._transport

    def _session(self, data: Dict[str, Any]) -> Session:
        return Session(self._c, data)

    def list(self) -> List[Session]:
        return self._t.call("GET", "/sessions", parse=lambda d: [self._session(s) for s in d.get("sessions", [])])

    def get(self, session_id: str) -> Session:
        def pick(d: Dict[str, Any]) -> Session:
            for s in d.get("sessions", []):
                if s.get("id") == session_id:
                    return self._session(s)
            raise NotFoundError("Session not found", status=404)

        return self._t.call("GET", "/sessions", parse=pick)

    def find(self, name: str) -> Optional[Session]:
        """First session whose name matches exactly, or None."""

        def pick(d: Dict[str, Any]) -> Optional[Session]:
            for s in d.get("sessions", []):
                if s.get("name") == name:
                    return self._session(s)
            return None

        return self._t.call("GET", "/sessions", parse=pick)

    def create(self, name: str, **fields: Any) -> Session:
        """Create a session. Fields use snake_case, e.g. ``proxy_id``, ``timezone``,
        ``chrome_language``, ``home_url``, ``idle_timeout_minutes``, ``gpu_profile``,
        ``webrtc_mode``, ``hardware_concurrency`` (2/4/6/8/10/12/16/20/24/32),
        ``device_memory`` (2/4/8/16/32), ``geo``, ``group_id``, ``os`` (``linux``/``windows``),
        ``windows_release`` (``win10``/``win11``)."""
        body = camelize({"name": name, **fields})
        return self._t.call("POST", "/sessions", json=body, parse=lambda d: self._session(d["session"]))

    def update(self, session_id: str, **fields: Any) -> Session:
        """Patch a session. A running browser restarts when launch settings change."""
        return self._t.call(
            "PATCH", f"/sessions/{_q(session_id)}", json=camelize(fields), parse=lambda d: self._session(d["session"])
        )

    def delete(self, session_id: str) -> None:
        return self._t.call("DELETE", f"/sessions/{_q(session_id)}", parse=_none)

    def start(self, session_id: str, *, url: Optional[str] = None) -> Session:
        body = {"url": url} if url else {}
        return self._t.call(
            "POST", f"/sessions/{_q(session_id)}/start", json=body, parse=lambda d: self._session(d["session"])
        )

    def stop(self, session_id: str) -> None:
        return self._t.call("POST", f"/sessions/{_q(session_id)}/stop", parse=_none)

    def restart(self, session_id: str, *, url: Optional[str] = None) -> Dict[str, Any]:
        body = {"url": url} if url else {}
        return self._t.call(
            "POST", f"/sessions/{_q(session_id)}/restart", json=body, parse=lambda d: d.get("runtime") or {}
        )

    def set_proxy(self, session_id: str, proxy_id: Optional[str]) -> Session:
        return self._t.call(
            "PUT",
            f"/sessions/{_q(session_id)}/proxy",
            json={"proxyId": proxy_id},
            parse=lambda d: self._session(d["session"]),
        )

    def regenerate_fingerprint(self, session_id: str) -> Session:
        return self._t.call(
            "POST",
            f"/sessions/{_q(session_id)}/fingerprint/regenerate",
            parse=lambda d: self._session(d["session"]),
        )

    def cdp(self, session_id: str) -> CdpEndpoint:
        return self._t.call(
            "GET",
            f"/sessions/{_q(session_id)}/cdp",
            parse=lambda d: CdpEndpoint.from_response(session_id, d, self._t.api_key),
        )


class ProxiesResource:
    """Proxy records (admin only)."""

    def __init__(self, client: "_ClientBase") -> None:
        self._t = client._transport

    def list(self) -> List[Proxy]:
        return self._t.call("GET", "/proxies", parse=lambda d: [Proxy(p) for p in d.get("proxies", [])])

    def get(self, proxy_id: str) -> Proxy:
        def pick(d: Dict[str, Any]) -> Proxy:
            for p in d.get("proxies", []):
                if p.get("id") == proxy_id:
                    return Proxy(p)
            raise NotFoundError("Proxy not found", status=404)

        return self._t.call("GET", "/proxies", parse=pick)

    def create(self, *, name: str, type: str, host: str, port: int, **fields: Any) -> Proxy:
        """``type`` is one of http, https, socks5, anytls, ss, vless. Extra fields:
        ``username``, ``password``, ``extra`` (dict), ``via_proxy_id``."""
        body = camelize({"name": name, "type": type, "host": host, "port": port, **fields})
        return self._t.call("POST", "/proxies", json=body, parse=lambda d: Proxy(d["proxy"]))

    def update(self, proxy_id: str, **fields: Any) -> Proxy:
        """Patch a proxy. Running sessions that use it reconnect."""
        return self._t.call(
            "PATCH", f"/proxies/{_q(proxy_id)}", json=camelize(fields), parse=lambda d: Proxy(d["proxy"])
        )

    def delete(self, proxy_id: str) -> None:
        return self._t.call("DELETE", f"/proxies/{_q(proxy_id)}", parse=_none)

    def test(self, proxy_id: str) -> Record:
        """Probe the proxy: latency, exit IP and location."""
        return self._t.call("POST", f"/proxies/{_q(proxy_id)}/test", parse=lambda d: Record(d["result"]))


class GroupsResource:
    """Session folders."""

    def __init__(self, client: "_ClientBase") -> None:
        self._t = client._transport

    def list(self) -> List[Group]:
        return self._t.call("GET", "/groups", parse=lambda d: [Group(g) for g in d.get("groups", [])])

    def create(self, name: str, *, parent_id: Optional[str] = None) -> Group:
        return self._t.call(
            "POST", "/groups", json={"name": name, "parentId": parent_id}, parse=lambda d: Group(d["group"])
        )

    def update(self, group_id: str, **fields: Any) -> Group:
        return self._t.call(
            "PATCH", f"/groups/{_q(group_id)}", json=camelize(fields), parse=lambda d: Group(d["group"])
        )

    def delete(self, group_id: str) -> None:
        return self._t.call("DELETE", f"/groups/{_q(group_id)}", parse=_none)
