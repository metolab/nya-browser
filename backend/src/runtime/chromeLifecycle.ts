// Keep every attached page active while a VNC client is connected.
// Remote desktops are not laptop sessions: Chrome must not freeze
// renderers from IdleDetector / page lifecycle.
import http from 'http';
import WebSocket from 'ws';
import { TAMPERMONKEY_ID, isTampermonkeyIntroUrl, resolveTampermonkeyDir } from './tampermonkey.js';

type TargetInfo = {
  targetId?: string;
  type?: string;
  url?: string;
};

type CdpMessage = {
  id?: number;
  method?: string;
  error?: { message?: string };
  params?: {
    sessionId?: string;
    targetInfo?: TargetInfo;
    targetId?: string;
  };
  result?: {
    targetInfos?: TargetInfo[];
    targetId?: string;
    sessionId?: string;
    result?: { value?: unknown };
  };
};

type PendingCall = {
  resolve: (value: CdpMessage['result']) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type LifecycleState = {
  ws: WebSocket;
  nextId: number;
  sessions: Set<string>;
  pending: Map<number, PendingCall>;
  closed: boolean;
};

const attached = new Map<string, LifecycleState>();

function getJson(url: string, timeoutMs = 3000) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(buf) as Record<string, unknown>);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('cdp timeout'));
    });
  });
}

function send(state: LifecycleState, payload: Record<string, unknown>) {
  if (state.closed || state.ws.readyState !== WebSocket.OPEN) return;
  state.nextId += 1;
  state.ws.send(JSON.stringify({ id: state.nextId, ...payload }));
}

function call(
  state: LifecycleState,
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string,
  timeoutMs = 8000,
) {
  return new Promise<CdpMessage['result']>((resolve, reject) => {
    if (state.closed || state.ws.readyState !== WebSocket.OPEN) {
      reject(new Error('cdp closed'));
      return;
    }
    state.nextId += 1;
    const id = state.nextId;
    const timer = setTimeout(() => {
      if (!state.pending.has(id)) return;
      state.pending.delete(id);
      reject(new Error(`cdp timeout ${method}`));
    }, timeoutMs);
    state.pending.set(id, { resolve, reject, timer });
    const body: Record<string, unknown> = { id, method, params };
    if (sessionId) body.sessionId = sessionId;
    state.ws.send(JSON.stringify(body));
  });
}

function settle(state: LifecycleState, msg: CdpMessage) {
  if (typeof msg.id !== 'number') return;
  const pending = state.pending.get(msg.id);
  if (!pending) return;
  state.pending.delete(msg.id);
  clearTimeout(pending.timer);
  if (msg.error) {
    pending.reject(new Error(msg.error.message || 'cdp error'));
    return;
  }
  pending.resolve(msg.result);
}

function rejectAll(state: LifecycleState, err: Error) {
  for (const pending of state.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(err);
  }
  state.pending.clear();
}

function activateSession(state: LifecycleState, sessionId: string) {
  send(state, {
    sessionId,
    method: 'Page.setWebLifecycleState',
    params: { state: 'active' },
  });
  send(state, {
    sessionId,
    method: 'Emulation.setIdleOverride',
    params: { isUserActive: true, isScreenUnlocked: true },
  });
}

function isPageTarget(info?: TargetInfo) {
  return info?.type === 'page' || info?.type === 'webview';
}

function closeTarget(state: LifecycleState, targetId?: string) {
  if (!targetId) return;
  send(state, { method: 'Target.closeTarget', params: { targetId } });
}

function maybeCloseIntro(state: LifecycleState, info?: TargetInfo) {
  if (!isTampermonkeyIntroUrl(info?.url)) return false;
  closeTarget(state, info?.targetId);
  return true;
}

function attachPage(state: LifecycleState, targetId?: string) {
  if (!targetId) return;
  send(state, {
    method: 'Target.attachToTarget',
    params: { targetId, flatten: true },
  });
}

