import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { INIT_ADMIN_PASSWORD, INIT_ADMIN_USER } from '../config.js';
import { db, sqlite } from './client.js';
import { users } from './schema.js';
import { logger } from '../logger.js';
import { migrateJsonSessions } from './importLegacy.js';

/** Values from env.example and the dev fallback; never the first admin's password. */
const PLACEHOLDER_PASSWORDS = new Set(['change-me', 'nya']);

export async function bootstrap() {
  const row = sqlite.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number };
  if (row.n === 0) {
    if (PLACEHOLDER_PASSWORDS.has(INIT_ADMIN_PASSWORD)) {
      throw new Error('INIT_ADMIN_PASSWORD is still a placeholder; set a real password before the first start');
    }
    const now = new Date().toISOString();
    const passwordHash = await argon2.hash(INIT_ADMIN_PASSWORD);
    db.insert(users)
      .values({
        id: nanoid(12),
        username: INIT_ADMIN_USER,
        passwordHash,
        role: 'admin',
        disabled: 0,
        createdAt: now,
      })
      .run();
    logger.info({ username: INIT_ADMIN_USER }, 'created initial admin user');
  }
  migrateJsonSessions();
}
