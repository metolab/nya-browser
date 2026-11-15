import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import type { ApiKey } from '@nya/shared';
import { db } from '../../db/client.js';
import { apiKeys } from '../../db/schema.js';

export const API_KEY_PREFIX = 'nya_';
const TOUCH_INTERVAL_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const lastTouched = new Map<string, number>();

function hashKey(key: string) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

export function isApiKey(token: string | undefined): token is string {
  return Boolean(token && token.startsWith(API_KEY_PREFIX));
}

function present(row: typeof apiKeys.$inferSelect): ApiKey {
  return {
    id: row.id,
    name: row.name,
    prefix: `${API_KEY_PREFIX}${row.id}_`,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
  };
}

export function listApiKeys(userId: string): ApiKey[] {
  return db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .all()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(present);
}

export function createApiKey(userId: string, name: string, expiresInDays?: number | null) {
  const id = crypto.randomBytes(5).toString('hex');
  const key = `${API_KEY_PREFIX}${id}_${crypto.randomBytes(24).toString('base64url')}`;
  const row = {
    id,
    userId,
    name,
    keyHash: hashKey(key),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    expiresAt: expiresInDays ? Date.now() + expiresInDays * DAY_MS : null,
  };
  db.insert(apiKeys).values(row as typeof apiKeys.$inferInsert).run();
  return { apiKey: present(row), key };
}

export function deleteApiKey(userId: string, id: string) {
  const res = db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
    .run();
  lastTouched.delete(id);
  return res.changes > 0;
}

export function deleteUserApiKeys(userId: string) {
  db.delete(apiKeys).where(eq(apiKeys.userId, userId)).run();
}

/** Returns the owning user id and key id, or null when the key is unknown or expired. */
export function resolveApiKey(key: string): { userId: string; keyId: string } | null {
  const row = db.select().from(apiKeys).where(eq(apiKeys.keyHash, hashKey(key))).get();
  if (!row) return null;
  if (row.expiresAt && row.expiresAt <= Date.now()) return null;
  const now = Date.now();
  if (now - (lastTouched.get(row.id) || 0) > TOUCH_INTERVAL_MS) {
    lastTouched.set(row.id, now);
    db.update(apiKeys)
      .set({ lastUsedAt: new Date(now).toISOString() } as Partial<typeof apiKeys.$inferInsert>)
      .where(eq(apiKeys.id, row.id))
      .run();
  }
  return { userId: row.userId, keyId: row.id };
}
