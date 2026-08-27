import http from 'http';
import net from 'net';
import { WebSocketServer } from 'ws';
import { AUTH_COOKIE, AUDIT_ACTIONS, joinBasePath } from '@nya/shared';
import { BASE_PATH, HOST, PORT } from './config.js';
import { migrate } from './db/migrate.js';
import { bootstrap } from './db/bootstrap.js';
import { createApp } from './app.js';
import { logger } from './logger.js';
import { resolveToken } from './modules/auth/service.js';
import { writeAudit } from './modules/audit/service.js';
import { getSession, userCanAccessSession } from './store.js';
import { startSampler } from './modules/monitor/sampler.js';
import {
  canAccessWindow,
  getRuntime,
  getSubRuntime,
  getWindowOccupancy,
  registerVncClient,
  stopAllSessions,
} from './runtime/sessionManager.js';

migrate();
await bootstrap();
startSampler();

const app = createApp();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

function parseCookie(header: string) {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = decodeURIComponent(part.slice(idx + 1).trim());
    out[k] = v;
  }
  return out;
}

server.on('upgrade', (req, socket, head) => {
  try {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const wsPrefix = joinBasePath(BASE_PATH, '/ws/vnc/');
    if (!url.pathname.startsWith(wsPrefix)) {
      socket.destroy();
      return;
    }
    const token =
      url.searchParams.get('token') || parseCookie(req.headers.cookie || '')[AUTH_COOKIE];
    const user = resolveToken(token || undefined);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    const parts = url.pathname.slice(wsPrefix.length).split('/').filter(Boolean);
    const sessionId = decodeURIComponent(parts[0] || '');
    const subId = parts[1] ? decodeURIComponent(parts[1]) : null;
    if (!getSession(sessionId)) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    if (user.role !== 'admin') {
      if (!userCanAccessSession(user.id, sessionId) || !canAccessWindow(sessionId, subId || 'main', user)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      const occ = url.searchParams.get('occ');
      const expected = getWindowOccupancy(sessionId, subId || 'main');
      if (!expected || occ !== expected) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          ws.close(4000, 'taken_over');
        });
        return;
      }
    }
    const runtime = getRuntime(sessionId);
    if (!runtime) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    let vncTarget = runtime;
    if (subId) {
      const found = getSubRuntime(sessionId, subId);
      if (!found) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }
      vncTarget = { ...runtime, vncSock: found.sub.vncSock, display: found.sub.display };
    }
    writeAudit({
      actorId: user.id,
      actorUsername: user.username,
      action: AUDIT_ACTIONS.vncConnect,
      resourceType: 'session',
      resourceId: subId ? `${sessionId}/${subId}` : sessionId,
      success: true,
    });
    wss.handleUpgrade(req, socket, head, (ws) => {
      registerVncClient(sessionId, subId, ws);
      bridgeVnc(ws, vncTarget, subId ? `${sessionId}/${subId}` : sessionId);
    });
  } catch (err) {
    logger.error({ err }, 'upgrade error');
    socket.destroy();
  }
});

function vncDebugEnabled() {
  const raw = String(process.env.NYA_VNC_DEBUG || '').toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'on';
}

function bridgeVnc(ws: import('ws').WebSocket, runtime: { vncSock?: string; vncPort?: number }, sessionId: string) {
  const tcp = runtime.vncSock
    ? net.connect({ path: runtime.vncSock })
    : net.connect({ host: '127.0.0.1', port: runtime.vncPort });
  let closed = false;
  const HIGH_WATER = 1024 * 1024;
  const LOW_WATER = 256 * 1024;
  let drainTimer: ReturnType<typeof setInterval> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let pausedAt = 0;
  const debug = vncDebugEnabled();

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (drainTimer) {
      clearInterval(drainTimer);
      drainTimer = null;
    }
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    try {
      tcp.destroy();
    } catch {
      /* ignore */
    }
    try {
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close();
    } catch {
      /* ignore */
    }
  };

  const maybeResume = () => {
    if (closed || !tcp.isPaused()) return;
    const pausedMs = pausedAt ? Date.now() - pausedAt : 0;
    if (ws.bufferedAmount <= LOW_WATER || pausedMs > 200) {
      if (debug && pausedMs > 200) {
        logger.info({ sessionId, bufferedAmount: ws.bufferedAmount, pausedMs }, 'vnc.bridge resume');
      }
      tcp.resume();
      pausedAt = 0;
      if (drainTimer) {
        clearInterval(drainTimer);
        drainTimer = null;
      }
    }
  };

  const armDrain = () => {
    if (drainTimer || closed) return;
    drainTimer = setInterval(maybeResume, 50);
  };

  pingTimer = setInterval(() => {
    if (closed || ws.readyState !== ws.OPEN) return;
    try {
      ws.ping();
    } catch {
      cleanup();
    }
  }, 15000);

  tcp.on('data', (data) => {
    if (ws.readyState !== ws.OPEN) return;
    try {
      ws.send(data, { binary: true });
      if (ws.bufferedAmount > 8 * 1024 * 1024) {
        logger.error({ sessionId, bufferedAmount: ws.bufferedAmount }, 'vnc.bridge overflow');
        cleanup();
        return;
      }
      if (ws.bufferedAmount > HIGH_WATER) {
        if (debug) logger.info({ sessionId, bufferedAmount: ws.bufferedAmount }, 'vnc.bridge pause');
        if (!tcp.isPaused()) pausedAt = Date.now();
        tcp.pause();
        armDrain();
      }
    } catch (err) {
      logger.error({ err, sessionId }, 'vnc send error');
      cleanup();
    }
  });

  tcp.on('error', (err) => {
    logger.error({ err, sessionId }, 'vnc tcp error');
    cleanup();
  });
  tcp.on('close', () => {
    if (debug) logger.info({ sessionId }, 'vnc.bridge tcp close');
    cleanup();
  });
  ws.on('message', (data) => {
    if (!tcp.writable) return;
    const buf = Array.isArray(data)
      ? Buffer.concat(data.map((d) => (Buffer.isBuffer(d) ? d : Buffer.from(d as ArrayBuffer))))
      : Buffer.isBuffer(data)
        ? data
        : Buffer.from(data as ArrayBuffer);
    tcp.write(buf);
    maybeResume();
  });
  ws.on('close', (code) => {
    if (debug) logger.info({ sessionId, code }, 'vnc.bridge close');
    cleanup();
  });
  ws.on('error', (err) => {
    if (debug) logger.info({ err, sessionId }, 'vnc.bridge error');
    cleanup();
  });
}

server.listen(PORT, HOST, () => {
  const publicPath = BASE_PATH === '/' ? '' : BASE_PATH;
  logger.info({ HOST, PORT, BASE_PATH, STATIC_DIR: process.env.STATIC_DIR }, 'Nya Browser listening');
  console.log(`Nya Browser listening on http://${HOST}:${PORT}${publicPath}/`);
});

async function shutdown() {
  console.log('Shutting down...');
  await stopAllSessions();
  server.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
