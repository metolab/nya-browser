import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import { and, asc, eq } from 'drizzle-orm';
import {
  DEFAULT_HOME_URL,
  IDLE_TIMEOUT_MINUTES_MAX,
  emptyProxy,
  emptyProxyExtra,
  isProxyType,
  normalizeChromeLanguage,
  normalizeProxyExtra,
  normalizeTimezone,
  type FingerprintConfig,
  type AccessGrant,
  type AccessKind,
  type ProxyConfig,
  type ProxyRecord,
  type ProxyTestResult,
  type SessionGroup,
} from '@nya/shared';
import { DATA_DIR } from './config.js';
import { db } from './db/client.js';
import {
  proxies as proxiesTable,
  accessGrants,
  sessionGroups,
  sessions as sessionsTable,
  users as usersTable,
} from './db/schema.js';
import { createFingerprint, normalizeFingerprint } from './runtime/fingerprint.js';

export { DEFAULT_HOME_URL };

export function sessionDir(id: string) {
  return path.join(DATA_DIR, 'sessions', id);
}

export function chromeProfileDir(id: string) {
  return path.join(sessionDir(id), 'chrome');
}

export function downloadsDir(id: string) {
  return path.join(sessionDir(id), 'downloads');
}

export function ensureSessionDirs(id: string) {
  fs.mkdirSync(chromeProfileDir(id), { recursive: true });
  fs.mkdirSync(downloadsDir(id), { recursive: true });
}

export function normalizeHomeUrl(input: unknown) {
  const raw = String(input ?? '').trim();
  if (!raw || raw === 'about:blank') return DEFAULT_HOME_URL;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error('Invalid start URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Start URL must be http or https');
  }
  return parsed.toString();
}

export function normalizeIdleTimeoutMinutes(input: unknown) {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(IDLE_TIMEOUT_MINUTES_MAX, Math.floor(n));
}

export function normalizeProxyConfig(input: Partial<ProxyConfig> | null | undefined): ProxyConfig {
  const type = input?.type || 'none';
  if (type !== 'none' && !isProxyType(type)) {
    throw new Error('Invalid proxy type');
  }
  const host = String(input?.host || '').trim();
  const portRaw = input?.port as number | string | null | undefined;
  const port =
    portRaw === null || portRaw === undefined || portRaw === ''
      ? null
      : Number(portRaw);
  if (type !== 'none') {
    if (!host) throw new Error('Proxy host is required');
    if (!Number.isInteger(port) || (port as number) < 1 || (port as number) > 65535) {
      throw new Error('Proxy port is invalid');
    }
  }
  return {
    type,
    host: type === 'none' ? '' : host,
    port: type === 'none' ? null : port,
    username: String(input?.username || ''),
    password: String(input?.password || ''),
    extra: normalizeProxyExtra(input?.extra),
    viaProxyId: normalizeViaId(input?.viaProxyId),
  };
}

export const PROXY_CHAIN_MAX = 8;

