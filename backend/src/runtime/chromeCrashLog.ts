import fs from 'fs';
import path from 'path';
import { chromeProfileDir, getSession, sessionDir } from '../store.js';

const INTERESTING =
  /FATAL|Check failed|NOTREACHED|SIGTRAP|nya-widget|INFO:CONSOLE|Received signal|chrome-watch|glReadPixels|MakeCurrent failed|compositor-context-lost/i;

function tailInteresting(file, maxLines = 40) {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/);
  const kept = [];
  for (let i = lines.length - 1; i >= 0 && kept.length < maxLines; i--) {
    const line = lines[i];
    if (!line) continue;
    if (line.includes('nya-present n=') && line.includes('changed=0')) continue;
    if (INTERESTING.test(line) || line.includes('nya-widget') || line.includes('nya-present ')) {
      kept.push(line.slice(0, 500));
    }
  }
  return kept.reverse();
}

function listDumps(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.dmp'))
    .map((name) => {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      return { name, bytes: st.size, mtime: st.mtime.toISOString() };
    })
    .sort((a, b) => a.mtime.localeCompare(b.mtime));
}

function parseDumpRip(file) {
  try {
    const buf = fs.readFileSync(file);
    if (buf.length < 32 || buf.toString('ascii', 0, 4) !== 'MDMP') return null;
    const n = buf.readUInt32LE(8);
    const dir = buf.readUInt32LE(12);
    let chromeBase = 0;
    let rip = 0;
    for (let i = 0; i < n; i++) {
      const off = dir + i * 12;
      const type = buf.readUInt32LE(off);
      const size = buf.readUInt32LE(off + 4);
      const loc = buf.readUInt32LE(off + 8);
      if (type === 4 && loc + 24 < buf.length) {
        chromeBase = Number(buf.readBigUInt64LE(loc + 4));
      }
      if (type === 6 && size >= 8) {
        const ctxSize = buf.readUInt32LE(loc + size - 8);
        const ctxRva = buf.readUInt32LE(loc + size - 4);
        if (ctxSize > 0xf8 + 8 && ctxRva + 0xf8 + 8 <= buf.length) {
          rip = Number(buf.readBigUInt64LE(ctxRva + 0xf8));
        }
      }
    }
    if (!rip) return null;
    const offset = chromeBase ? rip - chromeBase : 0;
    return {
      rip: `0x${rip.toString(16)}`,
      chromeOffset: offset ? `0x${offset.toString(16)}` : null,
    };
  } catch {
    return null;
  }
}

export function logChromeCrash(runtime, code, signal) {
  const session = getSession(runtime.id);
  const uptimeMs = runtime.chromeStartedAt ? Date.now() - runtime.chromeStartedAt : 0;
  const home = sessionDir(runtime.id);
  const profile = chromeProfileDir(runtime.id);
  const dumpDirs = [
    path.join(profile, 'Crash Reports', 'pending'),
    path.join(home, '.config', 'chromium', 'Crash Reports', 'pending'),
  ];
  const dumps = dumpDirs.flatMap((dir) =>
    listDumps(dir).map((d) => ({ ...d, dir })),
  );
  const newest = dumps.at(-1);
  const rip = newest ? parseDumpRip(path.join(newest.dir, newest.name)) : null;
  const logLines = tailInteresting(path.join(home, 'chrome.log'));
  console.error(
    `[chrome-crash] session=${runtime.id} name=${session?.name || '?'} ` +
      `display=:${runtime.display} signal=${signal} code=${code} ` +
      `uptime_ms=${uptimeMs} gpu=${runtime.chromeHasInProcessGpu ? 'in-process' : 'out-of-process'} ` +
      `geom=${runtime.lastGeom ? `${runtime.lastGeom.w}x${runtime.lastGeom.h}` : '?'} ` +
      `dumps=${dumps.length}` +
      (newest ? ` last_dump=${newest.name} rip=${rip?.rip || '?'} chrome+${rip?.chromeOffset || '?'}` : ''),
  );
  for (const line of logLines) {
    console.error(`[chrome-crash-log ${runtime.id}] ${line}`);
  }
}
