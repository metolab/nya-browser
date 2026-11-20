import crypto from 'crypto';
import { EventEmitter } from 'events';
import { and, asc, desc, eq, gt, inArray, ne } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Passkey, PasskeyEvent, PasskeyEventKind, PasskeyStatus } from '@nya/shared';
import { db, sqlite } from '../../db/client.js';
import { passkeyEvents, sessionPasskeys } from '../../db/schema.js';
import { logger } from '../../logger.js';

const EVENTS_KEPT_PER_SESSION = 1000;

/** CDP `WebAuthn.Credential`; binary fields are standard base64. */
export type CdpCredential = {
  credentialId: string;
  isResidentCredential: boolean;
  rpId?: string;
  privateKey: string;
  userHandle?: string;
  signCount: number;
  largeBlob?: string;
  backupEligibility?: boolean;
  backupState?: boolean;
  userName?: string;
  userDisplayName?: string;
};

export type PasskeyInput = {
  rpId: string;
  credentialId: string;
  privateKey: string;
  isResidentCredential?: boolean;
  userHandle?: string | null;
  userName?: string;
  userDisplayName?: string;
  signCount?: number;
  backupEligibility?: boolean | null;
  backupState?: boolean | null;
  largeBlob?: string | null;
  label?: string;
  origin?: string;
  status?: PasskeyStatus;
  createdAt?: string;
  lastUsedAt?: string | null;
};

type Row = typeof sessionPasskeys.$inferSelect;

const events = new EventEmitter();
events.setMaxListeners(0);

/** Re-encode base64 or base64url as padded standard base64, the form CDP uses. */
export function stdBase64(value: string) {
  return Buffer.from(value, 'base64').toString('base64');
}

export function assertPkcs8(privateKey: string) {
  try {
    crypto.createPrivateKey({ key: Buffer.from(privateKey, 'base64'), format: 'der', type: 'pkcs8' });
  } catch {
    throw new Error('privateKey must be a base64 PKCS#8 DER key');
  }
}

function toBool(value: number | null) {
  return value == null ? null : value !== 0;
}

function fromBool(value: boolean | null | undefined) {
  return value == null ? null : value ? 1 : 0;
}