async function enableTampermonkeyUserScripts(state: LifecycleState) {
  if (!resolveTampermonkeyDir()) return;
  const created = await call(state, 'Target.createTarget', {
    url: `chrome://extensions/?id=${TAMPERMONKEY_ID}`,
  });
  const targetId = String(created?.targetId || '');
  if (!targetId) throw new Error('no extensions target');
  try {
    const attachedTarget = await call(state, 'Target.attachToTarget', {
      targetId,
      flatten: true,
    });
    const sessionId = String(attachedTarget?.sessionId || '');
    if (!sessionId) throw new Error('no extensions session');
    const evaluated = await call(
      state,
      'Runtime.evaluate',
      {
        expression: `(() => new Promise((resolve) => {
          const deadline = Date.now() + 5000;
          const tick = async () => {
            const api = globalThis.chrome && globalThis.chrome.developerPrivate;
            if (api && api.updateExtensionConfiguration) {
              try {
                await api.updateProfileConfiguration({ inDeveloperMode: true });
                await api.updateExtensionConfiguration({
                  extensionId: ${JSON.stringify(TAMPERMONKEY_ID)},
                  userScriptsAccess: true,
                  pinnedToToolbar: true,
                });
                resolve('ok');
              } catch (err) {
                resolve(String(err && err.message ? err.message : err));
              }
              return;
            }
            if (Date.now() > deadline) {
              resolve('no-api');
              return;
            }
            setTimeout(tick, 100);
          };
          tick();
        }))()`,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
      8000,
    );
    const value = evaluated?.result?.value;
    if (value !== 'ok') {
      throw new Error(String(value || 'enable failed'));
    }
  } finally {
    try {
      await call(state, 'Target.closeTarget', { targetId }, undefined, 3000);
    } catch {
      closeTarget(state, targetId);
    }
  }
}

function connectBrowser(sessionId: string, url: string) {
  return new Promise<void>((resolve) => {
    const ws = new WebSocket(url);
    const state: LifecycleState = {
      ws,
      nextId: 0,
      sessions: new Set(),
      pending: new Map(),
      closed: false,
    };
    attached.set(sessionId, state);
    const done = () => resolve();
    ws.once('open', () => {
      send(state, {
        method: 'Target.setAutoAttach',
        params: { autoAttach: true, flatten: true, waitForDebuggerOnStart: false },
      });
      send(state, {
        method: 'Target.setDiscoverTargets',
        params: { discover: true },
      });
      send(state, { method: 'Target.getTargets' });
      setTimeout(() => {
        void enableTampermonkeyUserScripts(state).catch((err) => {
          console.warn(`[chrome-lifecycle] session=${sessionId} tampermonkey:`, err.message);
        });
      }, 1500);
      done();
    });
    ws.on('message', (raw) => {
      let msg: CdpMessage;
      try {
        msg = JSON.parse(String(raw)) as CdpMessage;
      } catch {
        return;
      }
      settle(state, msg);
      if (msg.method === 'Target.attachedToTarget') {
        const session = msg.params?.sessionId;
        const info = msg.params?.targetInfo;
        if (maybeCloseIntro(state, info)) return;
        if (!session || !isPageTarget(info)) return;
        state.sessions.add(session);
        activateSession(state, session);
        return;
      }
      if (msg.method === 'Target.detachedFromTarget') {
        if (msg.params?.sessionId) state.sessions.delete(msg.params.sessionId);
        return;
      }
      if (msg.method === 'Target.targetCreated' || msg.method === 'Target.targetInfoChanged') {
        const info = msg.params?.targetInfo;
        if (maybeCloseIntro(state, info)) return;
        if (msg.method === 'Target.targetCreated' && isPageTarget(info)) {
          attachPage(state, info?.targetId);
        }
        return;
      }
      if (msg.result?.targetInfos) {
        for (const info of msg.result.targetInfos) {
          if (maybeCloseIntro(state, info)) continue;
          if (isPageTarget(info)) attachPage(state, info.targetId);
        }
      }
    });
    ws.on('error', (err) => {
      console.warn(`[chrome-lifecycle] session=${sessionId}`, err.message);
      rejectAll(state, err);
      done();
    });
    ws.on('close', () => {
      rejectAll(state, new Error('cdp closed'));
      if (attached.get(sessionId) === state) attached.delete(sessionId);
    });
  });
}

export function stopChromeLifecycle(sessionId: string) {
  const state = attached.get(sessionId);
  if (!state) return;
  state.closed = true;
  attached.delete(sessionId);
  rejectAll(state, new Error('cdp closed'));
  try {
    state.ws.close();
  } catch {
    /* ignore */
  }
}

export function hasChromeLifecycle(sessionId: string) {
  const state = attached.get(sessionId);
  return Boolean(state && !state.closed && state.ws.readyState === WebSocket.OPEN);
}

export async function startChromeLifecycle(sessionId: string, cdpPort: number | null) {
  stopChromeLifecycle(sessionId);
  if (!cdpPort) return;
  const deadline = Date.now() + 15000;
  let wsUrl = '';
  while (Date.now() < deadline) {
    try {
      const version = await getJson(`http://127.0.0.1:${cdpPort}/json/version`);
      wsUrl = String(version.webSocketDebuggerUrl || '');
      if (wsUrl) break;
    } catch {
      /* Chrome is still binding the debug port */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!wsUrl) {
    console.warn(`[chrome-lifecycle] session=${sessionId} no CDP`);
    return;
  }
  await connectBrowser(sessionId, wsUrl);
}
