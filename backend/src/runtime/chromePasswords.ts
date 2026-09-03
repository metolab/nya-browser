import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import type { SessionPassword } from '@nya/shared';

const OSCRYPT_SALT = Buffer.from('saltysalt');
const OSCRYPT_IV = Buffer.alloc(16, 0x20);
const OSCRYPT_KEY_LEN = 16;
const OSCRYPT_ITERATIONS = 1;
const OSCRYPT_PASSWORD = 'peanuts';
const LOGIN_DB_NAMES = ['Login Data', 'Login Data For Account'] as const;

export function passwordKey(origin: string, username: string) {
  return `${origin}\n${username}`;
}

export function overlayFilePath(homeDir: string) {
  return path.join(homeDir, 'passwords.json');
}

export function normalizeSessionPassword(input: Partial<SessionPassword> | null | undefined): SessionPassword | null {
  const origin = String(input?.origin || '').trim();
  if (!origin) return null;
  return {
    origin,
    username: String(input?.username || ''),
    password: String(input?.password || ''),
    note: String(input?.note || ''),
  };
}

export function normalizeSessionPasswords(input: unknown): SessionPassword[] {
  const rows = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray((input as { entries?: unknown }).entries)
      ? (input as { entries: unknown[] }).entries
      : [];
  const map = new Map<string, SessionPassword>();
  for (const row of rows) {
    const parsed = normalizeSessionPassword(row as Partial<SessionPassword>);
    if (!parsed) continue;
    map.set(passwordKey(parsed.origin, parsed.username), parsed);
  }
  return [...map.values()].sort(comparePasswords);
}

function comparePasswords(a: SessionPassword, b: SessionPassword) {
  const origin = a.origin.localeCompare(b.origin);
  return origin !== 0 ? origin : a.username.localeCompare(b.username);
}

export function deriveChromeOsCryptKey(password = OSCRYPT_PASSWORD) {
  return crypto.pbkdf2Sync(password, OSCRYPT_SALT, OSCRYPT_ITERATIONS, OSCRYPT_KEY_LEN, 'sha1');
}

export function encryptChromeSecret(plain: string, password = OSCRYPT_PASSWORD) {
  const cipher = crypto.createCipheriv('aes-128-cbc', deriveChromeOsCryptKey(password), OSCRYPT_IV);
  return Buffer.concat([Buffer.from('v10'), cipher.update(plain, 'utf8'), cipher.final()]);
}

export function decryptChromeSecret(blob: Buffer | Uint8Array | null | undefined, password = OSCRYPT_PASSWORD) {
  if (!blob || blob.length === 0) return '';
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  const prefix = buf.subarray(0, 3).toString('utf8');
  if (prefix !== 'v10' && prefix !== 'v11') {
    const text = buf.toString('utf8');
    return /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) ? '' : text;
  }
  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', deriveChromeOsCryptKey(password), OSCRYPT_IV);
    const out = Buffer.concat([decipher.update(buf.subarray(3)), decipher.final()]);
    return out.toString('utf8');
  } catch {
    return '';
  }
}

export function mergePasswordLists(chrome: SessionPassword[], overlay: SessionPassword[]): SessionPassword[] {
  const map = new Map<string, SessionPassword>();
  for (const entry of overlay) {
    const parsed = normalizeSessionPassword(entry);
    if (parsed) map.set(passwordKey(parsed.origin, parsed.username), parsed);
  }
  for (const entry of chrome) {
    const parsed = normalizeSessionPassword(entry);
    if (!parsed) continue;
    const key = passwordKey(parsed.origin, parsed.username);
    const prev = map.get(key);
    map.set(key, {
      origin: parsed.origin,
      username: parsed.username,
      password: parsed.password || prev?.password || '',
      note: prev?.note?.trim() ? prev.note : parsed.note || '',
    });
  }
  return [...map.values()].sort(comparePasswords);
}

export function readPasswordOverlayFile(file: string): SessionPassword[] {
  if (!fs.existsSync(file)) return [];
  try {
    return normalizeSessionPasswords(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return [];
  }
}

export function writePasswordOverlayFile(file: string, entries: SessionPassword[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const normalized = normalizeSessionPasswords(entries);
  fs.writeFileSync(file, `${JSON.stringify({ version: 1, entries: normalized }, null, 2)}\n`);
  return normalized;
}

function copyLoginDb(defaultDir: string, basename: string, destDir: string) {
  const src = path.join(defaultDir, basename);
  if (!fs.existsSync(src)) return null;
  fs.copyFileSync(src, path.join(destDir, basename));
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const extra = path.join(defaultDir, `${basename}${suffix}`);
    if (fs.existsSync(extra)) fs.copyFileSync(extra, path.join(destDir, path.basename(extra)));
  }
  return path.join(destDir, basename);
}

function tableExists(db: Database.Database, name: string) {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name) as
    | { name?: string }
    | undefined;
  return Boolean(row?.name);
}

function columnNames(db: Database.Database, table: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((row) => row.name));
}

function readNotesByParent(db: Database.Database) {
  const notes = new Map<number, string>();
  if (!tableExists(db, 'password_notes')) return notes;
  const rows = db.prepare(`SELECT parent_id, value FROM password_notes`).all() as {
    parent_id: number;
    value?: Buffer | Uint8Array | null;
  }[];
  for (const row of rows) {
    const note = decryptChromeSecret(row.value);
    if (!note.trim()) continue;
    const prev = notes.get(row.parent_id) || '';
    notes.set(row.parent_id, prev ? `${prev}\n${note}` : note);
  }
  return notes;
}

export function readLoginDatabase(dbPath: string): SessionPassword[] {
  if (!fs.existsSync(dbPath)) return [];
  const db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 2000 });
  try {
    if (!tableExists(db, 'logins')) return [];
    const cols = columnNames(db, 'logins');
    const fields = ['origin_url', 'username_value', 'password_value'];
    if (cols.has('id')) fields.push('id');
    if (cols.has('blacklisted_by_user')) fields.push('blacklisted_by_user');
    const rows = db.prepare(`SELECT ${fields.join(', ')} FROM logins`).all() as Record<string, unknown>[];
    const notes = readNotesByParent(db);
    const out: SessionPassword[] = [];
    for (const row of rows) {
      if (Number(row.blacklisted_by_user || 0) === 1) continue;
      const origin = String(row.origin_url || '').trim();
      if (!origin) continue;
      const id = Number(row.id || 0);
      out.push({
        origin,
        username: String(row.username_value || ''),
        password: decryptChromeSecret(row.password_value as Buffer | Uint8Array | null),
        note: notes.get(id) || '',
      });
    }
    return normalizeSessionPasswords(out);
  } finally {
    db.close();
  }
}

export function readChromeProfilePasswords(profileDir: string): SessionPassword[] {
  const defaultDir = path.join(profileDir, 'Default');
  if (!fs.existsSync(defaultDir)) return [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nya-logins-'));
  try {
    const collected: SessionPassword[] = [];
    for (const name of LOGIN_DB_NAMES) {
      const copied = copyLoginDb(defaultDir, name, tmp);
      if (!copied) continue;
      collected.push(...readLoginDatabase(copied));
    }
    return normalizeSessionPasswords(collected);
  } catch {
    return [];
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export function listProfilePasswords(profileDir: string, overlayFile: string): SessionPassword[] {
  const chrome = readChromeProfilePasswords(profileDir);
  const overlay = readPasswordOverlayFile(overlayFile);
  const merged = mergePasswordLists(chrome, overlay);
  if (chrome.length) writePasswordOverlayFile(overlayFile, merged);
  return merged;
}
