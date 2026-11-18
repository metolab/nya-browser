from __future__ import annotations

import asyncio
import io
import math
import os
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, Iterable, List, Optional, Tuple, Union
from urllib.parse import quote

from ._errors import ServiceUnavailableError, SessionNotRunningError
from ._models import CdpEndpoint, FileEntry, Record, Window, then
from ._playwright import BrowserSession, connect_context
from ._transport import camelize

if TYPE_CHECKING:
    from ._client import _ClientBase

UploadItem = Union[str, os.PathLike, Tuple[str, bytes]]

_WAIT_CHUNK_SECONDS = 25


def _q(value: str) -> str:
    return quote(str(value), safe="")


def _plain(value: Union[Dict[str, Any], Record]) -> Dict[str, Any]:
    return value.to_dict() if isinstance(value, Record) else dict(value)


class Session(Record):
    """A browser session (one isolated Chromium profile with its own proxy and fingerprint).

    In ``AsyncNya`` every network method returns an awaitable.
    """

    def __init__(self, client: "_ClientBase", data: Dict[str, Any]) -> None:
        super().__init__(data)
        self._client = client
        self._t = client._transport
        self.files = FilesResource(client, data["id"])
        self.windows = WindowsResource(client, data["id"])
        self.webauthn = WebAuthnResource(client, data["id"])
        self.passkeys = PasskeysResource(client, data["id"])

    @property
    def running(self) -> bool:
        return bool((self._data.get("runtime") or {}).get("running"))

    def _absorb(self, other: "Session") -> "Session":
        self._data = dict(other._data)
        return self

    def _path(self, leaf: str = "") -> str:
        return f"/sessions/{_q(self.id)}{leaf}"

    def refresh(self) -> "Session":
        return then(self._t, self._client.sessions.get(self.id), self._absorb)

    def update(self, **fields: Any) -> "Session":
        return then(self._t, self._client.sessions.update(self.id, **fields), self._absorb)

    def delete(self) -> None:
        return self._client.sessions.delete(self.id)

    def start(self, url: Optional[str] = None) -> "Session":
        return then(self._t, self._client.sessions.start(self.id, url=url), self._absorb)

    def stop(self) -> None:
        return self._client.sessions.stop(self.id)

    def restart(self, url: Optional[str] = None) -> Dict[str, Any]:
        return self._client.sessions.restart(self.id, url=url)

    def set_proxy(self, proxy_id: Optional[str] = None, *, custom: Optional[Any] = None) -> "Session":
        return then(self._t, self._client.sessions.set_proxy(self.id, proxy_id, custom=custom), self._absorb)

    def test_proxy(self) -> Record:
        return self._client.sessions.test_proxy(self.id)

    def regenerate_fingerprint(self) -> "Session":
        return then(self._t, self._client.sessions.regenerate_fingerprint(self.id), self._absorb)

    def cdp(self) -> CdpEndpoint:
        """CDP endpoint of the running browser. Raises SessionNotRunningError when stopped."""
        return self._client.sessions.cdp(self.id)

    def ensure_running(self, url: Optional[str] = None, timeout: float = 90.0) -> CdpEndpoint:
        """Start the session if needed and wait until its browser accepts CDP connections."""
        if self._t.is_async:
            return self._ensure_running_async(url, timeout)
        deadline = time.monotonic() + timeout
        started = False
        while True:
            try:
                return self.cdp()
            except SessionNotRunningError:
                if started and time.monotonic() > deadline:
                    raise
                if not started:
                    self.start(url)
                    started = True
                    continue
            except ServiceUnavailableError:
                if time.monotonic() > deadline:
                    raise
            time.sleep(0.5)

    async def _ensure_running_async(self, url: Optional[str], timeout: float) -> CdpEndpoint:
        deadline = time.monotonic() + timeout
        started = False
        while True:
            try:
                return await self.cdp()
            except SessionNotRunningError:
                if started and time.monotonic() > deadline:
                    raise
                if not started:
                    await self.start(url)
                    started = True
                    continue
            except ServiceUnavailableError:
                if time.monotonic() > deadline:
                    raise
            await asyncio.sleep(0.5)

    def connect(self, playwright: Any, *, timeout: float = 90.0) -> Any:
        """Attach a Playwright/Patchright instance and return the session's persistent BrowserContext.

        Pass the object from ``sync_playwright().start()`` (Nya) or ``async_playwright().start()``
        (AsyncNya). Never call ``browser.new_context()``: it creates a throwaway context without
        this session's cookies and storage.
        """
        return connect_context(self, playwright, timeout)

    def browser(self, *, driver: str = "auto", timeout: float = 90.0) -> BrowserSession:
        """Context manager that starts Playwright, connects, and yields the persistent context.

        ``driver`` is ``"auto"`` (Patchright if installed, else Playwright), ``"patchright"``
        or ``"playwright"``. Use ``with`` for Nya and ``async with`` for AsyncNya.
        """
        return BrowserSession(self, driver=driver, timeout=timeout)

    def get_notepad(self) -> str:
        return self._t.call("GET", self._path("/notepad"), parse=lambda d: d.get("notepad", ""))

    def set_notepad(self, text: str) -> str:
        return self._t.call(
            "PUT", self._path("/notepad"), json={"notepad": text}, parse=lambda d: d.get("notepad", "")
        )

    def _io_path(self, window: Optional[str], leaf: str) -> str:
        if window and window != "main":
            return self._path(f"/subs/{_q(window)}{leaf}")
        return self._path(leaf)

    def type_text(self, text: str, *, window: Optional[str] = None) -> None:
        """Type text through the X server (OS-level key events, no CDP involved)."""
        return self._t.call("POST", self._io_path(window, "/type"), json={"text": text}, parse=lambda _d: None)

    def get_clipboard(self, *, window: Optional[str] = None) -> Record:
        return self._t.call("GET", self._io_path(window, "/clipboard"), parse=Record)

    def set_clipboard(self, text: str, *, window: Optional[str] = None) -> Record:
        return self._t.call("PUT", self._io_path(window, "/clipboard"), json={"text": text}, parse=Record)


