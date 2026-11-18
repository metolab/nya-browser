import { STATUS_CODES, type IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import { AUDIT_ACTIONS } from '@nya/shared';
import { logger } from '../../logger.js';
import { HttpError } from '../../http/access.js';
import { resolveAuth } from '../auth/service.js';
import { writeAudit } from '../audit/service.js';
import { downloadsDir, getSession, userCanAccessSession } from '../../store.js';
import { cdpClientCount, getRuntime, registerCdpClient } from '../../runtime/sessionManager.js';
import { TARGET_ID_RE, browserVersion, sessionCdpPort } from './upstream.js';
import { nudgeWebAuthn } from '../../runtime/webauthn.js';

const MAX_PAYLOAD = 256 * 1024 * 1024;
const MAX_CLIENTS_PER_SESSION = 8;
const UPSTREAM_OPEN_TIMEOUT_MS = 10_000;
const HIGH_WATER = 16 * 1024 * 1024;
const LOW_WATER = 4 * 1024 * 1024;
const PING_INTERVAL_MS = 20_000;

/** Close codes surfaced to SDK clients. */
export const CDP_CLOSE = {
  sessionStopped: 4001,
  browserClosed: 4002,
} as const;

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false });

type BridgeContext = {
  sessionId: string;
  label: string;
  downloadPath: string;
  actor: string;
};

type Filtered = { forward?: string; reply?: Record<string, unknown>; close?: boolean };

function rejectUpgrade(socket: Duplex, status: number, error: string, code?: string) {
  if (socket.destroyed) return;
  const body = JSON.stringify(code ? { error, code } : { error });
  socket.write(
    `HTTP/1.1 ${status} ${STATUS_CODES[status] || 'Error'}\r\n` +
      'Content-Type: application/json\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      'Connection: close\r\n\r\n' +
      body,
  );
  socket.destroy();
}

function readToken(req: IncomingMessage, url: URL) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey) return apiKey;
  return url.searchParams.get('token') || '';
}

function clientIp(req: IncomingMessage) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf) return xf.split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

/**
 * Keep remote agents from tearing down or redirecting the shared session:
 * Browser.close only drops this client, crash commands are refused, download
 * behavior always points at the session files directory, and WebAuthn stays
 * with the server while it holds the session's passkeys.
 */
function filterCommand(raw: string, ctx: BridgeContext): Filtered {
  if (!raw.includes('Browser.') && !raw.includes('setDownloadBehavior') && !raw.includes('WebAuthn.')) {
    return { forward: raw };
  }
  let msg: { id?: number; sessionId?: string; method?: string; params?: Record<string, unknown> };
  try {
    msg = JSON.parse(raw);
  } catch {
    return { forward: raw };
  }
  const ack = (body: Record<string, unknown>) => ({
    id: msg.id,
    ...(msg.sessionId ? { sessionId: msg.sessionId } : {}),
    ...body,
  });
  if (msg.method?.startsWith('WebAuthn.') && getSession(ctx.sessionId)?.webauthn.enabled) {
    if (msg.method === 'WebAuthn.enable' || msg.method === 'WebAuthn.disable') return { reply: ack({ result: {} }) };
    return {
      reply: ack({
        error: {
          code: -32000,
          message: `WebAuthn is managed by nya-browser for this session; use /api/sessions/${ctx.sessionId}/passkeys`,
        },
      }),
    };
  }
  switch (msg.method) {
    case 'Browser.close':
      return { reply: ack({ result: {} }), close: true };
    case 'Browser.crash':
    case 'Browser.crashGpuProcess':
      return { reply: ack({ error: { code: -32000, message: 'Not allowed by nya-browser' } }) };
    case 'Browser.setDownloadBehavior':
    case 'Page.setDownloadBehavior': {
      const behavior = msg.params?.behavior;
      if (behavior === 'allow' || behavior === 'allowAndName') {
        msg.params = { ...msg.params, behavior: 'allow', downloadPath: ctx.downloadPath };
        return { forward: JSON.stringify(msg) };
      }
      if (behavior === 'deny') return { reply: ack({ result: {} }) };
      return { forward: raw };
    }
    default:
      return { forward: raw };
  }
}

