import fs from 'fs';
import os from 'os';
import { execFileSync } from 'child_process';
import { DATA_DIR } from '../../config.js';
import { listSessions, sessionDir } from '../../store.js';
import {
  getRuntimePids,
  listRunningIds,
  listWindows,
} from '../../runtime/sessionManager.js';
import type { GpuUsage, HostMetrics, ProcessUsage, SessionUsage } from '@nya/shared';
import { getUserById } from '../auth/service.js';

let lastProcCpu = new Map<number, { t: number; utime: number; stime: number }>();
let lastDataDir = { at: 0, bytes: 0 };
let lastSessionDisk = new Map<string, { at: number; bytes: number }>();
let diskRefreshBudget = 0;
let lastGpu = {
  at: 0,
  available: false,
  byPid: new Map<number, { memBytes: number; utilPercent: number }>(),
};
let snapshot: { at: string; host: HostMetrics; sessions: SessionUsage[] } = {
  at: new Date().toISOString(),
  host: {
    loadavg: os.loadavg(),
    cpuPercent: 0,
    memory: { totalBytes: 0, usedBytes: 0, freeBytes: 0 },
    disk: { path: DATA_DIR, totalBytes: 0, usedBytes: 0, freeBytes: 0 },
    uptimeSeconds: os.uptime(),
  },
  sessions: [],
};

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

function dirSize(dir: string) {
  try {
    const out = execFileSync('du', ['-sb', dir], { encoding: 'utf8', timeout: 15000 });
    return Number(out.trim().split(/\s+/)[0]) || 0;
  } catch {
    return 0;
  }
}

function dataDirBytes() {
  const now = Date.now();
  if (lastDataDir.at && now - lastDataDir.at < 15000) return lastDataDir.bytes;
  lastDataDir = { at: now, bytes: dirSize(DATA_DIR) };
  return lastDataDir.bytes;
}

function sessionDiskBytes(id: string, running: boolean) {
  const now = Date.now();
  const prev = lastSessionDisk.get(id);
  const ttl = running ? 15000 : 60000;
  if (prev && now - prev.at < ttl) return prev.bytes;
  if (!running && diskRefreshBudget <= 0) return prev?.bytes || 0;
  if (!running) diskRefreshBudget -= 1;
  const bytes = dirSize(sessionDir(id));
  lastSessionDisk.set(id, { at: now, bytes });
  return bytes;
}

function pruneSessionDisk(live: Set<string>) {
  for (const id of lastSessionDisk.keys()) {
    if (!live.has(id)) lastSessionDisk.delete(id);
  }
}