class WindowsResource:
    """Desktop windows of a session (the main window plus extra desktops)."""

    def __init__(self, client: "_ClientBase", session_id: str) -> None:
        self._t = client._transport
        self._base = f"/sessions/{_q(session_id)}/windows"

    def list(self) -> List[Window]:
        return self._t.call("GET", self._base, parse=lambda d: [Window(w) for w in d.get("windows", [])])

    def open(self, url: Optional[str] = None, *, takeover: bool = False) -> Window:
        body: Dict[str, Any] = {"takeover": takeover}
        if url:
            body["url"] = url
        return self._t.call("POST", self._base, json=body, parse=lambda d: Window(d["window"]))

    def close(self, window_id: str) -> None:
        return self._t.call("DELETE", f"{self._base}/{_q(window_id)}", parse=lambda _d: None)


class FilesResource:
    """Files in the session's shared folder. Browser downloads land here too."""

    def __init__(self, client: "_ClientBase", session_id: str) -> None:
        self._t = client._transport
        self._base = f"/sessions/{_q(session_id)}/files"

    def list(self, path: str = ".") -> List[FileEntry]:
        return self._t.call(
            "GET", self._base, params={"path": path}, parse=lambda d: [FileEntry(e) for e in d.get("entries", [])]
        )

    def downloads(self) -> List[Record]:
        """Chrome download history, including in-progress downloads."""
        return self._t.call(
            "GET", f"{self._base}/downloads", parse=lambda d: [Record(x) for x in d.get("downloads", [])]
        )

    def uploads(self) -> List[Record]:
        return self._t.call("GET", f"{self._base}/uploads", parse=lambda d: [Record(x) for x in d.get("uploads", [])])

    def mkdir(self, path: str) -> None:
        return self._t.call("POST", f"{self._base}/mkdir", json={"path": path}, parse=lambda _d: None)

    def delete(self, path: str) -> None:
        return self._t.call("DELETE", self._base, params={"path": path}, parse=lambda _d: None)

    def upload(self, files: Union[UploadItem, Iterable[UploadItem]], *, dir: str = ".") -> List[Record]:
        """Upload local paths or ``(name, bytes)`` pairs into ``dir``. Returns the stored entries."""
        items = [files] if isinstance(files, (str, os.PathLike, tuple)) else list(files)
        parts = []
        for item in items:
            if isinstance(item, tuple):
                name, content = item
            else:
                p = Path(item)
                name, content = p.name, p.read_bytes()
            parts.append(("files", (name, content)))
        return self._t.call(
            "POST",
            f"{self._base}/upload",
            params={"dir": dir},
            files=parts,
            parse=lambda d: [Record(x) for x in d.get("files", [])],
        )

    def read_bytes(self, path: str) -> bytes:
        buf = io.BytesIO()
        result = self._t.stream_to(f"{self._base}/download", {"path": path}, buf.write)
        return then(self._t, result, lambda _r: buf.getvalue())

    def download(self, path: str, dest: Union[str, os.PathLike, None] = None) -> Path:
        """Save a session file locally. ``dest`` may be a file path or an existing directory."""
        target = Path(dest) if dest is not None else Path.cwd()
        if target.is_dir():
            target = target / Path(path).name
        target.parent.mkdir(parents=True, exist_ok=True)
        fh = open(target, "wb")

        def done(_r: Any) -> Path:
            fh.close()
            return target

        try:
            result = self._t.stream_to(f"{self._base}/download", {"path": path}, fh.write)
        except BaseException:
            fh.close()
            raise
        if not self._t.is_async:
            return done(result)

        async def run() -> Path:
            try:
                await result
            finally:
                fh.close()
            return target

        return run()


