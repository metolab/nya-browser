import { spawn, type ChildProcess } from 'child_process';
import { execFileSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import net from 'net';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emptyProxyExtra, type ProxyConfig } from '@nya/shared';
import { resolveSingboxBin, withEphemeralSidecar } from './singbox.js';

let bin = '';
try {
  bin = resolveSingboxBin();
} catch {
  bin = '';
}

function skip() {
  return !bin;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}

async function waitPort(port: number, child: ChildProcess, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode != null) throw new Error(`process exited ${child.exitCode}`);
    try {
      await new Promise<void>((resolve, reject) => {
        const socket = net.connect({ host: '127.0.0.1', port }, () => {
          socket.end();
          resolve();
        });
        socket.on('error', reject);
      });
      return;
    } catch {
      await sleep(40);
    }
  }
  throw new Error(`timeout waiting for ${port}`);
}

function requestViaProxy(proxyPort: number, url: string) {
  return new Promise<string>((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: proxyPort,
        method: 'GET',
        path: url,
        headers: { Host: u.host },
        timeout: 5000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.end();
  });
}

function startBox(config: unknown, dir: string) {
  const configPath = path.join(dir, `cfg-${Math.random().toString(16).slice(2)}.json`);
  const logPath = path.join(dir, `log-${path.basename(configPath, '.json')}.log`);
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const fd = fs.openSync(logPath, 'w');
  const child = spawn(bin, ['run', '-c', configPath], {
    stdio: ['ignore', fd, fd],
    detached: true,
  });
  fs.closeSync(fd);
  child.unref();
  return { child, logPath };
}

async function stopBox(child: ChildProcess) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline && child.exitCode == null) await sleep(30);
  if (child.exitCode == null) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* ignore */
    }
  }
}

