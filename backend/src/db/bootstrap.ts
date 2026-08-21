import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { INIT_ADMIN_PASSWORD, INIT_ADMIN_USER } from '../config.js';
import { db, sqlite } from './client.js';
import { users } from './schema.js';
import { logger } from '../logger.js';
import { migrateJsonSessions } from './importLegacy.js';

export async function bootstrap() {
  const row = sqlite.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number };
  if (row.n === 0) {
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