export function normalizeViaId(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

export function assertProxyChain(selfId: string | null, viaProxyId: string | null) {
  const via = normalizeViaId(viaProxyId);
  if (!via) return;
  if (selfId && via === selfId) throw new Error('A proxy cannot chain through itself');
  const seen = new Set<string>(selfId ? [selfId] : []);
  let cur: string | null = via;
  let depth = 0;
  while (cur) {
    if (seen.has(cur)) throw new Error('Proxy chain contains a cycle');
    if (depth >= PROXY_CHAIN_MAX) throw new Error('Proxy chain is too long');
    depth += 1;
    seen.add(cur);
    const hop = getProxy(cur);
    if (!hop) throw new Error('Front proxy not found');
    cur = hop.viaProxyId;
  }
}

function toSingboxInput(proxy: ProxyRecord | ProxyConfig) {
  if (!proxy.type || proxy.type === 'none') {
    throw new Error('Invalid proxy type');
  }
  return {
    type: proxy.type,
    host: proxy.host,
    port: proxy.port,
    username: proxy.username,
    password: proxy.password,
    extra: proxy.extra || emptyProxyExtra(),
  };
}

export function proxyChainInputs(proxy: ProxyRecord | ProxyConfig) {
  const selfId = 'id' in proxy ? proxy.id : null;
  assertProxyChain(selfId, proxy.viaProxyId);
  const via = [];
  let cur = normalizeViaId(proxy.viaProxyId);
  while (cur) {
    const hop = getProxy(cur);
    if (!hop) throw new Error('Front proxy not found');
    via.push(toSingboxInput(hop));
    cur = hop.viaProxyId;
  }
  return { proxy: toSingboxInput(proxy), via };
}

function parseExtra(raw: string | null | undefined) {
  if (!raw) return emptyProxyExtra();
  try {
    return normalizeProxyExtra(JSON.parse(raw));
  } catch {
    return emptyProxyExtra();
  }
}

function parseFingerprint(raw: string): FingerprintConfig {
  try {
    return normalizeFingerprint(JSON.parse(raw));
  } catch {
    return createFingerprint();
  }
}

function parseTest(raw: string | null): ProxyTestResult | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ProxyTestResult;
  } catch {
    return null;
  }
}

export function getProxy(id: string | null | undefined): ProxyRecord | null {
  if (!id) return null;
  const row = db.select().from(proxiesTable).where(eq(proxiesTable.id, id)).get();
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type as ProxyRecord['type'],
    host: row.host,
    port: row.port,
    username: row.username,
    password: row.password,
    extra: parseExtra(row.extra),
    viaProxyId: row.viaProxyId || null,
    createdAt: row.createdAt,
    lastTestAt: row.lastTestAt,
    lastTest: parseTest(row.lastTest),
  };
}

export function listProxies(): ProxyRecord[] {
  return db
    .select()
    .from(proxiesTable)
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type as ProxyRecord['type'],
      host: row.host,
      port: row.port,
      username: row.username,
      password: row.password,
      extra: parseExtra(row.extra),
      viaProxyId: row.viaProxyId || null,
      createdAt: row.createdAt,
      lastTestAt: row.lastTestAt,
      lastTest: parseTest(row.lastTest),
    }));
}

export function createProxyRecord(input: {
  name: string;
  type: ProxyRecord['type'];
  host: string;
  port: number;
  username?: string;
  password?: string;
  extra?: ProxyRecord['extra'];
  viaProxyId?: string | null;
}): ProxyRecord {
  const viaProxyId = normalizeViaId(input.viaProxyId);
  assertProxyChain(null, viaProxyId);
  const now = new Date().toISOString();
  const row = {
    id: nanoid(10),
    name: input.name.trim(),
    type: input.type,
    host: input.host.trim(),
    port: input.port,
    username: input.username || '',
    password: input.password || '',
    extra: JSON.stringify(normalizeProxyExtra(input.extra)),
    viaProxyId,
    createdAt: now,
    lastTestAt: null as string | null,
    lastTest: null as string | null,
  };
  db.insert(proxiesTable).values(row as typeof proxiesTable.$inferInsert).run();
  return getProxy(row.id)!;
}

export function updateProxyRecord(
  id: string,
  patch: Partial<{
    name: string;
    type: ProxyRecord['type'];
    host: string;
    port: number;
    username: string;
    password: string;
    extra: ProxyRecord['extra'];
    viaProxyId: string | null;
    lastTestAt: string | null;
    lastTest: ProxyTestResult | null;
  }>,
): ProxyRecord | null {
  const current = getProxy(id);
  if (!current) return null;
  const extra =
    patch.extra !== undefined
      ? normalizeProxyExtra({ ...current.extra, ...patch.extra })
      : current.extra;
  const viaProxyId =
    patch.viaProxyId !== undefined ? normalizeViaId(patch.viaProxyId) : current.viaProxyId;
  if (patch.viaProxyId !== undefined) assertProxyChain(id, viaProxyId);
  const next = {
    name: patch.name !== undefined ? patch.name.trim() : current.name,
    type: patch.type ?? current.type,
    host: patch.host !== undefined ? patch.host.trim() : current.host,
    port: patch.port ?? current.port,
    username: patch.username !== undefined ? patch.username : current.username,
    password: patch.password !== undefined ? patch.password : current.password,
    extra: JSON.stringify(extra),
    viaProxyId,
    lastTestAt: patch.lastTestAt !== undefined ? patch.lastTestAt : current.lastTestAt,
    lastTest: patch.lastTest !== undefined ? JSON.stringify(patch.lastTest) : JSON.stringify(current.lastTest),
  };
  db.update(proxiesTable).set(next).where(eq(proxiesTable.id, id)).run();
  return getProxy(id);
}