function openUpstream(url: string) {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url, { maxPayload: MAX_PAYLOAD, perMessageDeflate: false });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('upstream open timeout'));
    }, UPSTREAM_OPEN_TIMEOUT_MS);
    ws.once('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function bridge(client: WebSocket, upstream: WebSocket, ctx: BridgeContext) {
  const startedAt = Date.now();
  let closed = false;
  let paused = false;
  let alive = true;
  let drainTimer: ReturnType<typeof setInterval> | null = null;

  registerCdpClient(ctx.sessionId, client);

  const pingTimer = setInterval(() => {
    if (!alive) {
      client.terminate();
      return;
    }
    alive = false;
    try {
      client.ping();
    } catch {
      /* close handler cleans up */
    }
  }, PING_INTERVAL_MS);
  client.on('pong', () => {
    alive = true;
  });

  const shutdown = (code: number, reason: string) => {
    if (closed) return;
    closed = true;
    clearInterval(pingTimer);
    if (drainTimer) clearInterval(drainTimer);
    try {
      if (client.readyState === WebSocket.OPEN) client.close(code, reason);
    } catch {
      client.terminate();
    }
    try {
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
    } catch {
      upstream.terminate();
    }
    logger.info(
      { sessionId: ctx.sessionId, target: ctx.label, actor: ctx.actor, code, reason, ms: Date.now() - startedAt },
      'cdp.disconnect',
    );
    // Chrome drops a tab's virtual authenticator when any DevTools session leaves it.
    nudgeWebAuthn(ctx.sessionId);
  };

  const resumeWhenDrained = () => {
    if (drainTimer || closed) return;
    drainTimer = setInterval(() => {
      if (closed || client.bufferedAmount > LOW_WATER) return;
      if (drainTimer) clearInterval(drainTimer);
      drainTimer = null;
      paused = false;
      upstream.resume();
    }, 50);
  };

  upstream.on('message', (data: RawData, isBinary: boolean) => {
    if (client.readyState !== WebSocket.OPEN) return;
    if (!isBinary && Buffer.isBuffer(data) && data.length < 4096 && data.includes('Target.detachedFromTarget')) {
      nudgeWebAuthn(ctx.sessionId);
    }
    client.send(data, { binary: isBinary });
    if (!paused && client.bufferedAmount > HIGH_WATER) {
      paused = true;
      upstream.pause();
      resumeWhenDrained();
    }
  });

  client.on('message', (data: RawData, isBinary: boolean) => {
    if (upstream.readyState !== WebSocket.OPEN) return;
    if (isBinary) {
      upstream.send(data, { binary: true });
      return;
    }
    const result = filterCommand(data.toString(), ctx);
    if (result.forward !== undefined) upstream.send(result.forward);
    if (result.reply) client.send(JSON.stringify(result.reply));
    if (result.close) setTimeout(() => shutdown(1000, 'closed by client'), 50);
  });

  upstream.on('close', () => {
    const running = Boolean(getRuntime(ctx.sessionId));
    shutdown(
      running ? CDP_CLOSE.browserClosed : CDP_CLOSE.sessionStopped,
      running ? 'browser_closed' : 'session_stopped',
    );
  });
  upstream.on('error', (err) => {
    logger.warn({ err, sessionId: ctx.sessionId }, 'cdp upstream error');
  });
  client.on('close', () => shutdown(1000, 'client closed'));
  client.on('error', (err) => {
    logger.warn({ err, sessionId: ctx.sessionId }, 'cdp client error');
  });
  if (upstream.readyState !== WebSocket.OPEN) shutdown(CDP_CLOSE.browserClosed, 'browser_closed');
}

/** Handle `${BASE_PATH}/ws/cdp/:sessionId[/page/:targetId]` upgrades. */
export async function handleCdpUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  url: URL,
  prefix: string,
) {
  const parts = url.pathname.slice(prefix.length).split('/').filter(Boolean).map(decodeURIComponent);
  const sessionId = parts[0] || '';
  const targetId = parts.length === 3 && parts[1] === 'page' ? parts[2] : null;
  if (!sessionId || (parts.length !== 1 && !targetId)) return rejectUpgrade(socket, 404, 'Not found');
  if (targetId && !TARGET_ID_RE.test(targetId)) return rejectUpgrade(socket, 400, 'Invalid target id');

  const auth = resolveAuth(readToken(req, url));
  if (!auth) return rejectUpgrade(socket, 401, 'Unauthorized');
  const { user, apiKeyId } = auth;
  if (!getSession(sessionId)) return rejectUpgrade(socket, 404, 'Not found');
  if (user.role !== 'admin' && !userCanAccessSession(user.id, sessionId)) {
    return rejectUpgrade(socket, 403, 'Forbidden');
  }
  if (cdpClientCount(sessionId) >= MAX_CLIENTS_PER_SESSION) {
    return rejectUpgrade(socket, 429, 'Too many CDP clients for this session', 'CDP_CLIENT_LIMIT');
  }

  let upstreamUrl: string;
  try {
    const port = sessionCdpPort(sessionId);
    upstreamUrl = targetId
      ? `ws://127.0.0.1:${port}/devtools/page/${targetId}`
      : String((await browserVersion(port)).webSocketDebuggerUrl);
  } catch (err) {
    if (err instanceof HttpError) {
      return rejectUpgrade(socket, err.status, err.message, err.body.code as string | undefined);
    }
    throw err;
  }

  let upstream: WebSocket;
  try {
    upstream = await openUpstream(upstreamUrl);
  } catch (err) {
    logger.warn({ err, sessionId, targetId }, 'cdp upstream connect failed');
    return rejectUpgrade(socket, 502, 'Cannot reach browser CDP', 'CDP_UPSTREAM');
  }
  if (socket.destroyed) {
    upstream.close();
    return;
  }

  const label = targetId ? `page/${targetId}` : 'browser';
  writeAudit({
    actorId: user.id,
    actorUsername: user.username,
    action: AUDIT_ACTIONS.cdpConnect,
    resourceType: 'session',
    resourceId: targetId ? `${sessionId}/${label}` : sessionId,
    ip: clientIp(req),
    success: true,
    detail: apiKeyId ? { apiKeyId } : null,
  });

  wss.handleUpgrade(req, socket, head, (client) => {
    bridge(client, upstream, {
      sessionId,
      label,
      downloadPath: downloadsDir(sessionId),
      actor: user.username,
    });
  });
}
