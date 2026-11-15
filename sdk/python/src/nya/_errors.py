from __future__ import annotations

from typing import Any, Dict, Optional


class NyaError(Exception):
    """Base error for every failure raised by the SDK."""

    def __init__(
        self,
        message: str,
        *,
        status: Optional[int] = None,
        code: Optional[str] = None,
        body: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.body = body or {}

    def __str__(self) -> str:
        parts = [self.message]
        if self.status is not None:
            parts.append(f"(HTTP {self.status}{', ' + self.code if self.code else ''})")
        return " ".join(parts)


class BadRequestError(NyaError):
    pass


class AuthenticationError(NyaError):
    pass


class PermissionDeniedError(NyaError):
    pass


class NotFoundError(NyaError):
    pass


class ConflictError(NyaError):
    pass


class SessionNotRunningError(ConflictError):
    pass


class RateLimitError(NyaError):
    pass


class ServiceUnavailableError(NyaError):
    pass


class SessionStoppedError(NyaError):
    """The CDP connection was closed because the session stopped or the browser restarted."""


_BY_STATUS = {
    400: BadRequestError,
    401: AuthenticationError,
    403: PermissionDeniedError,
    404: NotFoundError,
    409: ConflictError,
    429: RateLimitError,
    502: ServiceUnavailableError,
    503: ServiceUnavailableError,
}


def error_from_response(status: int, body: Dict[str, Any]) -> NyaError:
    message = str(body.get("error") or f"HTTP {status}")
    code = body.get("code")
    if code == "SESSION_NOT_RUNNING":
        cls = SessionNotRunningError
    else:
        cls = _BY_STATUS.get(status, NyaError)
    return cls(message, status=status, code=code, body=body)
