import { withBase } from '../basePath';

export function sessionDeskPath(sessionId: string) {
  return `/s/${encodeURIComponent(sessionId)}`;
}

export function sessionWindowName(sessionId: string) {
  return `nya-session-${sessionId}`;
}

export function openSessionDeskWindow(sessionId: string): Window | null {
  const path = withBase(sessionDeskPath(sessionId));
  const screen = window.screen as Screen & { availLeft?: number; availTop?: number };
  const availW = screen.availWidth || 1280;
  const availH = screen.availHeight || 800;
  const width = Math.min(availW, Math.max(1100, Math.round(availW * 0.9)));
  const height = Math.min(availH, Math.max(760, Math.round(availH * 0.9)));
  const left = Math.round((screen.availLeft || 0) + Math.max(0, (availW - width) / 2));
  const top = Math.round((screen.availTop || 0) + Math.max(0, (availH - height) / 2));
  return window.open(
    path,
    sessionWindowName(sessionId),
    `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
  );
}
