import fs from 'fs';
import path from 'path';
import { downloadsDir, getSession } from '../../store.js';

function assertSafeRel(relPath: string) {
  const normalized = path.normalize(relPath || '.').replace(/^(\.\.(\/|\\|$))+/, '');
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    throw new Error('Invalid path');
  }
  return normalized === '.' ? '' : normalized;
}

export function resolveSessionPath(sessionId: string, relPath = '.') {
  if (!getSession(sessionId)) throw new Error('Session not found');
  const root = downloadsDir(sessionId);
  fs.mkdirSync(root, { recursive: true });
  const safe = assertSafeRel(relPath);
  const full = path.resolve(root, safe);
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) {
    throw new Error('Path escapes session directory');
  }
  return { root, full, rel: safe || '.' };
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
    .filter((d) => d.name !== '.keep.html')
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
  const { root, full } = resolveSessionPath(sessionId, relPath);
  if (full === root) throw new Error('Cannot delete root');
  fs.rmSync(full, { recursive: true, force: true });
  return true;
}
