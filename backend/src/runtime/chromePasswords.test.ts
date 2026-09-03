import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decryptChromeSecret,
  encryptChromeSecret,
  listProfilePasswords,
  mergePasswordLists,
  readChromeProfilePasswords,
  readLoginDatabase,
} from './chromePasswords.js';

const tmpDirs: string[] = [];

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nya-pw-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs.length = 0;
});

describe('chrome OSCrypt', () => {
  it('roundtrips secrets with the Linux basic store key', () => {
    const blob = encryptChromeSecret('p@ss wörd');
    expect(blob.subarray(0, 3).toString()).toBe('v10');
    expect(decryptChromeSecret(blob)).toBe('p@ss wörd');
  });

  it('returns empty string for truncated ciphertext', () => {
    expect(decryptChromeSecret(Buffer.from('v10'))).toBe('');
  });
});

describe('password merge', () => {
  it('keeps overlay notes and fills passwords from Chrome', () => {
    const merged = mergePasswordLists(
      [{ origin: 'https://a.example/', username: 'u', password: 'secret', note: 'chrome note' }],
      [{ origin: 'https://a.example/', username: 'u', password: '', note: 'admin note' }],
    );
    expect(merged).toEqual([
      { origin: 'https://a.example/', username: 'u', password: 'secret', note: 'admin note' },
    ]);
  });

  it('keeps overlay-only entries', () => {
    const merged = mergePasswordLists(
      [],
      [{ origin: 'https://b.example/', username: 'bob', password: 'x', note: 'manual' }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].note).toBe('manual');
  });
});

describe('Login Data reader', () => {
  it('decrypts logins and password notes', () => {
    const dbPath = path.join(tmpDir(), 'Login Data');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE logins (
        origin_url VARCHAR NOT NULL,
        username_value VARCHAR,
        password_value BLOB,
        blacklisted_by_user INTEGER NOT NULL DEFAULT 0,
        id INTEGER PRIMARY KEY AUTOINCREMENT
      );
      CREATE TABLE password_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id INTEGER NOT NULL,
        key VARCHAR NOT NULL,
        value BLOB
      );
    `);
    db.prepare(
      `INSERT INTO logins (origin_url, username_value, password_value, blacklisted_by_user)
       VALUES (?, ?, ?, 0)`,
    ).run('https://mail.example/', 'alice', encryptChromeSecret('hunter2'));
    db.prepare(
      `INSERT INTO logins (origin_url, username_value, password_value, blacklisted_by_user)
       VALUES (?, ?, ?, 1)`,
    ).run('https://blocked.example/', 'nope', encryptChromeSecret('no'));
    const id = Number(
      (
        db.prepare(`SELECT id FROM logins WHERE origin_url = ?`).get('https://mail.example/') as {
          id: number;
        }
      ).id,
    );
    db.prepare(`INSERT INTO password_notes (parent_id, key, value) VALUES (?, '', ?)`).run(
      id,
      encryptChromeSecret('work inbox'),
    );
    db.close();

    const rows = readLoginDatabase(dbPath);
    expect(rows).toEqual([
      {
        origin: 'https://mail.example/',
        username: 'alice',
        password: 'hunter2',
        note: 'work inbox',
      },
    ]);
  });

  it('reads a copied Chrome profile including WAL sidecars', () => {
    const profile = path.join(tmpDir(), 'chrome');
    const defaultDir = path.join(profile, 'Default');
    fs.mkdirSync(defaultDir, { recursive: true });
    const db = new Database(path.join(defaultDir, 'Login Data'));
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE logins (
        origin_url VARCHAR NOT NULL,
        username_value VARCHAR,
        password_value BLOB,
        blacklisted_by_user INTEGER NOT NULL DEFAULT 0,
        id INTEGER PRIMARY KEY AUTOINCREMENT
      );
    `);
    db.prepare(`INSERT INTO logins (origin_url, username_value, password_value) VALUES (?, ?, ?)`).run(
      'https://shop.example/login',
      'buyer',
      encryptChromeSecret('cart'),
    );
    db.close();

    expect(readChromeProfilePasswords(profile)).toEqual([
      {
        origin: 'https://shop.example/login',
        username: 'buyer',
        password: 'cart',
        note: '',
      },
    ]);
  });

  it('merges Chrome logins with overlay notes and keeps them on disk', () => {
    const home = tmpDir();
    const profile = path.join(home, 'chrome');
    const defaultDir = path.join(profile, 'Default');
    fs.mkdirSync(defaultDir, { recursive: true });
    const db = new Database(path.join(defaultDir, 'Login Data'));
    db.exec(`
      CREATE TABLE logins (
        origin_url VARCHAR NOT NULL,
        username_value VARCHAR,
        password_value BLOB,
        blacklisted_by_user INTEGER NOT NULL DEFAULT 0,
        id INTEGER PRIMARY KEY AUTOINCREMENT
      );
    `);
    db.prepare(`INSERT INTO logins (origin_url, username_value, password_value) VALUES (?, ?, ?)`).run(
      'https://mail.example/',
      'alice',
      encryptChromeSecret('hunter2'),
    );
    db.close();
    const overlay = path.join(home, 'passwords.json');
    fs.writeFileSync(
      overlay,
      JSON.stringify({
        version: 1,
        entries: [{ origin: 'https://mail.example/', username: 'alice', password: '', note: 'work' }],
      }),
    );
    expect(listProfilePasswords(profile, overlay)).toEqual([
      { origin: 'https://mail.example/', username: 'alice', password: 'hunter2', note: 'work' },
    ]);
    expect(JSON.parse(fs.readFileSync(overlay, 'utf8')).entries[0].password).toBe('hunter2');
  });
});
