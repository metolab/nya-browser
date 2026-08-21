import crypto from 'crypto';
import argon2 from 'argon2';
import { eq, lte } from 'drizzle-orm';
import { AUTH_COOKIE } from '@nya/shared';
import type { UserPublic } from '@nya/shared';
import { AUTH_TTL_MS } from '../../config.js';
import { db } from '../../db/client.js';
import { authTokens, users } from '../../db/schema.js';

export function toPublicUser(row: typeof users.$inferSelect): UserPublic {
  return {
    id: row.id,
    username: row.username,
    role: row.role as UserPublic['role'],
    disabled: Boolean(row.disabled),
    createdAt: row.createdAt,
  };
}

export function getUserById(id: string) {
  return db.select().from(users).where(eq(users.id, id)).get() || null;
}

export function getUserByUsername(username: string) {
  return db.select().from(users).where(eq(users.username, username)).get() || null;
}

export async function verifyUser(username: string, password: string) {
  const row = getUserByUsername(username);
  if (!row || row.disabled) return null;
  const ok = await argon2.verify(row.passwordHash, password);
  if (!ok) return null;
  return row;
}

export function issueToken(userId: string) {
  purgeExpired();
  const token = crypto.randomBytes(24).toString('hex');
  db.insert(authTokens)
    .values({
      token,
      userId,
      expiresAt: Date.now() + AUTH_TTL_MS,
    })
    .run();
  return token;
}

export function revokeToken(token: string | undefined) {
  if (!token) return;
  db.delete(authTokens).where(eq(authTokens.token, token)).run();
}

export function revokeUserTokens(userId: string) {
  db.delete(authTokens).where(eq(authTokens.userId, userId)).run();
}

function purgeExpired() {
  db.delete(authTokens).where(lte(authTokens.expiresAt, Date.now())).run();
}

export function resolveToken(token: string | undefined): UserPublic | null {
  if (!token) return null;
  const row = db.select().from(authTokens).where(eq(authTokens.token, token)).get();
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    db.delete(authTokens).where(eq(authTokens.token, token)).run();
    return null;
  }
  const user = getUserById(row.userId);
  if (!user || user.disabled) {
    db.delete(authTokens).where(eq(authTokens.token, token)).run();
    return null;
  }
  db.update(authTokens)
    .set({ expiresAt: Date.now() + AUTH_TTL_MS })
    .where(eq(authTokens.token, token))
    .run();
  return toPublicUser(user);
}

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    maxAge: AUTH_TTL_MS,
    path: '/',
  };
}

export { AUTH_COOKIE };