function parseNvidiaPmon(out: string) {
  const byPid = new Map<number, { memBytes: number; utilPercent: number }>();
  let pidIdx = 1;
  let smIdx = 3;
  let fbIdx = 7;
  for (const raw of out.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const headers = line.replace(/^#/, '').trim().toLowerCase().split(/\s+/);
      const pid = headers.indexOf('pid');
      const sm = headers.indexOf('sm');
      const fb = headers.indexOf('fb');
      if (pid >= 0) pidIdx = pid;
      if (sm >= 0) smIdx = sm;
      if (fb >= 0) fbIdx = fb;
      continue;
    }
    const cols = line.split(/\s+/);
    const pid = Number(cols[pidIdx]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const sm = Number(cols[smIdx]);
    const fb = Number(cols[fbIdx]);
    const prev = byPid.get(pid) || { memBytes: 0, utilPercent: 0 };
    byPid.set(pid, {
      memBytes: prev.memBytes + (Number.isFinite(fb) ? fb * 1024 * 1024 : 0),
      utilPercent: Math.max(prev.utilPercent, Number.isFinite(sm) ? sm : 0),
    });
  }
  return byPid;
}

function parseSmiMemory(raw: string) {
  const m = String(raw || '')
    .trim()
    .match(/^([\d.]+)\s*(KiB|MiB|GiB|B)?/i);
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return 0;
  const unit = (m[2] || 'MiB').toLowerCase();
  if (unit === 'gib') return n * 1024 * 1024 * 1024;
  if (unit === 'kib') return n * 1024;
  if (unit === 'b') return n;
  return n * 1024 * 1024;
}

function parseNvidiaXml(xml: string) {
  const byPid = new Map<number, { memBytes: number; utilPercent: number }>();
  const blocks = xml.match(/<process_info>[\s\S]*?<\/process_info>/g) || [];
  for (const block of blocks) {
    const pid = Number(block.match(/<pid>\s*(\d+)\s*<\/pid>/i)?.[1]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const mem = parseSmiMemory(block.match(/<used_memory>\s*([^<]+)<\/used_memory>/i)?.[1] || '');
    const prev = byPid.get(pid) || { memBytes: 0, utilPercent: 0 };
    byPid.set(pid, { memBytes: prev.memBytes + mem, utilPercent: prev.utilPercent });
  }
  return byPid;
}

function parseComputeApps(out: string) {
  const byPid = new Map<number, { memBytes: number; utilPercent: number }>();
  for (const raw of out.split('\n')) {
    const line = raw.trim();
    if (!line || line.toLowerCase().startsWith('pid')) continue;
    const [pidRaw, memRaw] = line.split(',').map((s) => s.trim());
    const pid = Number(pidRaw);
    const mem = Number(memRaw);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    byPid.set(pid, {
      memBytes: Number.isFinite(mem) ? mem * 1024 * 1024 : 0,
      utilPercent: 0,
    });
  }
  return byPid;
}

function mergeGpuMaps(...maps: Array<Map<number, { memBytes: number; utilPercent: number }>>) {
  const out = new Map<number, { memBytes: number; utilPercent: number }>();
  for (const map of maps) {
    for (const [pid, usage] of map) {
      const prev = out.get(pid) || { memBytes: 0, utilPercent: 0 };
      out.set(pid, {
        memBytes: Math.max(prev.memBytes, usage.memBytes),
        utilPercent: Math.max(prev.utilPercent, usage.utilPercent),
      });
    }
  }
  return out;
}

function nvidiaPresent() {
  return fs.existsSync('/dev/nvidia0') || fs.existsSync('/dev/nvidiactl');
}

let nvidiaSmiBin: string | null | undefined;
function resolveNvidiaSmi() {
  if (nvidiaSmiBin !== undefined) return nvidiaSmiBin;
  for (const bin of ['/usr/bin/nvidia-smi', '/usr/local/bin/nvidia-smi']) {
    if (fs.existsSync(bin)) {
      nvidiaSmiBin = bin;
      return nvidiaSmiBin;
    }
  }
  nvidiaSmiBin = null;
  return null;
}

function mapNvidiaPid(pid: number) {
  if (pid > 0 && fs.existsSync(`/proc/${pid}`)) return pid;
  try {
    const status = fs.readFileSync(`/host/proc/${pid}/status`, 'utf8');
    const m = status.match(/^NSpid:\s+(.+)$/m);
    if (!m) return pid;
    const ids = m[1]
      .trim()
      .split(/\s+/)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0);
    return ids[ids.length - 1] || pid;
  } catch {
    return pid;
  }
}

function remapGpuPids(byPid: Map<number, { memBytes: number; utilPercent: number }>) {
  const out = new Map<number, { memBytes: number; utilPercent: number }>();
  for (const [pid, usage] of byPid) {
    const mapped = mapNvidiaPid(pid);
    const prev = out.get(mapped) || { memBytes: 0, utilPercent: 0 };
    out.set(mapped, {
      memBytes: prev.memBytes + usage.memBytes,
      utilPercent: Math.max(prev.utilPercent, usage.utilPercent),
    });
  }
  return out;
}

let gpuLog = '';
function logGpu(msg: string) {
  if (gpuLog === msg) return;
  gpuLog = msg;
  console.warn(`[monitor] ${msg}`);
}

function sampleGpu() {
  const now = Date.now();
  if (lastGpu.at && now - lastGpu.at < 5000) return lastGpu;
  const present = nvidiaPresent();
  const smi = resolveNvidiaSmi();
  let byPid = new Map<number, { memBytes: number; utilPercent: number }>();
  const errors: string[] = [];

  if (!smi) {
    logGpu(
      present
        ? 'nvidia-smi not found; GPU memory/util unavailable'
        : 'GPU unavailable: no /dev/nvidia* and no nvidia-smi',
    );
    lastGpu = { at: now, available: present, byPid };
    return lastGpu;
  }

  try {
    const xml = execFileSync(smi, ['-q', '-x'], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    });
    byPid = mergeGpuMaps(byPid, parseNvidiaXml(xml));
  } catch (err) {
    errors.push(`xml: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const out = execFileSync(smi, ['pmon', '-c', '1', '-s', 'um'], {
      encoding: 'utf8',
      timeout: 4000,
    });
    byPid = mergeGpuMaps(byPid, parseNvidiaPmon(out));
  } catch (err) {
    errors.push(`pmon: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!byPid.size) {
    try {
      const out = execFileSync(
        smi,
        ['--query-compute-apps=pid,used_gpu_memory', '--format=csv,noheader,nounits'],
        { encoding: 'utf8', timeout: 4000 },
      );
      byPid = mergeGpuMaps(byPid, parseComputeApps(out));
    } catch (err) {
      errors.push(`compute-apps: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  byPid = remapGpuPids(byPid);
  const available = present || byPid.size > 0;
  if (!available) {
    logGpu(`GPU sample failed (${errors.join('; ') || 'unknown'})`);
  } else if (errors.length) {
    logGpu(`GPU sample partial (${errors.join('; ')})`);
  } else {
    logGpu(`GPU sample ok (${byPid.size} process${byPid.size === 1 ? '' : 'es'})`);
  }
  lastGpu = { at: now, available, byPid };
  return lastGpu;
}

function pidHasNvidia(pid: number) {
  try {
    const dir = `/proc/${pid}/fd`;
    for (const name of fs.readdirSync(dir)) {
      try {
        if (/^\/dev\/nvidia/.test(fs.readlinkSync(`${dir}/${name}`))) return true;
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

function gpuForPids(pids: number[]): GpuUsage {
  const gpu = sampleGpu();
  if (!gpu.available) return { available: false, memBytes: 0, utilPercent: 0 };
  const live = new Set(pids);
  let memBytes = 0;
  let utilPercent = 0;
  for (const [pid, usage] of gpu.byPid) {
    if (!live.has(pid)) continue;
    memBytes += usage.memBytes;
    utilPercent = Math.max(utilPercent, usage.utilPercent);
  }
  if (memBytes === 0 && gpu.byPid.size && pids.some(pidHasNvidia)) {
    const nvidiaSessions = listRunningIds().filter((id) =>
      runtimeRootPids(id)
        .flatMap((root) => walkPids(root))
        .some(pidHasNvidia),
    );
    if (nvidiaSessions.length === 1) {
      for (const usage of gpu.byPid.values()) {
        memBytes += usage.memBytes;
        utilPercent = Math.max(utilPercent, usage.utilPercent);
      }
    }
  }
  return {
    available: true,
    memBytes,
    utilPercent: Math.min(100, Math.round(utilPercent * 10) / 10),
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

function runtimeRootPids(sessionId: string): number[] {
  const pids = getRuntimePids(sessionId);
  if (!pids) return [];
  return [
    pids.chrome,
    pids.xvfb,
    pids.openbox,
    pids.x11vnc,
    pids.tint2,
    pids.singbox,
    ...(pids.subs || []).flatMap((sub) => [sub.xvfb, sub.openbox, sub.x11vnc, sub.tint2]),
  ].filter((pid): pid is number => Number.isInteger(pid) && pid > 0);
}

function collectProjectPids(): number[] {
  const seen = new Set<number>();
  for (const root of [process.pid, ...listRunningIds().flatMap(runtimeRootPids)]) {
    for (const pid of walkPids(root)) seen.add(pid);
  }
  return [...seen];
}

function pruneProcCpu(live: number[]) {
  const keep = new Set(live);
  for (const pid of lastProcCpu.keys()) {
    if (!keep.has(pid)) lastProcCpu.delete(pid);
  }
}

function readHost(): HostMetrics {
  const pids = collectProjectPids();
  const usage = usageForPids(pids);
  const ncpu = Math.max(1, os.cpus().length);
  const cpuPercent = Math.max(0, Math.min(100, usage.cpuPercent / ncpu));
  const totalMem = os.totalmem();
  const volume = diskUsage(DATA_DIR);
  const usedDisk = dataDirBytes();
  return {
    loadavg: os.loadavg(),
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    memory: {
      totalBytes: totalMem,
      usedBytes: usage.rssBytes,
      freeBytes: Math.max(0, totalMem - usage.rssBytes),
    },
    disk: {
      path: DATA_DIR,
      totalBytes: volume.totalBytes,
      usedBytes: usedDisk,
      freeBytes: volume.freeBytes,
    },
    uptimeSeconds: os.uptime(),
  };
}

function idleUsage(): ProcessUsage {
  return { pid: null, rssBytes: 0, cpuPercent: 0 };
}

function sampleRunningSession(id: string, name: string): SessionUsage {
  const pids = getRuntimePids(id);
  const allPids = [...new Set(runtimeRootPids(id).flatMap((root) => walkPids(root)))];
  const total = usageForPids(allPids);
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
              ...walkPids(pids?.tint2 || null),
            ].filter(Boolean),
          )
        : (() => {
            const sub = pids?.subs.find((s) => s.id === w.id);
            return usageForPids(
              [
                ...walkPids(sub?.xvfb || null),
                ...walkPids(sub?.openbox || null),
                ...walkPids(sub?.x11vnc || null),
                ...walkPids(sub?.tint2 || null),
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
    name,
    running: true,
    chrome,
    cpuPercent: total.cpuPercent,
    rssBytes: total.rssBytes,
    diskBytes: sessionDiskBytes(id, true),
    gpu: gpuForPids(allPids),
    windows,
  };
}

function sampleSessions(): SessionUsage[] {
  diskRefreshBudget = 8;
  const runningIds = new Set(listRunningIds());
  const sessions = listSessions();
  pruneSessionDisk(new Set(sessions.map((s) => s.id)));
  return sessions
    .map((session) => {
      const id = session.id;
      const name = session.name || id;
      if (runningIds.has(id)) return sampleRunningSession(id, name);
      return {
        sessionId: id,
        name,
        running: false,
        chrome: idleUsage(),
        cpuPercent: 0,
        rssBytes: 0,
        diskBytes: sessionDiskBytes(id, false),
        gpu: { available: false, memBytes: 0, utilPercent: 0 },
        windows: [],
      };
    })
    .sort((a, b) => {
      if (a.running !== b.running) return a.running ? -1 : 1;
      if (a.running) return b.rssBytes - a.rssBytes || b.cpuPercent - a.cpuPercent;
      return b.diskBytes - a.diskBytes || a.name.localeCompare(b.name, 'zh');
    });
}

export function sampleNow() {
  snapshot = {
    at: new Date().toISOString(),
    host: readHost(),
    sessions: sampleSessions(),
  };
  pruneProcCpu(collectProjectPids());
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