export function deleteProxyRecord(id: string) {
  const using = db.select({ id: sessionsTable.id }).from(sessionsTable).where(eq(sessionsTable.proxyId, id)).all();
  if (using.length) {
    throw new Error('Proxy is in use by sessions');
  }
  const chained = db
    .select({ id: proxiesTable.id })
    .from(proxiesTable)
    .where(eq(proxiesTable.viaProxyId, id))
    .all();
  if (chained.length) {
    throw new Error('Proxy is used as a front proxy');
  }
  const r = db.delete(proxiesTable).where(eq(proxiesTable.id, id)).run();
  return r.changes > 0;
}

export function proxyToConfig(proxy: ProxyRecord | null): ProxyConfig {
  if (!proxy) return emptyProxy();
  return {
    type: proxy.type,
    host: proxy.host,
    port: proxy.port,
    username: proxy.username,
    password: proxy.password,
    extra: proxy.extra || emptyProxyExtra(),
    viaProxyId: proxy.viaProxyId || null,
  };
}

export type SessionRecord = {
  id: string;
  name: string;
  description: string;
  groupId: string | null;
  proxyId: string | null;
  proxy: ProxyConfig;
  fingerprint: FingerprintConfig;
  timezone: string;
  chromeLanguage: string;
  homeUrl: string;
  idleTimeoutMinutes: number;
  createdAt: string;
  updatedAt: string;
};

