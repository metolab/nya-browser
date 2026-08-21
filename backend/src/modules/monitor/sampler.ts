import fs from 'fs';
import os from 'os';
import { execFileSync } from 'child_process';
import { DATA_DIR } from '../../config.js';
import { getSession } from '../../store.js';
import {
  getRuntimePids,
  listRunningIds,
  listWindows,
} from '../../runtime/sessionManager.js';
import type { HostMetrics, ProcessUsage, SessionUsage } from '@nya/shared';
import { getUserById } from '../auth/service.js';

type CpuSnap = { idle: number; total: number };

let lastCpu: CpuSnap | null = null;
let lastProcCpu = new Map<number, { t: number; utime: number; stime: number }>();
let snapshot = {
  at: new Date().toISOString(),
  host: readHost(),
  sessions: [] as SessionUsage[],
};

function readProcStat(): CpuSnap {
  const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
  const parts = line.split(/\s+/).slice(1).map(Number);
  const idle = (parts[3] || 0) + (parts[4] || 0);
  const total = parts.reduce((a, b) => a + b, 0);
  return { idle, total };
}

function hostCpuPercent() {
  const cur = readProcStat();
  let pct = 0;
  if (lastCpu) {
    const idle = cur.idle - lastCpu.idle;
    const total = cur.total - lastCpu.total;
    pct = total > 0 ? (1 - idle / total) * 100 : 0;
  }
  lastCpu = cur;
  return Math.max(0, Math.min(100, pct));
}

function diskUsage(dir: string) {
  try {
    const out = execFileSync('df', ['-B1', dir], { encoding: 'utf8' });
    const line = out.trim().split('\n')[1];
    const cols = line.split(/\s+/);
    const total = Number(cols[1]);
    const used = Number(cols[2]);
    const free = Number(cols[3]);
    return { path: dir, totalBytes: total, usedBytes: used, freeBytes: free };
  } catch {
    return { path: dir, totalBytes: 0, usedBytes: 0, freeBytes: 0 };
  }
}

function readHost(): HostMetrics {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    loadavg: os.loadavg(),
    cpuPercent: hostCpuPercent(),
    memory: { totalBytes: total, usedBytes: total - free, freeBytes: free },
    disk: diskUsage(DATA_DIR),
    uptimeSeconds: os.uptime(),
  };
}

function childPids(pid: number): number[] {
  try {
    const out = fs.readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8').trim();
    if (!out) return [];
    return out.split(/\s+/).map(Number).filter(Boolean);
  } catch {
    try {
      const out = execFileSync('ps', ['-o', 'pid=', '--ppid', String(pid)], {
        encoding: 'utf8',
      });
      return out
        .trim()
        .split(/\n/)
        .map((s) => Number(s.trim()))
        .filter(Boolean);
    } catch {
      return [];
    }
  }
}

function walkPids(root: number | null): number[] {
  if (!root) return [];
  const seen = new Set<number>();
  const stack = [root];
  while (stack.length) {
    const pid = stack.pop()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    for (const c of childPids(pid)) stack.push(c);
  }
  return [...seen];
}

function usageForPids(pids: number[]): ProcessUsage {
  let rss = 0;
  let cpu = 0;
  const now = Date.now();
  const hertz = 100;
  for (const pid of pids) {
    try {
      const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
      const m = status.match(/^VmRSS:\s+(\d+)\s+kB/m);
      if (m) rss += Number(m[1]) * 1024;
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const close = stat.lastIndexOf(')');
      const rest = stat.slice(close + 2).split(/\s+/);
      const utime = Number(rest[11] || 0);
      const stime = Number(rest[12] || 0);
      const prev = lastProcCpu.get(pid);
      lastProcCpu.set(pid, { t: now, utime, stime });
      if (prev) {
        const dt = (now - prev.t) / 1000;
        const dtic = utime + stime - prev.utime - prev.stime;
        if (dt > 0) cpu += (dtic / hertz / dt) * 100;
      }
    } catch {
      /* gone */
    }
  }
  return { pid: pids[0] || null, rssBytes: rss, cpuPercent: Math.round(cpu * 10) / 10 };
}

function sampleSessions(): SessionUsage[] {
  return listRunningIds().map((id) => {
    const session = getSession(id);
    const pids = getRuntimePids(id);
    const chrome = usageForPids(walkPids(pids?.chrome || null));
    const windows = listWindows(id).map((w) => {
      const owner = w.ownerUserId ? getUserById(w.ownerUserId) : null;
      const stack =
        w.kind === 'main'
          ? usageForPids(
              [
                ...walkPids(pids?.xvfb || null),
                ...walkPids(pids?.openbox || null),
                ...walkPids(pids?.x11vnc || null),
              ].filter(Boolean),
            )
          : (() => {
              const sub = pids?.subs.find((s) => s.id === w.id);
              return usageForPids(
                [
                  ...walkPids(sub?.xvfb || null),
                  ...walkPids(sub?.openbox || null),
                  ...walkPids(sub?.x11vnc || null),
                ].filter(Boolean),
              );
            })();
      return {
        ...w,
        ownerUsername: owner?.username || null,
        usage: stack,
      };
    });
    return {
      sessionId: id,
      name: session?.name || id,
      running: true,
      chrome,
      windows,
    };
  });
}

export function sampleNow() {
  snapshot = {
    at: new Date().toISOString(),
    host: readHost(),
    sessions: sampleSessions(),
  };
  return snapshot;
}

export function getSnapshot() {
  return snapshot;
}

export function startSampler() {
  sampleNow();
  const t = setInterval(sampleNow, 2500);
  if (typeof t.unref === 'function') t.unref();
}

export function tailFile(filePath: string, lines = 200) {
  if (!fs.existsSync(filePath)) return '';
  const raw = fs.readFileSync(filePath, 'utf8');
  const parts = raw.split('\n');
  return parts.slice(Math.max(0, parts.length - lines)).join('\n');
}
