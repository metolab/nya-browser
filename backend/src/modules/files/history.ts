import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import type { SessionDownload, SessionDownloadState } from '@nya/shared';
import { chromeProfileDir } from '../../store.js';

const CHROME_EPOCH_OFFSET_MS = 11644473600000;
const STATE_MAP: Record<number, SessionDownloadState> = {
  0: 'in_progress',
  1: 'completed',
  2: 'cancelled',
  3: 'failed',
  4: 'in_progress',
};

export function chromeTimeToIso(value: number) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return new Date(0).toISOString();
  const ms = n > 1e15 ? n / 1000 - CHROME_EPOCH_OFFSET_MS : n > 1e12 ? n / 1000 : n;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function copyHistoryDb(src: string, sessionId: string) {
  const dest = path.join(os.tmpdir(), `nya-hist-${process.pid}-${sessionId}.db`);
  fs.copyFileSync(src, dest);
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const extra = `${src}${suffix}`;
    if (fs.existsSync(extra)) fs.copyFileSync(extra, `${dest}${suffix}`);
  }
  return dest;
}

function cleanupCopy(dest: string) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      fs.rmSync(`${dest}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
}

function tableExists(db: Database.Database, name: string) {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name) as
    | { name?: string }
    | undefined;
  return Boolean(row?.name);
}

function relativeToRoot(absPath: string, root: string) {
  const full = path.resolve(absPath);
  const base = path.resolve(root);
  if (full === base) return '.';
  if (!full.startsWith(`${base}${path.sep}`)) return path.basename(full);
  return full.slice(base.length + 1).replace(/\\/g, '/');
}

const historyCache = new Map<string, { at: number; rows: SessionDownload[] }>();

export function readChromeDownloads(sessionId: string, root: string): SessionDownload[] {
  const cached = historyCache.get(sessionId);
  if (cached && Date.now() - cached.at < 1500) return cached.rows;
  const src = path.join(chromeProfileDir(sessionId), 'Default', 'History');
  if (!fs.existsSync(src)) return [];
  let dest = '';
  try {
    dest = copyHistoryDb(src, sessionId);
    const db = new Database(dest, { readonly: true, fileMustExist: true, timeout: 1500 });
    try {
      if (!tableExists(db, 'downloads')) return [];
      const rows = db
        .prepare(
          `SELECT d.id, d.guid, d.current_path, d.target_path, d.start_time, d.received_bytes,
                  d.total_bytes, d.state, d.end_time, d.tab_url, d.referrer, d.site_url
           FROM downloads d
           ORDER BY d.start_time DESC
           LIMIT 80`,
        )
        .all() as Array<{
        id: number;
        guid?: string;
        current_path?: string;
        target_path?: string;
        start_time?: number;
        received_bytes?: number;
        total_bytes?: number;
        state?: number;
        end_time?: number;
        tab_url?: string;
        referrer?: string;
        site_url?: string;
      }>;
      const urls = new Map<number, string>();
      if (tableExists(db, 'downloads_url_chains')) {
        const chains = db
          .prepare(`SELECT id, chain_index, url FROM downloads_url_chains ORDER BY id, chain_index`)
          .all() as Array<{ id: number; chain_index: number; url?: string }>;
        for (const row of chains) {
          if (!urls.has(row.id) && row.url) urls.set(row.id, row.url);
        }
      }
      const mapped = rows.map((row) => {
        const abs = String(row.target_path || row.current_path || '');
        const name = path.basename(abs) || `download-${row.id}`;
        const rel = abs ? relativeToRoot(abs, root) : name;
        const startedAt = chromeTimeToIso(Number(row.start_time || 0));
        const updatedAt = row.end_time ? chromeTimeToIso(Number(row.end_time)) : startedAt;
        return {
          id: String(row.guid || row.id),
          name,
          path: rel,
          url: urls.get(row.id) || row.tab_url || row.referrer || row.site_url || '',
          state: STATE_MAP[Number(row.state)] || 'completed',
          receivedBytes: Number(row.received_bytes || 0),
          totalBytes: Number(row.total_bytes || 0),
          startedAt,
          updatedAt,
        };
      });
      historyCache.set(sessionId, { at: Date.now(), rows: mapped });
      return mapped;
    } finally {
      db.close();
    }
  } catch {
    return cached?.rows || [];
  } finally {
    if (dest) cleanupCopy(dest);
  }
}
