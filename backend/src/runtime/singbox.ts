import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { buildSingboxConfig, type ProxyConfig, type SingboxProxyInput } from '@nya/shared';
import { DATA_DIR, SING_BOX_BIN } from '../config.js';
import { logger } from '../logger.js';
import { proxyChainInputs } from '../store.js';

export type SingboxHandle = {
  child: ChildProcess;
  port: number;
  configPath: string;
  logPath: string;
};

const START_TIMEOUT_MS = Number(process.env.SINGBOX_START_TIMEOUT_MS || 8000);

function which(bin: string) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of dirs) {
    const candidate = path.join(dir, bin);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* continue */
    }
  }
  return null;
}

export function resolveSingboxBin() {
  const candidates = [
    process.env.SING_BOX_BIN,
    SING_BOX_BIN,
    '/usr/local/bin/sing-box',
    '/opt/nya-singbox/sing-box',
    path.resolve(process.cwd(), '../cache/sing-box/sing-box'),
    path.resolve(process.cwd(), 'cache/sing-box/sing-box'),
    which('sing-box'),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      /* continue */
    }
  }
  throw new Error('sing-box binary not found (set SING_BOX_BIN)');
}

function runtimeDir() {
  const dir = path.join(DATA_DIR, 'sing-box');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* ignore */
  }
  return dir;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForListen(port: number, child: ChildProcess, timeoutMs: number, logPath: string) {
  const started = Date.now();
  let lastErr = '';
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode != null) {
      let log = '';
      try {
        log = fs.readFileSync(logPath, 'utf8').slice(-2000);
      } catch {
        /* ignore */
      }
      throw new Error(`sing-box exited (${child.exitCode})${log ? `: ${log.trim()}` : ''}`);
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.connect({ host: '127.0.0.1', port }, () => {
          socket.end();
          resolve();
        });
        socket.on('error', reject);
      });
      return;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      await sleep(50);
    }
  }
  throw new Error(`sing-box did not listen on 127.0.0.1:${port} (${lastErr})`);
}

function writeConfig(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* ignore */
  }
}

function spawnSingbox(bin: string, configPath: string, logPath: string) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const fd = fs.openSync(logPath, 'w');
  const child = spawn(bin, ['run', '-c', configPath], {
    stdio: ['ignore', fd, fd],
    detached: true,
    env: { ...process.env },
  });
  fs.closeSync(fd);
  child.unref();
  child.on('error', (err) => {
    logger.error({ err }, 'sing-box spawn error');
  });
  return child;
}

function isHandle(value: SingboxHandle | ChildProcess): value is SingboxHandle {
  return Boolean(value && 'configPath' in value);
}

export async function stopSingboxSidecar(handle: SingboxHandle | ChildProcess | null | undefined) {
  if (!handle) return;
  const child = isHandle(handle) ? handle.child : handle;
  const pid = child.pid;
  if (!pid) return;
  const kill = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch {
      try {
        child.kill(signal);
      } catch {
        /* ignore */
      }
    }
  };
  kill('SIGTERM');
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && child.exitCode == null) {
    await sleep(50);
  }
  if (child.exitCode == null) kill('SIGKILL');
  if (isHandle(handle)) {
    try {
      fs.unlinkSync(handle.configPath);
    } catch {
      /* ignore */
    }
  }
}

export async function startSingboxSidecar(opts: {
  id: string;
  proxy: ProxyConfig;
  listenPort: number;
  configDir?: string;
}): Promise<{ port: number | null; handle: SingboxHandle | null }> {
  if (!opts.proxy || opts.proxy.type === 'none') {
    return { port: null, handle: null };
  }
  const bin = resolveSingboxBin();
  const dir = opts.configDir || runtimeDir();
  const configPath = path.join(dir, `${opts.id}.json`);
  const logPath = path.join(dir, `${opts.id}.log`);
  const chain = proxyChainInputs(opts.proxy);
  const config = buildSingboxConfig({
    listenPort: opts.listenPort,
    proxy: chain.proxy,
    via: chain.via,
    logPath,
    blockLoopback: true,
  });
  writeConfig(configPath, config);
  const child = spawnSingbox(bin, configPath, logPath);
  try {
    await waitForListen(opts.listenPort, child, START_TIMEOUT_MS, logPath);
  } catch (err) {
    await stopSingboxSidecar(child);
    throw err;
  }
  logger.info(
    { id: opts.id, port: opts.listenPort, type: opts.proxy.type, via: chain.via.length },
    'sing-box sidecar started',
  );
  return {
    port: opts.listenPort,
    handle: { child, port: opts.listenPort, configPath, logPath },
  };
}

export async function withEphemeralSidecar<T>(
  proxy: ProxyConfig,
  fn: (port: number) => Promise<T>,
  opts: { blockLoopback?: boolean; via?: SingboxProxyInput[] } = {},
): Promise<T> {
  const bin = resolveSingboxBin();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nya-singbox-'));
  const configPath = path.join(dir, 'config.json');
  const logPath = path.join(dir, 'sing-box.log');
  const port = await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const p = typeof addr === 'object' && addr ? addr.port : 0;
      server.close((err) => (err ? reject(err) : resolve(p)));
    });
    server.on('error', reject);
  });
  const chain = opts.via
    ? {
        proxy: {
          type: proxy.type as Exclude<ProxyConfig['type'], 'none'>,
          host: proxy.host,
          port: proxy.port,
          username: proxy.username,
          password: proxy.password,
          extra: proxy.extra,
        },
        via: opts.via,
      }
    : proxyChainInputs(proxy);
  writeConfig(
    configPath,
    buildSingboxConfig({
      listenPort: port,
      proxy: chain.proxy,
      via: chain.via,
      logPath,
      blockLoopback: opts.blockLoopback !== false,
    }),
  );
  const child = spawnSingbox(bin, configPath, logPath);
  const handle: SingboxHandle = { child, port, configPath, logPath };
  try {
    await waitForListen(port, child, START_TIMEOUT_MS, logPath);
    return await fn(port);
  } finally {
    await stopSingboxSidecar(handle);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
