from __future__ import annotations

import asyncio
import io
import os
import time
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict, Iterable, List, Optional, Tuple, Union
from urllib.parse import quote

from ._errors import ServiceUnavailableError, SessionNotRunningError
from ._models import CdpEndpoint, FileEntry, Record, Window, then
from ._playwright import BrowserSession, connect_context

if TYPE_CHECKING:
    from ._client import _ClientBase

UploadItem = Union[str, os.PathLike, Tuple[str, bytes]]


def _q(value: str) -> str:
    return quote(str(value), safe="")


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