function hydrateSession(row: typeof sessionsTable.$inferSelect): SessionRecord {
  const proxy = getProxy(row.proxyId);
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    groupId: row.groupId || null,
    proxyId: row.proxyId,
    proxy: proxyToConfig(proxy),
    fingerprint: parseFingerprint(row.fingerprint),
    timezone: normalizeTimezone(row.timezone),
    chromeLanguage: normalizeChromeLanguage(row.chromeLanguage),
    homeUrl: normalizeHomeUrl(row.homeUrl),
    idleTimeoutMinutes: normalizeIdleTimeoutMinutes(row.idleTimeoutMinutes),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listSessions(): SessionRecord[] {
  return db.select().from(sessionsTable).all().map(hydrateSession);
}

export function getSession(id: string): SessionRecord | null {
  const row = db.select().from(sessionsTable).where(eq(sessionsTable.id, id)).get();
  return row ? hydrateSession(row) : null;
}

export function createSession(input: {
  name?: string;
  description?: string;
  groupId?: string | null;
  proxyId?: string | null;
  timezone?: string;
  chromeLanguage?: string;
  homeUrl?: string;
  idleTimeoutMinutes?: number;
  fingerprint?: FingerprintConfig;
  id?: string;
}): SessionRecord {
  const all = listSessions();
  const now = new Date().toISOString();
  const id = input.id || nanoid(10);
  if (input.proxyId && !getProxy(input.proxyId)) throw new Error('Proxy not found');
  const groupId = input.groupId || null;
  if (groupId && !getGroup(groupId)) throw new Error('Group not found');
  const session: SessionRecord = {
    id,
    name: String(input.name || '').trim() || `Session ${all.length + 1}`,
    description: String(input.description || ''),
    groupId,
    proxyId: input.proxyId || null,
    proxy: proxyToConfig(getProxy(input.proxyId || null)),
    fingerprint: input.fingerprint ? normalizeFingerprint(input.fingerprint) : createFingerprint(),
    timezone: normalizeTimezone(input.timezone),
    chromeLanguage: normalizeChromeLanguage(input.chromeLanguage),
    homeUrl: normalizeHomeUrl(input.homeUrl),
    idleTimeoutMinutes: normalizeIdleTimeoutMinutes(input.idleTimeoutMinutes),
    createdAt: now,
    updatedAt: now,
  };
  ensureSessionDirs(session.id);
  db.insert(sessionsTable)
    .values({
      id: session.id,
      name: session.name,
      description: session.description,
      groupId: session.groupId,
      proxyId: session.proxyId,
      timezone: session.timezone,
      chromeLanguage: session.chromeLanguage,
      homeUrl: session.homeUrl,
      idleTimeoutMinutes: session.idleTimeoutMinutes,
      fingerprint: JSON.stringify(session.fingerprint),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    } as typeof sessionsTable.$inferInsert)
    .run();
  return session;
}

export function updateSession(
  id: string,
  patch: Partial<{
    name: string;
    description: string;
    groupId: string | null;
    proxyId: string | null;
    timezone: string;
    chromeLanguage: string;
    homeUrl: string;
    idleTimeoutMinutes: number;
    fingerprint: FingerprintConfig;
  }>,
): SessionRecord | null {
  const current = getSession(id);
  if (!current) return null;
  if (patch.proxyId !== undefined && patch.proxyId && !getProxy(patch.proxyId)) {
    throw new Error('Proxy not found');
  }
  if (patch.groupId !== undefined && patch.groupId && !getGroup(patch.groupId)) {
    throw new Error('Group not found');
  }
  const next = {
    name: patch.name !== undefined ? String(patch.name).trim() || current.name : current.name,
    description: patch.description !== undefined ? String(patch.description) : current.description,
    groupId: patch.groupId !== undefined ? patch.groupId : current.groupId,
    proxyId: patch.proxyId !== undefined ? patch.proxyId : current.proxyId,
    timezone:
      patch.timezone !== undefined ? normalizeTimezone(patch.timezone) : current.timezone,
    chromeLanguage:
      patch.chromeLanguage !== undefined
        ? normalizeChromeLanguage(patch.chromeLanguage)
        : current.chromeLanguage,
    homeUrl: patch.homeUrl !== undefined ? normalizeHomeUrl(patch.homeUrl) : current.homeUrl,
    idleTimeoutMinutes:
      patch.idleTimeoutMinutes !== undefined
        ? normalizeIdleTimeoutMinutes(patch.idleTimeoutMinutes)
        : current.idleTimeoutMinutes,
    fingerprint: JSON.stringify(
      patch.fingerprint !== undefined
        ? normalizeFingerprint(patch.fingerprint)
        : current.fingerprint,
    ),
    updatedAt: new Date().toISOString(),
  };
  db.update(sessionsTable).set(next).where(eq(sessionsTable.id, id)).run();
  return getSession(id);
}

export function ensureSessionFingerprint(id: string) {
  const current = getSession(id);
  if (!current) return null;
  const fp = normalizeFingerprint(current.fingerprint);
  if (
    current.fingerprint &&
    current.fingerprint.seed === fp.seed &&
    current.fingerprint.hardwareConcurrency === fp.hardwareConcurrency &&
    current.fingerprint.deviceMemory === fp.deviceMemory
  ) {
    return current.fingerprint;
  }
  return updateSession(id, { fingerprint: fp })?.fingerprint || fp;
}

export function regenerateSessionFingerprint(id: string) {
  if (!getSession(id)) return null;
  return updateSession(id, { fingerprint: createFingerprint() });
}

export function ensureSessionTimezone(id: string) {
  const current = getSession(id);
  if (!current) return null;
  const tz = normalizeTimezone(current.timezone);
  if (current.timezone === tz) return tz;
  return updateSession(id, { timezone: tz })?.timezone || tz;
}

export function deleteSession(id: string) {
  const current = getSession(id);
  if (!current) return false;
  db.delete(accessGrants)
    .where(and(eq(accessGrants.kind, 'session'), eq(accessGrants.targetId, id)))
    .run();
  db.delete(sessionsTable).where(eq(sessionsTable.id, id)).run();
  fs.rmSync(sessionDir(id), { recursive: true, force: true });
  return true;
}

export function deleteGrantsForUser(userId: string) {
  db.delete(accessGrants).where(eq(accessGrants.userId, userId)).run();
}

function userNameMap() {
  return new Map(db.select().from(usersTable).all().map((u) => [u.id, u.username]));
}

function groupPathLabel(id: string): string | undefined {
  const parts: string[] = [];
  let current: string | null = id;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const g = getGroup(current);
    if (!g) break;
    parts.unshift(g.name);
    current = g.parentId;
  }
  return parts.length ? parts.join(' / ') : undefined;
}