function hydrate(row: Row): Passkey {
  return {
    id: row.id,
    sessionId: row.sessionId,
    rpId: row.rpId,
    credentialId: row.credentialId,
    isResidentCredential: row.isResident !== 0,
    userHandle: row.userHandle,
    userName: row.userName,
    userDisplayName: row.userDisplayName,
    privateKey: row.privateKey,
    signCount: row.signCount,
    backupEligibility: toBool(row.backupEligibility),
    backupState: toBool(row.backupState),
    largeBlob: row.largeBlob,
    status: row.status as PasskeyStatus,
    label: row.label,
    origin: row.origin,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export function listPasskeys(sessionId: string, filter: { rpId?: string; status?: PasskeyStatus[] } = {}) {
  const where = [eq(sessionPasskeys.sessionId, sessionId)];
  if (filter.rpId) where.push(eq(sessionPasskeys.rpId, filter.rpId));
  if (filter.status?.length) where.push(inArray(sessionPasskeys.status, filter.status));
  return db
    .select()
    .from(sessionPasskeys)
    .where(and(...where))
    .orderBy(asc(sessionPasskeys.createdAt))
    .all()
    .map(hydrate);
}

export function activePasskeys(sessionId: string) {
  return listPasskeys(sessionId, { status: ['active'] });
}

export function countPasskeys(sessionId: string): number {
  const row = sqlite
    .prepare<[string], { count: number }>('SELECT COUNT(*) AS count FROM session_passkeys WHERE session_id = ?')
    .get(sessionId);
  return row?.count ?? 0;
}

export function countPasskeysBySession(): Map<string, number> {
  const rows = sqlite
    .prepare<[], { session_id: string; count: number }>(
      'SELECT session_id, COUNT(*) AS count FROM session_passkeys GROUP BY session_id',
    )
    .all();
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.session_id, row.count);
  return counts;
}

export function getPasskey(sessionId: string, id: string) {
  const row = db
    .select()
    .from(sessionPasskeys)
    .where(and(eq(sessionPasskeys.sessionId, sessionId), eq(sessionPasskeys.id, id)))
    .get();
  return row ? hydrate(row) : null;
}

export function findPasskeyByCredential(sessionId: string, credentialId: string) {
  const row = db
    .select()
    .from(sessionPasskeys)
    .where(and(eq(sessionPasskeys.sessionId, sessionId), eq(sessionPasskeys.credentialId, stdBase64(credentialId))))
    .get();
  return row ? hydrate(row) : null;
}

/** Insert or overwrite by credential id. */
export function upsertPasskey(sessionId: string, input: PasskeyInput): { passkey: Passkey; created: boolean } {
  const now = new Date().toISOString();
  const credentialId = stdBase64(input.credentialId);
  const privateKey = stdBase64(input.privateKey);
  assertPkcs8(privateKey);
  const userHandle = input.userHandle ? stdBase64(input.userHandle) : null;
  const existing = findPasskeyByCredential(sessionId, credentialId);
  const fields = {
    rpId: input.rpId,
    isResident: (input.isResidentCredential ?? existing?.isResidentCredential ?? Boolean(userHandle)) ? 1 : 0,
    userHandle: userHandle ?? existing?.userHandle ?? null,
    userName: input.userName ?? existing?.userName ?? '',
    userDisplayName: input.userDisplayName ?? existing?.userDisplayName ?? '',
    privateKey,
    signCount: input.signCount ?? existing?.signCount ?? 0,
    backupEligibility: fromBool(input.backupEligibility ?? existing?.backupEligibility),
    backupState: fromBool(input.backupState ?? existing?.backupState),
    largeBlob: input.largeBlob !== undefined ? input.largeBlob : (existing?.largeBlob ?? null),
    status: input.status ?? 'active',
    label: input.label ?? existing?.label ?? '',
    origin: input.origin || existing?.origin || '',
    updatedAt: now,
    lastUsedAt: input.lastUsedAt !== undefined ? input.lastUsedAt : (existing?.lastUsedAt ?? null),
  };
  if (existing) {
    db.update(sessionPasskeys).set(fields).where(eq(sessionPasskeys.id, existing.id)).run();
    return { passkey: getPasskey(sessionId, existing.id)!, created: false };
  }
  const id = nanoid(12);
  db.insert(sessionPasskeys)
    .values({ id, sessionId, credentialId, createdAt: input.createdAt || now, ...fields })
    .run();
  return { passkey: getPasskey(sessionId, id)!, created: true };
}

export function passkeyFromCdp(cred: CdpCredential, origin: string): PasskeyInput {
  return {
    rpId: cred.rpId || '',
    credentialId: cred.credentialId,
    privateKey: cred.privateKey,
    isResidentCredential: cred.isResidentCredential,
    userHandle: cred.userHandle || null,
    userName: cred.userName,
    userDisplayName: cred.userDisplayName,
    signCount: cred.signCount,
    backupEligibility: cred.backupEligibility,
    backupState: cred.backupState,
    largeBlob: cred.largeBlob ?? null,
    origin,
  };
}

export function passkeyToCdp(passkey: Passkey): CdpCredential {
  const resident = passkey.isResidentCredential && Boolean(passkey.userHandle);
  const cred: CdpCredential = {
    credentialId: passkey.credentialId,
    isResidentCredential: resident,
    rpId: passkey.rpId,
    privateKey: passkey.privateKey,
    signCount: passkey.signCount,
  };
  if (passkey.userHandle) cred.userHandle = passkey.userHandle;
  if (passkey.userName) cred.userName = passkey.userName;
  if (passkey.userDisplayName) cred.userDisplayName = passkey.userDisplayName;
  if (resident && passkey.largeBlob) cred.largeBlob = passkey.largeBlob;
  if (passkey.backupEligibility != null) cred.backupEligibility = passkey.backupEligibility;
  if (passkey.backupState != null) cred.backupState = passkey.backupState;
  return cred;
}

export function updatePasskey(
  sessionId: string,
  id: string,
  patch: Partial<
    Pick<Passkey, 'label' | 'signCount' | 'status' | 'userName' | 'userDisplayName' | 'lastUsedAt' | 'largeBlob'>
  >,
) {
  const current = getPasskey(sessionId, id);
  if (!current) return null;
  const set: Partial<Row> = { updatedAt: new Date().toISOString() };
  if (patch.label !== undefined) set.label = patch.label;
  if (patch.signCount !== undefined) set.signCount = patch.signCount;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.userName !== undefined) set.userName = patch.userName;
  if (patch.userDisplayName !== undefined) set.userDisplayName = patch.userDisplayName;
  if (patch.lastUsedAt !== undefined) set.lastUsedAt = patch.lastUsedAt;
  if (patch.largeBlob !== undefined) set.largeBlob = patch.largeBlob;
  db.update(sessionPasskeys).set(set).where(eq(sessionPasskeys.id, id)).run();
  return getPasskey(sessionId, id);
}

/** Other credentials of the same resident user a new registration overwrites in the authenticator. */
export function replaceSiblings(sessionId: string, passkey: Passkey) {
  if (!passkey.isResidentCredential || !passkey.userHandle) return [];
  const rows = db
    .select()
    .from(sessionPasskeys)
    .where(
      and(
        eq(sessionPasskeys.sessionId, sessionId),
        eq(sessionPasskeys.rpId, passkey.rpId),
        eq(sessionPasskeys.userHandle, passkey.userHandle),
        eq(sessionPasskeys.isResident, 1),
        ne(sessionPasskeys.id, passkey.id),
        ne(sessionPasskeys.status, 'replaced'),
      ),
    )
    .all();
  if (!rows.length) return [];
  db.update(sessionPasskeys)
    .set({ status: 'replaced', updatedAt: new Date().toISOString() })
    .where(inArray(sessionPasskeys.id, rows.map((r) => r.id)))
    .run();
  return rows.map((r) => hydrate({ ...r, status: 'replaced' }));
}

