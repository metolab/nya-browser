from __future__ import annotations

import importlib
from typing import TYPE_CHECKING, Any, Optional

from ._errors import NyaError

if TYPE_CHECKING:
    from ._models import CdpEndpoint
    from ._session import Session

_DRIVERS = ("patchright", "playwright")


def load_driver(driver: str, is_async: bool) -> Any:
    """Return ``sync_playwright``/``async_playwright`` from Patchright or Playwright."""
    names = _DRIVERS if driver == "auto" else (driver,)
    api = "async_api" if is_async else "sync_api"
    for name in names:
        try:
            module = importlib.import_module(f"{name}.{api}")
        except ImportError:
            continue
        return module.async_playwright if is_async else module.sync_playwright
    raise NyaError(
        f"{' or '.join(names)} is not installed. Install one with: "
        'pip install "nya-browser[patchright]" or pip install "nya-browser[playwright]"'
    )


def _persistent_context(browser: Any) -> Any:
    if not browser.contexts:
        raise NyaError("Browser has no default context")
    return browser.contexts[0]


def _connect_browser(playwright: Any, endpoint: "CdpEndpoint", timeout: float) -> Any:
    return playwright.chromium.connect_over_cdp(
        endpoint.ws_url,
        headers=endpoint.headers,
        timeout=timeout * 1000,
    )


def connect_context(session: "Session", playwright: Any, timeout: float) -> Any:
    if session._t.is_async:

        async def run() -> Any:
            endpoint = await session.ensure_running(timeout=timeout)
            browser = await _connect_browser(playwright, endpoint, timeout)
            return _persistent_context(browser)

        return run()
    endpoint = session.ensure_running(timeout=timeout)
    return _persistent_context(_connect_browser(playwright, endpoint, timeout))


class BrowserSession:
    """``with session.browser() as context`` / ``async with session.browser() as context``."""

    def __init__(self, session: "Session", *, driver: str, timeout: float) -> None:
        self._session = session
        self._driver = driver
        self._timeout = timeout
        self._manager: Any = None
        self._playwright: Any = None
        self._browser: Optional[Any] = None

    def __enter__(self) -> Any:
        if self._session._t.is_async:
            raise NyaError("Use 'async with session.browser()' with AsyncNya")
        endpoint = self._session.ensure_running(timeout=self._timeout)
        self._manager = load_driver(self._driver, False)()
        self._playwright = self._manager.start()
        try:
            self._browser = _connect_browser(self._playwright, endpoint, self._timeout)
            return _persistent_context(self._browser)
        except BaseException:
            self._playwright.stop()
            raise

    def __exit__(self, *exc: Any) -> None:
        try:
            if self._browser is not None:
                self._browser.close()
        finally:
            self._playwright.stop()

    async def __aenter__(self) -> Any:
        if not self._session._t.is_async:
            raise NyaError("Use 'with session.browser()' with Nya")
        endpoint = await self._session.ensure_running(timeout=self._timeout)
        self._manager = load_driver(self._driver, True)()
        self._playwright = await self._manager.start()
        try:
            self._browser = await _connect_browser(self._playwright, endpoint, self._timeout)
            return _persistent_context(self._browser)
        except BaseException:
            await self._playwright.stop()
            raise

    async def __aexit__(self, *exc: Any) -> None:
        try:
            if self._browser is not None:
                await self._browser.close()
        finally:
            await self._playwright.stop()