function hydrateGrant(
  row: typeof accessGrants.$inferSelect,
  names: Map<string, string>,
): AccessGrant | null {
  const kind = row.kind as AccessKind;
  if (kind !== 'session' && kind !== 'folder') return null;
  const targetName = kind === 'session' ? getSession(row.targetId)?.name : groupPathLabel(row.targetId);
  if (!targetName) return null;
  return {
    userId: row.userId,
    username: names.get(row.userId),
    kind,
    targetId: row.targetId,
    targetName,
  };
}

export function listAllGrants(): AccessGrant[] {
  const names = userNameMap();
  return db
    .select()
    .from(accessGrants)
    .all()
    .map((row) => hydrateGrant(row, names))
    .filter((g): g is AccessGrant => Boolean(g));
}

export function listUserGrants(userId: string): AccessGrant[] {
  const names = userNameMap();
  return db
    .select()
    .from(accessGrants)
    .where(eq(accessGrants.userId, userId))
    .all()
    .map((row) => hydrateGrant(row, names))
    .filter((g): g is AccessGrant => Boolean(g));
}

export function listSessionGrants(sessionId: string): AccessGrant[] {
  const names = userNameMap();
  return db
    .select()
    .from(accessGrants)
    .where(and(eq(accessGrants.kind, 'session'), eq(accessGrants.targetId, sessionId)))
    .all()
    .map((row) => hydrateGrant(row, names))
    .filter((g): g is AccessGrant => Boolean(g));
}

export function listFolderGrants(groupId: string): AccessGrant[] {
  const names = userNameMap();
  return db
    .select()
    .from(accessGrants)
    .where(and(eq(accessGrants.kind, 'folder'), eq(accessGrants.targetId, groupId)))
    .all()
    .map((row) => hydrateGrant(row, names))
    .filter((g): g is AccessGrant => Boolean(g));
}

function descendantGroupIds(groupId: string): Set<string> {
  const all = listGroups();
  const ids = new Set<string>([groupId]);
  const walk = (parent: string) => {
    for (const g of all) {
      if (g.parentId === parent) {
        ids.add(g.id);
        walk(g.id);
      }
    }
  };
  walk(groupId);
  return ids;
}

function groupAncestorIds(groupId: string | null): string[] {
  const ids: string[] = [];
  let current = groupId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    ids.push(current);
    current = getGroup(current)?.parentId || null;
  }
  return ids;
}

export function userCanAccessSession(userId: string, sessionOrId: SessionRecord | string): boolean {
  const session = typeof sessionOrId === 'string' ? getSession(sessionOrId) : sessionOrId;
  if (!session) return false;
  const direct = db
    .select()
    .from(accessGrants)
    .where(
      and(
        eq(accessGrants.userId, userId),
        eq(accessGrants.kind, 'session'),
        eq(accessGrants.targetId, session.id),
      ),
    )
    .get();
  if (direct) return true;
  if (!session.groupId) return false;
  const ancestors = new Set(groupAncestorIds(session.groupId));
  const folderRows = db
    .select()
    .from(accessGrants)
    .where(and(eq(accessGrants.userId, userId), eq(accessGrants.kind, 'folder')))
    .all();
  return folderRows.some((row) => ancestors.has(row.targetId));
}

