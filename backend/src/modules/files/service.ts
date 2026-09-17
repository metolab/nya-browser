import fs from 'fs';
import path from 'path';
import type { SessionDownload, SessionTransfer, SessionUpload } from '@nya/shared';
import { downloadsDir, ensureFilesDir, getSession } from '../../store.js';
import { detectFileDialog } from '../../runtime/sessionManager.js';
import { readChromeDownloads } from './history.js';
import { listLocalJobs } from './jobs.js';
import { HIDDEN_FILE_NAMES, isCrdownload, isHiddenFileName, stripCrdownload, uniqueName, UPLOAD_LOG_NAME } from './names.js';

function assertSafeRel(relPath: string) {
  const normalized = path.normalize(relPath || '.').replace(/^(\.\.(\/|\\|$))+/, '');
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    throw new Error('Invalid path');
  }
  return normalized === '.' ? '' : normalized;
}

export function resolveClipboardFiles(sessionId: string, rels: string[]) {
  return rels.map((rel) => {
    const { full } = resolveSessionPath(sessionId, rel);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      throw new Error('File not found');
    }
    return full;
  });
}

export function resolveSessionPath(sessionId: string, relPath = '.') {
  if (!getSession(sessionId)) throw new Error('Session not found');
  const root = ensureFilesDir(sessionId);
  const safe = assertSafeRel(relPath);
  const full = path.resolve(root, safe);
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) {
    throw new Error('Path escapes session directory');
  }
  return { root, full, rel: safe || '.' };
}

function uploadLogPath(sessionId: string) {
  return path.join(downloadsDir(sessionId), UPLOAD_LOG_NAME);
}

function readUploadLog(sessionId: string): SessionUpload[] {
  const file = uploadLogPath(sessionId);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? (parsed as SessionUpload[]) : [];
  } catch {
    return [];
  }
}

function writeUploadLog(sessionId: string, rows: SessionUpload[]) {
  fs.writeFileSync(uploadLogPath(sessionId), `${JSON.stringify(rows, null, 2)}\n`);
}

export function recordUpload(sessionId: string, entry: SessionUpload) {
  const rows = readUploadLog(sessionId).filter((row) => row.path !== entry.path);
  rows.unshift(entry);
  writeUploadLog(sessionId, rows.slice(0, 200));
}

export function savePastedImage(sessionId: string, png: Buffer) {
  const { full: dir } = resolveSessionPath(sessionId, '.');
  fs.mkdirSync(dir, { recursive: true });
  const name = uniqueName(dir, 'image.png');
  const full = path.join(dir, name);
  fs.writeFileSync(full, png);
  const entry = {
    name,
    path: name,
    size: png.length,
    mtime: new Date().toISOString(),
  };
  recordUpload(sessionId, entry);
  return { ...entry, full };
}

export function listUploads(sessionId: string): SessionUpload[] {
  ensureFilesDir(sessionId);
  return readUploadLog(sessionId)
    .map((row) => {
      try {
        const { full } = resolveSessionPath(sessionId, row.path);
        if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return null;
        const st = fs.statSync(full);
        return { ...row, size: st.size, mtime: st.mtime.toISOString() };
      } catch {
        return null;
      }
    })
    .filter((row): row is SessionUpload => Boolean(row));
}

function diskFiles(sessionId: string) {
  const { full: root } = resolveSessionPath(sessionId, '.');
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isFile() && !isHiddenFileName(d.name))
    .map((d) => {
      const st = fs.statSync(path.join(root, d.name));
      return { name: d.name, size: st.size, mtime: st.mtime.toISOString() };
    });
}

export function listDownloads(sessionId: string): SessionDownload[] {
  const { root } = resolveSessionPath(sessionId, '.');
  const history = readChromeDownloads(sessionId, root);
  const uploads = new Set(listUploads(sessionId).map((row) => row.path));
  const byPath = new Map<string, SessionDownload>();
  for (const row of history) {
    const key = row.path || row.name;
    const { full } = safeFull(sessionId, row.path);
    const missing = !full || !fs.existsSync(full);
    byPath.set(key, { ...row, missing });
  }
  for (const file of diskFiles(sessionId)) {
    if (isCrdownload(file.name)) {
      const name = stripCrdownload(file.name);
      const existing = [...byPath.values()].find((row) => row.name === name);
      if (existing) {
        existing.state = 'in_progress';
        existing.receivedBytes = file.size;
        existing.missing = false;
        continue;
      }
      byPath.set(file.name, {
        id: `cr-${file.name}`,
        name,
        path: file.name,
        url: '',
        state: 'in_progress',
        receivedBytes: file.size,
        totalBytes: 0,
        startedAt: file.mtime,
        updatedAt: file.mtime,
      });
      continue;
    }
    if (uploads.has(file.name) || byPath.has(file.name)) continue;
    byPath.set(file.name, {
      id: `disk-${file.name}`,
      name: file.name,
      path: file.name,
      url: '',
      state: 'completed',
      receivedBytes: file.size,
      totalBytes: file.size,
      startedAt: file.mtime,
      updatedAt: file.mtime,
    });
  }
  return [...byPath.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function safeFull(sessionId: string, rel: string) {
  try {
    return resolveSessionPath(sessionId, rel);
  } catch {
    return { full: '', root: '', rel: '' };
  }
}

export async function getTransfer(sessionId: string, subId?: string | null): Promise<SessionTransfer> {
  const [chooser] = await Promise.all([detectFileDialog(sessionId, subId).catch(() => ({ open: false, title: '' }))]);
  return {
    chooser: chooser.open ? chooser : null,
    uploads: listUploads(sessionId),
    downloads: listDownloads(sessionId),
    localJobs: listLocalJobs(sessionId),
  };
}

export function listFiles(sessionId: string, relPath = '.') {
  const { full, rel } = resolveSessionPath(sessionId, relPath);
  if (!fs.existsSync(full)) {
    return { path: rel, entries: [] as Array<{ name: string; type: string; size: number | null; mtime: string }> };
  }
  const stat = fs.statSync(full);
  if (!stat.isDirectory()) {
    throw new Error('Not a directory');
  }
  const entries = fs
    .readdirSync(full, { withFileTypes: true })
    .filter((d) => !HIDDEN_FILE_NAMES.has(d.name) && !d.name.startsWith('.'))
    .map((d) => {
      const child = path.join(full, d.name);
      const st = fs.statSync(child);
      return {
        name: d.name,
        type: d.isDirectory() ? 'dir' : 'file',
        size: d.isDirectory() ? null : st.size,
        mtime: st.mtime.toISOString(),
      };
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  return { path: rel, entries };
}

export function mkdir(sessionId: string, relPath: string) {
  const { full } = resolveSessionPath(sessionId, relPath);
  fs.mkdirSync(full, { recursive: true });
  return true;
}

export function removeEntry(sessionId: string, relPath: string) {
  const { root, full, rel } = resolveSessionPath(sessionId, relPath);
  if (full === root) throw new Error('Cannot delete root');
  fs.rmSync(full, { recursive: true, force: true });
  writeUploadLog(
    sessionId,
    readUploadLog(sessionId).filter((row) => row.path !== rel && row.name !== path.basename(rel)),
  );
  return true;
}

export function applyUploadMtime(full: string, lastModified: unknown) {
  const n = Number(lastModified);
  if (!Number.isFinite(n) || n <= 0) return;
  const at = new Date(n);
  if (Number.isNaN(at.getTime())) return;
  try {
    fs.utimesSync(full, at, at);
  } catch {
    /* ignore */
  }
}
