import type { Request } from 'express';
import { getSession, userCanAccessNotepad, userCanAccessSession, type SessionRecord } from '../store.js';

export class HttpError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, message: string, body: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export function assertSessionAccess(
  req: Request,
  sessionId: string,
  opts: { manage?: boolean } = {},
): { session: SessionRecord; admin: boolean } {
  if (!req.user) throw new HttpError(401, 'Unauthorized');
  const session = getSession(sessionId);
  if (!session) throw new HttpError(404, 'Not found');
  if (req.user.role === 'admin') {
    return { session, admin: true };
  }
  if (!userCanAccessSession(req.user.id, session)) throw new HttpError(403, 'Forbidden');
  if (opts.manage) throw new HttpError(403, 'Forbidden');
  return { session, admin: false };
}

export function assertNotepadAccess(
  req: Request,
  sessionId: string,
): { session: SessionRecord; admin: boolean } {
  const { session, admin } = assertSessionAccess(req, sessionId);
  if (!admin && !userCanAccessNotepad(req.user!.id, session)) {
    throw new HttpError(403, 'Forbidden');
  }
  return { session, admin };
}

export function handleHttpError(err: unknown, res: import('express').Response) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...err.body });
  }
  throw err;
}