describe.skipIf(skip())('sing-box sidecar live', () => {
  let tmp = '';
  let origin: http.Server;
  let originPort = 0;
  const kids: ChildProcess[] = [];

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nya-sb-live-'));
    originPort = await freePort();
    origin = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ip=203.0.113.9\nloc=XX\ncolo=TEST\n');
    });
    await new Promise<void>((resolve) => origin.listen(originPort, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    await Promise.all(kids.map((c) => stopBox(c)));
    await new Promise<void>((resolve) => origin.close(() => resolve()));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  async function remote(config: unknown, port: number) {
    const box = startBox(config, tmp);
    kids.push(box.child);
    try {
      await waitPort(port, box.child);
    } catch (err) {
      const log = fs.readFileSync(box.logPath, 'utf8');
      throw new Error(`${err instanceof Error ? err.message : err}\n${log}`);
    }
    return box;
  }

  it('http / socks5 / ss / vless / anytls reach origin through sidecar', async () => {
    const originUrl = `http://127.0.0.1:${originPort}/`;
    const uuid = '11111111-1111-1111-1111-111111111111';

    const httpPort = await freePort();
    await remote(
      {
        log: { level: 'warn' },
        inbounds: [{ type: 'mixed', listen: '127.0.0.1', listen_port: httpPort }],
        outbounds: [{ type: 'direct', tag: 'direct' }],
      },
      httpPort,
    );

    const ssPort = await freePort();
    await remote(
      {
        log: { level: 'warn' },
        inbounds: [
          {
            type: 'shadowsocks',
            listen: '127.0.0.1',
            listen_port: ssPort,
            method: 'aes-256-gcm',
            password: 'ss-secret',
          },
        ],
        outbounds: [{ type: 'direct', tag: 'direct' }],
      },
      ssPort,
    );

    const vlessPort = await freePort();
    await remote(
      {
        log: { level: 'warn' },
        inbounds: [
          {
            type: 'vless',
            listen: '127.0.0.1',
            listen_port: vlessPort,
            users: [{ name: 'u', uuid }],
          },
        ],
        outbounds: [{ type: 'direct', tag: 'direct' }],
      },
      vlessPort,
    );

    const certDir = path.join(tmp, 'certs');
    fs.mkdirSync(certDir, { recursive: true });
    const key = path.join(certDir, 'key.pem');
    const cert = path.join(certDir, 'cert.pem');
    execFileSync('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      key,
      '-out',
      cert,
      '-days',
      '1',
      '-nodes',
      '-subj',
      '/CN=127.0.0.1',
    ]);
    const anytlsPort = await freePort();
    await remote(
      {
        log: { level: 'warn' },
        inbounds: [
          {
            type: 'anytls',
            listen: '127.0.0.1',
            listen_port: anytlsPort,
            users: [{ name: 'u', password: 'any-secret' }],
            tls: {
              enabled: true,
              certificate_path: cert,
              key_path: key,
            },
          },
        ],
        outbounds: [{ type: 'direct', tag: 'direct' }],
      },
      anytlsPort,
    );

    const cases: { name: string; proxy: ProxyConfig }[] = [
      {
        name: 'http',
        proxy: {
          type: 'http',
          host: '127.0.0.1',
          port: httpPort,
          username: '',
          password: '',
          extra: emptyProxyExtra(),
        },
      },
      {
        name: 'socks5',
        proxy: {
          type: 'socks5',
          host: '127.0.0.1',
          port: httpPort,
          username: '',
          password: '',
          extra: emptyProxyExtra(),
        },
      },
      {
        name: 'ss',
        proxy: {
          type: 'ss',
          host: '127.0.0.1',
          port: ssPort,
          username: '',
          password: 'ss-secret',
          extra: { ...emptyProxyExtra(), method: 'aes-256-gcm' },
        },
      },
      {
        name: 'vless',
        proxy: {
          type: 'vless',
          host: '127.0.0.1',
          port: vlessPort,
          username: '',
          password: uuid,
          extra: { ...emptyProxyExtra(), security: 'none' },
        },
      },
      {
        name: 'anytls',
        proxy: {
          type: 'anytls',
          host: '127.0.0.1',
          port: anytlsPort,
          username: '',
          password: 'any-secret',
          extra: { ...emptyProxyExtra(), insecure: true, sni: '127.0.0.1' },
        },
      },
    ];

    for (const item of cases) {
      const body = await withEphemeralSidecar(
        item.proxy,
        (port) => requestViaProxy(port, originUrl),
        { blockLoopback: false },
      );
      expect(body, item.name).toContain('colo=TEST');
    }

    const chained = await withEphemeralSidecar(
      {
        type: 'ss',
        host: '127.0.0.1',
        port: ssPort,
        username: '',
        password: 'ss-secret',
        extra: { ...emptyProxyExtra(), method: 'aes-256-gcm' },
      },
      (port) => requestViaProxy(port, originUrl),
      {
        blockLoopback: false,
        via: [
          {
            type: 'http',
            host: '127.0.0.1',
            port: httpPort,
            username: '',
            password: '',
            extra: emptyProxyExtra(),
          },
        ],
      },
    );
    expect(chained, 'ss-via-http').toContain('colo=TEST');
  });

  it('rejects localhost destinations by default', async () => {
    const httpPort = await freePort();
    await remote(
      {
        log: { level: 'warn' },
        inbounds: [{ type: 'mixed', listen: '127.0.0.1', listen_port: httpPort }],
        outbounds: [{ type: 'direct', tag: 'direct' }],
      },
      httpPort,
    );
    let body = '';
    try {
      body = await withEphemeralSidecar(
        {
          type: 'http',
          host: '127.0.0.1',
          port: httpPort,
          username: '',
          password: '',
          extra: emptyProxyExtra(),
        },
        (port) => requestViaProxy(port, `http://127.0.0.1:${originPort}/`),
        { blockLoopback: true },
      );
    } catch {
      body = '';
    }
    expect(body).not.toContain('colo=TEST');
  });
});
