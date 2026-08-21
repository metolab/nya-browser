import type { Request } from 'express';
import type { RuntimeInfo, Session, UserPublic } from '@nya/shared';
import {
  listAccessibleSessions,
  listSessionGrants,
  listSessions,
  type SessionRecord,
} from '../../store.js';
import { getRuntimePublic, listWindows } from '../../runtime/sessionManager.js';
import { getUserById, toPublicUser } from '../auth/service.js';

function redactProxy(session: SessionRecord, admin: boolean) {
  const proxy = { ...session.proxy };
  if (!admin) proxy.password = proxy.password ? '***' : '';
  return proxy;
}

export function presentSession(session: SessionRecord, user: UserPublic | undefined): Session {
  const admin = user?.role === 'admin';
  const live = getRuntimePublic(session.id);
  const runtime = {
    windows: (live?.windows || []).map((w) => {
      const owner = w.ownerUserId ? getUserById(w.ownerUserId) : null;
      return {
        ...w,
        ownerUsername: owner ? toPublicUser(owner).username : null,
      };
    }),
  } as RuntimeInfo;
  const base: Session = {
    id: session.id,
    name: session.name,
    description: session.description,
    groupId: session.groupId,
    proxyId: session.proxyId,
    proxy: redactProxy(session, Boolean(admin)),
    fingerprint: session.fingerprint,
    timezone: session.timezone,
    homeUrl: session.homeUrl,
    idleTimeoutMinutes: session.idleTimeoutMinutes,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    runtime,
  };
  if (admin) {
    base.grants = listSessionGrants(session.id);
  }
  if (!admin && runtime.windows && user) {
    runtime.windows = runtime.windows.filter((w) => w.ownerUserId === user.id);
    base.runtime = runtime;
  }
  return base;
}

export function presentSessions(req: Request): Session[] {
  const user = req.user!;
  const all = user.role === 'admin' ? listSessions() : listAccessibleSessions(user.id);
  return all.map((s) => presentSession(s, user));
}

export function visibleWindows(sessionId: string, user: UserPublic) {
  const windows = listWindows(sessionId);
  if (user.role === 'admin') {
    return windows.map((w) => {
      const owner = w.ownerUserId ? getUserById(w.ownerUserId) : null;
      return { ...w, ownerUsername: owner ? owner.username : null };
    });
  }
  return windows.filter((w) => w.ownerUserId === user.id);
}