export function deletePasskey(sessionId: string, id: string) {
  const current = getPasskey(sessionId, id);
  if (!current) return null;
  db.delete(sessionPasskeys).where(eq(sessionPasskeys.id, id)).run();
  return current;
}

export function restorePasskeys(sessionId: string, list: Passkey[]) {
  let restored = 0;
  for (const p of list) {
    try {
      upsertPasskey(sessionId, { ...p, status: p.status || 'active' });
      restored += 1;
    } catch (err) {
      logger.warn({ err, sessionId, rpId: p.rpId }, 'passkey restore skipped');
    }
  }
  return restored;
}

function hydrateEvent(row: typeof passkeyEvents.$inferSelect): PasskeyEvent {
  return {
    seq: row.seq,
    sessionId: row.sessionId,
    at: row.at,
    kind: row.kind as PasskeyEventKind,
    passkeyId: row.passkeyId,
    rpId: row.rpId,
    credentialId: row.credentialId,
    signCount: row.signCount,
    url: row.url,
    actor: row.actor,
  };
}

let pruneStmt: import('better-sqlite3').Statement<[string, string, number]> | null = null;

function pruneEvents(sessionId: string) {
  pruneStmt ??= sqlite.prepare<[string, string, number]>(
    `DELETE FROM passkey_events WHERE session_id = ? AND seq <= (
       SELECT seq FROM passkey_events WHERE session_id = ? ORDER BY seq DESC LIMIT 1 OFFSET ?
     )`,
  );
  pruneStmt.run(sessionId, sessionId, EVENTS_KEPT_PER_SESSION);
}

export function appendPasskeyEvent(input: {
  sessionId: string;
  kind: PasskeyEventKind;
  passkey?: Passkey | null;
  rpId?: string;
  credentialId?: string;
  signCount?: number | null;
  url?: string;
  actor: string;
}): PasskeyEvent {
  const row = db
    .insert(passkeyEvents)
    .values({
      sessionId: input.sessionId,
      at: new Date().toISOString(),
      kind: input.kind,
      passkeyId: input.passkey?.id ?? null,
      rpId: input.passkey?.rpId ?? input.rpId ?? '',
      credentialId: input.passkey?.credentialId ?? input.credentialId ?? '',
      signCount: input.signCount !== undefined ? input.signCount : (input.passkey?.signCount ?? null),
      url: input.url || '',
      actor: input.actor,
    })
    .returning()
    .get();
  pruneEvents(input.sessionId);
  const event = hydrateEvent(row);
  logger.info(
    { sessionId: event.sessionId, kind: event.kind, rpId: event.rpId, credentialId: event.credentialId.slice(0, 8), signCount: event.signCount, url: event.url, actor: event.actor },
    'passkey.event',
  );
  events.emit('event', event);
  return event;
}

export function listPasskeyEvents(sessionId: string, after = 0, limit = 200) {
  return db
    .select()
    .from(passkeyEvents)
    .where(and(eq(passkeyEvents.sessionId, sessionId), gt(passkeyEvents.seq, after)))
    .orderBy(asc(passkeyEvents.seq))
    .limit(limit)
    .all()
    .map(hydrateEvent);
}

export function latestPasskeyEventSeq(sessionId: string) {
  const row = db
    .select({ seq: passkeyEvents.seq })
    .from(passkeyEvents)
    .where(eq(passkeyEvents.sessionId, sessionId))
    .orderBy(desc(passkeyEvents.seq))
    .limit(1)
    .get();
  return row?.seq ?? 0;
}

type EventMatch = { kinds?: PasskeyEventKind[]; rpId?: string; after: number };

function matches(event: PasskeyEvent, sessionId: string, m: EventMatch) {
  return (
    event.sessionId === sessionId &&
    event.seq > m.after &&
    (!m.kinds?.length || m.kinds.includes(event.kind)) &&
    (!m.rpId || event.rpId === m.rpId)
  );
}

/** First matching event after `after`, including ones already stored; null on timeout or abort. */
export function waitPasskeyEvent(sessionId: string, m: EventMatch, timeoutMs: number, signal?: AbortSignal) {
  return new Promise<PasskeyEvent | null>((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (event: PasskeyEvent | null) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      events.off('event', onEvent);
      signal?.removeEventListener('abort', onAbort);
      resolve(event);
    };
    const onEvent = (event: PasskeyEvent) => {
      if (matches(event, sessionId, m)) finish(event);
    };
    const onAbort = () => finish(null);
    events.on('event', onEvent);
    signal?.addEventListener('abort', onAbort);
    let cursor = m.after;
    for (;;) {
      const page = listPasskeyEvents(sessionId, cursor, 500);
      const hit = page.find((e) => matches(e, sessionId, m));
      if (hit) return finish(hit);
      if (page.length < 500) break;
      cursor = page[page.length - 1].seq;
    }
    timer = setTimeout(() => finish(null), timeoutMs);
  });
}
