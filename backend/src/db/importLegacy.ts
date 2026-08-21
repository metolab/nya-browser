import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import { DATA_DIR } from '../config.js';
import { db } from './client.js';
import { proxies, sessions } from './schema.js';
import { normalizeFingerprint } from '../runtime/fingerprint.js';
import { DEFAULT_HOME_URL, normalizeTimezone } from '@nya/shared';
import { logger } from '../logger.js';

type LegacyProxy = {
  type?: string;
  host?: string;
  port?: number | null;
  username?: string;
  password?: string;
};

type LegacySession = {
  id?: string;
  name?: string;
  description?: string;
  proxy?: LegacyProxy;
  fingerprint?: { seed?: string; hardwareConcurrency?: number; deviceMemory?: number };
  timezone?: string;
  homeUrl?: string;
  createdAt?: string;
  updatedAt?: string;
};

function proxyKey(p: LegacyProxy) {
  return `${p.type}|${p.host}|${p.port}|${p.username || ''}|${p.password || ''}`;
}

export function migrateJsonSessions() {
  const storePath = path.join(DATA_DIR, 'sessions.json');
  const marker = path.join(DATA_DIR, '.migrated-sessions');
  if (!fs.existsSync(storePath) || fs.existsSync(marker)) return;
  const existing = db.select({ id: sessions.id }).from(sessions).all();
  if (existing.length > 0) {
    fs.writeFileSync(marker, new Date().toISOString());
    return;
  }
  let raw: { sessions?: LegacySession[] };
  try {
    raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  } catch (err) {
    logger.warn({ err }, 'failed to parse sessions.json');
    return;
  }
  const list = Array.isArray(raw.sessions) ? raw.sessions : [];
  const proxyMap = new Map<string, string>();
  const now = new Date().toISOString();

  for (const s of list) {
    if (!s?.id) continue;
    let proxyId: string | null = null;
    const p = s.proxy;
    if (p && p.type && p.type !== 'none' && p.host && p.port) {
      const key = proxyKey(p);
      if (proxyMap.has(key)) {
        proxyId = proxyMap.get(key)!;
      } else {
        proxyId = nanoid(10);
        const type = p.type === 'socks5' ? 'socks5' : p.type === 'https' ? 'https' : 'http';
        db.insert(proxies)
          .values({
            id: proxyId,
            name: `${s.name || s.id} proxy`,
            type,
            host: String(p.host),
            port: Number(p.port),
            username: String(p.username || ''),
            password: String(p.password || ''),
            createdAt: now,
            lastTestAt: null,
            lastTest: null,
          } as typeof proxies.$inferInsert)
          .run();
        proxyMap.set(key, proxyId);
      }
    }
    let homeUrl = DEFAULT_HOME_URL;
    try {
      const raw = String(s.homeUrl || '').trim();
      if (raw && raw !== 'about:blank') {
        const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`;
        homeUrl = new URL(withScheme).toString();
      }
    } catch {
      homeUrl = DEFAULT_HOME_URL;
    }
    let timezone = 'Asia/Shanghai';
    try {
      timezone = normalizeTimezone(s.timezone);
    } catch {
      timezone = 'Asia/Shanghai';
    }
    db.insert(sessions)
      .values({
        id: s.id,
        name: String(s.name || s.id),
        description: String(s.description || ''),
        proxyId,
        timezone,
        homeUrl,
        fingerprint: JSON.stringify(normalizeFingerprint(s.fingerprint)),
        createdAt: s.createdAt || now,
        updatedAt: s.updatedAt || now,
      } as typeof sessions.$inferInsert)
      .run();
  }
  fs.writeFileSync(marker, now);
  logger.info({ count: list.length }, 'migrated sessions.json');
}