export function listAccessibleSessions(userId: string): SessionRecord[] {
  const grants = db.select().from(accessGrants).where(eq(accessGrants.userId, userId)).all();
  const sessionIds = new Set<string>();
  const expandedFolders = new Set<string>();
  for (const row of grants) {
    if (row.kind === 'session') sessionIds.add(row.targetId);
    else if (row.kind === 'folder') {
      for (const id of descendantGroupIds(row.targetId)) expandedFolders.add(id);
    }
  }
  return listSessions().filter(
    (s) => sessionIds.has(s.id) || (s.groupId && expandedFolders.has(s.groupId)),
  );
}

export function listVisibleGroups(user: { id: string; role: string }): SessionGroup[] {
  if (user.role === 'admin') return listGroups();
  const ids = new Set<string>();
  for (const s of listAccessibleSessions(user.id)) {
    for (const id of groupAncestorIds(s.groupId)) ids.add(id);
  }
  for (const grant of listUserGrants(user.id)) {
    if (grant.kind !== 'folder') continue;
    for (const id of descendantGroupIds(grant.targetId)) ids.add(id);
    for (const id of groupAncestorIds(grant.targetId)) ids.add(id);
  }
  return listGroups().filter((g) => ids.has(g.id));
}

function uniqueIds(ids: string[]) {
  return [...new Set(ids.filter(Boolean))];
}

