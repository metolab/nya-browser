import { withBase } from '../basePath';

export function sessionDeskPath(sessionId: string) {
  return `/s/${encodeURIComponent(sessionId)}`;
}

export function sessionWindowName(sessionId: string) {
  return `nya-session-${sessionId}`;
}

export function openSessionDeskWindow(sessionId: string): Window | null {
  const path = withBase(sessionDeskPath(sessionId));
  return window.open(path, sessionWindowName(sessionId));
}