class WebAuthnResource:
    """Server-held virtual authenticator of a session (one per tab, kept alive by the server).

    Options are CDP ``WebAuthn.VirtualAuthenticatorOptions`` in snake_case, e.g.
    ``has_resident_key=True``, ``transport="internal"``, ``ctap2_version="ctap2_1"``.
    """

    def __init__(self, client: "_ClientBase", session_id: str) -> None:
        self._t = client._transport
        self._base = f"/sessions/{_q(session_id)}/webauthn"

    def get(self) -> Record:
        """``{webauthn: {enabled, options}, runtime: {attached, tabs, armedTabs}}``."""
        return self._t.call("GET", self._base, parse=Record)

    def configure(self, enabled: Optional[bool] = None, **options: Any) -> Record:
        body: Dict[str, Any] = {}
        if enabled is not None:
            body["enabled"] = enabled
        if options:
            body["options"] = camelize(options)
        return self._t.call("PUT", self._base, json=body, parse=Record)

    def enable(self, **options: Any) -> Record:
        return self.configure(True, **options)

    def disable(self) -> Record:
        return self.configure(False)


class PasskeysResource:
    """Passkeys stored for a session, private keys included.

    Binary fields (``credential_id``, ``private_key``, ``user_handle``, ``large_blob``) are
    standard base64 as in CDP ``WebAuthn.Credential``; ``private_key`` is PKCS#8 DER.
    """

    def __init__(self, client: "_ClientBase", session_id: str) -> None:
        self._t = client._transport
        self._base = f"/sessions/{_q(session_id)}/passkeys"

    def list(self, rp_id: Optional[str] = None, status: Optional[str] = None) -> List[Record]:
        """All passkeys; ``status`` filters by ``active``, ``replaced`` or ``deleted_by_rp`` (comma list)."""
        params: Dict[str, Any] = {}
        if rp_id:
            params["rpId"] = rp_id
        if status:
            params["status"] = status
        return self._t.call(
            "GET", self._base, params=params, parse=lambda d: [Record(p) for p in d.get("passkeys", [])]
        )

    def get(self, passkey_id: str) -> Record:
        return self._t.call("GET", f"{self._base}/{_q(passkey_id)}", parse=lambda d: Record(d["passkey"]))

    def import_(
        self, credential: Union[Dict[str, Any], Record, Iterable[Union[Dict[str, Any], Record]]]
    ) -> Union[Record, List[Record]]:
        """Store one credential or a list as active, and load it into the running browser.

        Accepts a passkey from another session's ``list()``/``get()``, a CDP ``WebAuthn.getCredentials``
        item as is (camelCase), or snake_case keys. Re-importing a credential id overwrites it; an
        older resident credential of the same account becomes ``replaced``.
        A single credential returns one passkey, a list returns a list.
        """
        if isinstance(credential, (dict, Record)):
            return self._t.call(
                "POST", self._base, json=camelize(_plain(credential)), parse=lambda d: Record(d["passkey"])
            )
        items = [camelize(_plain(c)) for c in credential]
        return self._t.call(
            "POST", self._base, json={"passkeys": items}, parse=lambda d: [Record(p) for p in d.get("passkeys", [])]
        )

    def update(self, passkey_id: str, *, label: Optional[str] = None, sign_count: Optional[int] = None) -> Record:
        body: Dict[str, Any] = {}
        if label is not None:
            body["label"] = label
        if sign_count is not None:
            body["signCount"] = sign_count
        return self._t.call("PATCH", f"{self._base}/{_q(passkey_id)}", json=body, parse=lambda d: Record(d["passkey"]))

    def delete(self, passkey_id: str) -> None:
        return self._t.call("DELETE", f"{self._base}/{_q(passkey_id)}", parse=lambda _d: None)

    def cursor(self) -> int:
        """Sequence number of the latest event; pass it as ``after`` to :meth:`wait`."""
        return self._t.call("GET", f"{self._base}/cursor", parse=lambda d: int(d.get("cursor", 0)))

    def events(self, after: int = 0, limit: int = 200) -> List[Record]:
        return self._t.call(
            "GET",
            f"{self._base}/events",
            params={"after": after, "limit": limit},
            parse=lambda d: [Record(e) for e in d.get("events", [])],
        )

    def expect(
        self, kind: Optional[str] = "added", *, rp_id: Optional[str] = None, timeout: float = 60
    ) -> "PasskeyExpectation":
        """Wait for the event an action triggers: takes the cursor on enter, waits on exit.

        ``with s.passkeys.expect("added", rp_id="example.com") as ev: page.click(...)``, then
        ``ev.value.passkey``. Use ``async with`` for AsyncNya. Raises TimeoutError on exit.
        """
        return PasskeyExpectation(self, kind, rp_id, timeout)

    def wait(
        self,
        kind: Optional[str] = "added",
        *,
        rp_id: Optional[str] = None,
        after: Optional[int] = None,
        timeout: float = 60,
    ) -> Record:
        """Block until the first event after ``after`` (events already stored count).

        Without ``after`` only events from now on count; to catch the one a click triggers,
        take ``after = s.passkeys.cursor()`` before clicking, or use :meth:`expect`.
        ``kind`` is one of ``added``, ``asserted``, ``updated``, ``deleted``, ``replaced``,
        ``imported``, ``removed`` (comma list), or None for any. Returns ``{event, passkey}``
        where ``passkey`` carries the private key. Raises TimeoutError.
        """
        if self._t.is_async:
            return self._wait_async(kind, rp_id, after, timeout)
        if after is None:
            after = self.cursor()
        deadline = time.monotonic() + timeout
        while True:
            chunk = self._wait_chunk(deadline)
            params = self._wait_params(kind, rp_id, after, chunk)
            r = self._t.call("GET", f"{self._base}/wait", params=params, timeout=chunk + 15, parse=Record)
            if not r.get("timedOut"):
                return r
            if time.monotonic() >= deadline:
                raise TimeoutError(f"no passkey event within {timeout}s")

    async def _wait_async(
        self, kind: Optional[str], rp_id: Optional[str], after: Optional[int], timeout: float
    ) -> Record:
        if after is None:
            after = await self.cursor()
        deadline = time.monotonic() + timeout
        while True:
            chunk = self._wait_chunk(deadline)
            params = self._wait_params(kind, rp_id, after, chunk)
            r = await self._t.call("GET", f"{self._base}/wait", params=params, timeout=chunk + 15, parse=Record)
            if not r.get("timedOut"):
                return r
            if time.monotonic() >= deadline:
                raise TimeoutError(f"no passkey event within {timeout}s")

    @staticmethod
    def _wait_chunk(deadline: float) -> int:
        # Short long-polls stay under reverse-proxy idle timeouts and the server's 300s cap.
        return max(0, min(_WAIT_CHUNK_SECONDS, math.ceil(deadline - time.monotonic())))

    @staticmethod
    def _wait_params(kind: Optional[str], rp_id: Optional[str], after: int, chunk: int) -> Dict[str, Any]:
        params: Dict[str, Any] = {"after": after, "timeout": chunk}
        if kind:
            params["kind"] = kind
        if rp_id:
            params["rpId"] = rp_id
        return params


class PasskeyExpectation:
    """Returned by :meth:`PasskeysResource.expect`; ``value`` is the ``{event, passkey}`` record."""

    def __init__(self, resource: PasskeysResource, kind: Optional[str], rp_id: Optional[str], timeout: float) -> None:
        self._resource = resource
        self._kind = kind
        self._rp_id = rp_id
        self._timeout = timeout
        self._after = 0
        self._value: Optional[Record] = None

    @property
    def value(self) -> Record:
        if self._value is None:
            raise RuntimeError("the passkey event is available after the with block")
        return self._value

    def _wait(self) -> Any:
        return self._resource.wait(self._kind, rp_id=self._rp_id, after=self._after, timeout=self._timeout)

    def __enter__(self) -> "PasskeyExpectation":
        self._after = self._resource.cursor()
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        if exc_type is None:
            self._value = self._wait()
        return False

    async def __aenter__(self) -> "PasskeyExpectation":
        self._after = await self._resource.cursor()
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> bool:
        if exc_type is None:
            self._value = await self._wait()
        return False
