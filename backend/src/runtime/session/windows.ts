import crypto from 'crypto';
import type { WebSocket } from 'ws';
import type { UserPublic } from '@nya/shared';
import { parseWh } from './proc.js';
import { runtimes, SCREEN_INIT } from './state.js';

const vncCounts = new Map<string, number>();
const vncClients = new Map<string, Set<WebSocket>>();
export const cdpClients = new Map<string, Set<WebSocket>>();

let connectionsChanged: (sessionId: string) => void = () => {};

/** Called whenever a session gains or loses a VNC or CDP client. */
export function onConnectionsChanged(fn: (sessionId: string) => void) {
  connectionsChanged = fn;
}

export type SessionWindow = {
  id: string;
  kind: 'main' | 'sub';
  display: number;
  running: boolean;
  ownerUserId: string | null;
  vncConnections: number;
  width: number;
  height: number;
};

export function cdpClientCount(sessionId: string) {
  return cdpClients.get(sessionId)?.size || 0;
}

export function registerCdpClient(sessionId: string, ws: WebSocket) {
  let set = cdpClients.get(sessionId);
  if (!set) {
    set = new Set();
    cdpClients.set(sessionId, set);
  }
  set.add(ws);
  connectionsChanged(sessionId);
  ws.on('close', () => {
    set!.delete(ws);
    if (set!.size === 0 && cdpClients.get(sessionId) === set) cdpClients.delete(sessionId);
    connectionsChanged(sessionId);
  });
}

export function totalVncConnections(sessionId: string) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) return 0;
  let n = getVncCount(sessionId, null) + cdpClientCount(sessionId);
  for (const sub of runtime.subs) {
    n += getVncCount(sessionId, sub.id);
  }
  return n;
}

export function newOccupancy() {
  return crypto.randomBytes(12).toString('hex');
}

function vncKey(sessionId: string, subId: string | null = null) {
  return subId ? `${sessionId}:${subId}` : `${sessionId}:main`;
}

function addVncConnection(sessionId: string, subId: string | null = null) {
  const k = vncKey(sessionId, subId);
  vncCounts.set(k, (vncCounts.get(k) || 0) + 1);
  connectionsChanged(sessionId);
  return () => {
    const n = (vncCounts.get(k) || 1) - 1;
    if (n <= 0) vncCounts.delete(k);
    else vncCounts.set(k, n);
    connectionsChanged(sessionId);
  };
}

export function registerVncClient(sessionId: string, subId: string | null, ws: WebSocket) {
  const k = vncKey(sessionId, subId);
  let set = vncClients.get(k);
  if (!set) {
    set = new Set();
    vncClients.set(k, set);
  }
  const clients = set;
  clients.add(ws);
  const release = addVncConnection(sessionId, subId);
  const done = () => {
    clients.delete(ws);
    if (clients.size === 0) vncClients.delete(k);
    release();
  };
  ws.on('close', done);
  return done;
}

export function kickVncConnections(sessionId: string, subId: string | null = null) {
  const set = vncClients.get(vncKey(sessionId, subId));
  if (!set) return;
  for (const ws of [...set]) {
    try {
      ws.close(4000, 'taken_over');
    } catch {
      /* ignore */
    }
  }
}

export function getWindowOccupancy(sessionId: string, windowId: string | null | undefined) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) return null;
  if (!windowId || windowId === 'main') return runtime.occupancyId || null;
  const sub = runtime.subs.find((s) => s.id === windowId);
  return sub?.occupancyId || null;
}

export function withOccupancy(sessionId: string, win: SessionWindow | null) {
  if (!win) return null;
  return { ...win, occupancyId: getWindowOccupancy(sessionId, win.id) };
}

export function ownedWindows(sessionId: string, userId: string) {
  return listWindows(sessionId).filter((w) => w.ownerUserId === userId);
}

function getVncCount(sessionId: string, subId: string | null = null) {
  return vncCounts.get(vncKey(sessionId, subId)) || 0;
}

export function listWindows(sessionId: string): SessionWindow[] {
  const runtime = runtimes.get(sessionId);
  if (!runtime) return [];
  const boot = parseWh(SCREEN_INIT);
  const mainGeom = runtime.lastGeom || boot;
  const main: SessionWindow = {
    id: 'main',
    kind: 'main',
    display: runtime.display,
    running: true,
    ownerUserId: runtime.mainOwnerUserId || null,
    vncConnections: getVncCount(sessionId, null),
    width: mainGeom.w,
    height: mainGeom.h,
  };
  const subs = runtime.subs.map((sub): SessionWindow => {
    const geom = sub.lastGeom || boot;
    return {
      id: sub.id,
      kind: 'sub',
      display: sub.display,
      running: Boolean(sub.xvfb),
      ownerUserId: sub.ownerUserId || null,
      vncConnections: getVncCount(sessionId, sub.id),
      width: geom.w,
      height: geom.h,
    };
  });
  return [main, ...subs];
}

export function getWindow(sessionId: string, windowId: string) {
  return listWindows(sessionId).find((w) => w.id === windowId) || null;
}

export function canAccessWindow(
  sessionId: string,
  windowId: string | null | undefined,
  user: Pick<UserPublic, 'id' | 'role'> | null | undefined,
) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const win = getWindow(sessionId, windowId || 'main');
  if (!win) return false;
  return win.ownerUserId === user.id;
}

export function claimMainWindow(sessionId: string, userId: string) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) throw new Error('Session is not running');
  if (runtime.mainOwnerUserId && runtime.mainOwnerUserId !== userId) {
    throw new Error('Main window is in use');
  }
  runtime.mainOwnerUserId = userId;
  runtime.occupancyId = newOccupancy();
  return withOccupancy(sessionId, getWindow(sessionId, 'main'));
}

export function releaseMainWindow(sessionId: string, userId: string | null, asAdmin = false) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) return false;
  if (!asAdmin && runtime.mainOwnerUserId && runtime.mainOwnerUserId !== userId) {
    throw new Error('Not the window owner');
  }
  if (asAdmin || runtime.mainOwnerUserId === userId) {
    runtime.mainOwnerUserId = null;
  }
  return true;
}