export function setUserGrants(userId: string, items: { kind: AccessKind; targetId: string }[]) {
  const user = db.select().from(usersTable).where(eq(usersTable.id, userId)).get();
  if (!user) throw new Error(`User not found: ${userId}`);
  const seen = new Set<string>();
  const next: { kind: AccessKind; targetId: string }[] = [];
  for (const item of items) {
    const key = `${item.kind}:${item.targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (item.kind === 'session') {
      if (!getSession(item.targetId)) throw new Error(`Session not found: ${item.targetId}`);
    } else if (item.kind === 'folder') {
      if (!getGroup(item.targetId)) throw new Error(`Folder not found: ${item.targetId}`);
    } else {
      throw new Error('Invalid grant kind');
    }
    next.push(item);
  }
  db.delete(accessGrants).where(eq(accessGrants.userId, userId)).run();
  for (const item of next) {
    db.insert(accessGrants)
      .values({ userId, kind: item.kind, targetId: item.targetId })
      .run();
  }
  return listUserGrants(userId);
}

export function setSessionGrants(sessionId: string, userIds: string[]) {
  if (!getSession(sessionId)) throw new Error(`Session not found: ${sessionId}`);
  const ids = uniqueIds(userIds);
  for (const id of ids) {
    const user = db.select().from(usersTable).where(eq(usersTable.id, id)).get();
    if (!user) throw new Error(`User not found: ${id}`);
  }
  db.delete(accessGrants)
    .where(and(eq(accessGrants.kind, 'session'), eq(accessGrants.targetId, sessionId)))
    .run();
  for (const id of ids) {
    db.insert(accessGrants)
      .values({ userId: id, kind: 'session', targetId: sessionId })
      .run();
  }
  return listSessionGrants(sessionId);
}

export function setFolderGrants(groupId: string, userIds: string[]) {
  if (!getGroup(groupId)) throw new Error(`Folder not found: ${groupId}`);
  const ids = uniqueIds(userIds);
  for (const id of ids) {
    const user = db.select().from(usersTable).where(eq(usersTable.id, id)).get();
    if (!user) throw new Error(`User not found: ${id}`);
  }
  db.delete(accessGrants)
    .where(and(eq(accessGrants.kind, 'folder'), eq(accessGrants.targetId, groupId)))
    .run();
  for (const id of ids) {
    db.insert(accessGrants)
      .values({ userId: id, kind: 'folder', targetId: groupId })
      .run();
  }
  return listFolderGrants(groupId);
}

const MAX_GROUP_DEPTH = 8;

function hydrateGroup(row: typeof sessionGroups.$inferSelect): SessionGroup {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId || null,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
  };
}

export function listGroups(): SessionGroup[] {
  return db
    .select()
    .from(sessionGroups)
    .orderBy(asc(sessionGroups.sortOrder), asc(sessionGroups.createdAt))
    .all()
    .map(hydrateGroup);
}

export function getGroup(id: string | null | undefined): SessionGroup | null {
  if (!id) return null;
  const row = db.select().from(sessionGroups).where(eq(sessionGroups.id, id)).get();
  return row ? hydrateGroup(row) : null;
}

function groupDepth(id: string | null): number {
  let depth = 0;
  let current = id;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) throw new Error('Group cycle detected');
    seen.add(current);
    depth += 1;
    current = getGroup(current)?.parentId || null;
  }
  return depth;
}

function assertAcyclic(id: string, parentId: string | null) {
  let current = parentId;
  const seen = new Set<string>([id]);
  while (current) {
    if (seen.has(current)) throw new Error('Cannot nest a folder under itself');
    seen.add(current);
    current = getGroup(current)?.parentId || null;
  }
}

export function createGroup(input: { name: string; parentId?: string | null }): SessionGroup {
  const parentId = input.parentId || null;
  if (parentId && !getGroup(parentId)) throw new Error('Parent folder not found');
  if (groupDepth(parentId) + 1 > MAX_GROUP_DEPTH) throw new Error('Folder is too deep');
  const siblings = listGroups().filter((g) => g.parentId === parentId);
  const now = new Date().toISOString();
  const row = {
    id: nanoid(10),
    name: input.name.trim(),
    parentId,
    sortOrder: siblings.reduce((m, g) => Math.max(m, g.sortOrder), 0) + 1,
    createdAt: now,
  };
  db.insert(sessionGroups).values(row as typeof sessionGroups.$inferInsert).run();
  return getGroup(row.id)!;
}

export function updateGroup(
  id: string,
  patch: Partial<{ name: string; parentId: string | null; sortOrder: number }>,
): SessionGroup | null {
  const current = getGroup(id);
  if (!current) return null;
  let parentId = patch.parentId !== undefined ? patch.parentId : current.parentId;
  if (parentId === '') parentId = null;
  if (parentId && !getGroup(parentId)) throw new Error('Parent folder not found');
  if (parentId === id) throw new Error('Cannot nest a folder under itself');
  assertAcyclic(id, parentId);
  if (groupDepth(parentId) + 1 > MAX_GROUP_DEPTH) throw new Error('Folder is too deep');
  db.update(sessionGroups)
    .set({
      name: patch.name !== undefined ? patch.name.trim() || current.name : current.name,
      parentId,
      sortOrder: patch.sortOrder !== undefined ? patch.sortOrder : current.sortOrder,
    } as Partial<typeof sessionGroups.$inferSelect>)
    .where(eq(sessionGroups.id, id))
    .run();
  return getGroup(id);
}

export function deleteGroup(id: string) {
  const current = getGroup(id);
  if (!current) return false;
  db.update(sessionsTable)
    .set({ groupId: null } as Partial<typeof sessionsTable.$inferSelect>)
    .where(eq(sessionsTable.groupId, id))
    .run();
  db.update(sessionGroups)
    .set({ parentId: current.parentId } as Partial<typeof sessionGroups.$inferSelect>)
    .where(eq(sessionGroups.parentId, id))
    .run();
  db.delete(accessGrants)
    .where(and(eq(accessGrants.kind, 'folder'), eq(accessGrants.targetId, id)))
    .run();
  db.delete(sessionGroups).where(eq(sessionGroups.id, id)).run();
  return true;
}
