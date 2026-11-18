import net from 'net';
import fs from 'fs';
import path from 'path';
import { spawn, type ChildProcess, type SpawnOptions, type StdioOptions } from 'child_process';
import type { Geom } from './types.js';

export type RunOptions = {
  logFile?: string;
  stdio?: StdioOptions;
  env?: NodeJS.ProcessEnv;
  uid?: number;
  gid?: number;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
};

export function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function envOn(name: string) {
  const raw = String(process.env[name] || '').toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on';
}

type Killable = { pid?: number; kill?: (signal: NodeJS.Signals) => boolean };

/** Signal a detached child's process group, falling back to the child itself. */
export function killTree(child: Killable | null | undefined, signal: NodeJS.Signals = 'SIGTERM') {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill?.(signal);
    } catch {
      /* ignore */
    }
  }
}

export function run(cmd: string, args: string[], opts: RunOptions = {}) {
  const logFile = opts.logFile;
  let stdio: StdioOptions = opts.stdio || 'ignore';
  if (logFile) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const fd = fs.openSync(logFile, 'a');
    stdio = ['ignore', fd, fd];
  }
  const spawnOpts: SpawnOptions = {
    stdio,
    env: { ...process.env, ...(opts.env || {}) },
    detached: true,
  };
  if (Number.isInteger(opts.uid)) spawnOpts.uid = opts.uid;
  if (Number.isInteger(opts.gid)) spawnOpts.gid = opts.gid;
  const child = spawn(cmd, args, spawnOpts);
  if (opts.onExit) {
    child.on('exit', opts.onExit);
  }
  child.on('error', (err) => {
    console.error(`[spawn error] ${cmd}:`, err.message);
  });
  return child;
}

export function waitUnixSocket(sockPath: string, timeoutMs = 20000) {
  const started = Date.now();
  return new Promise<void>((resolve, reject) => {
    const tryOnce = () => {
      if (!fs.existsSync(sockPath)) {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timeout waiting for ${sockPath}`));
        } else {
          setTimeout(tryOnce, 150);
        }
        return;
      }
      const socket = net.connect({ path: sockPath }, () => {
        socket.end();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timeout waiting for ${sockPath}`));
        } else {
          setTimeout(tryOnce, 150);
        }
      });
    };
    tryOnce();
  });
}

export function parseWh(spec: string | null | undefined, fallbackW = 1920, fallbackH = 1080): Geom {
  const m = String(spec || '').match(/(\d+)\s*x\s*(\d+)/i);
  return {
    w: m ? Number(m[1]) : fallbackW,
    h: m ? Number(m[2]) : fallbackH,
  };
}

export function childPidAlive(child: ChildProcess | null | undefined) {
  const pid = child?.pid;
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Message of an unknown thrown value. */
export function errMsg(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
