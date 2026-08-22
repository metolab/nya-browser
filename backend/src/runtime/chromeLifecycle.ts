// Keep every attached page active while a VNC client is connected.
// Remote desktops are not laptop sessions: Chrome must not freeze
// renderers from IdleDetector / page lifecycle.
import http from 'http';
import WebSocket from 'ws';

type TargetInfo = {
  targetId?: string;
  type?: string;
};

type CdpMessage = {
  id?: number;
  method?: string;
  params?: {
    sessionId?: string;
    targetInfo?: TargetInfo;
    targetId?: string;
  };
  result?: {
    targetInfos?: TargetInfo[];
  };
};

type LifecycleState = {
  ws: WebSocket;
  nextId: number;
  sessions: Set<string>;
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

function attachPage(state: LifecycleState, targetId?: string) {
  if (!targetId) return;
  send(state, {
    method: 'Target.attachToTarget',
    params: { targetId, flatten: true },
  });
}

function connectBrowser(sessionId: string, url: string) {
  return new Promise<void>((resolve) => {
    const ws = new WebSocket(url);
    const state: LifecycleState = { ws, nextId: 0, sessions: new Set(), closed: false };
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
      done();
    });
    ws.on('message', (raw) => {
      let msg: CdpMessage;
      try {
        msg = JSON.parse(String(raw)) as CdpMessage;
      } catch {
        return;
      }
      if (msg.method === 'Target.attachedToTarget') {
        const session = msg.params?.sessionId;
        if (!session || !isPageTarget(msg.params?.targetInfo)) return;
        state.sessions.add(session);
        activateSession(state, session);
        return;
      }
      if (msg.method === 'Target.detachedFromTarget') {
        if (msg.params?.sessionId) state.sessions.delete(msg.params.sessionId);
        return;
      }
      if (msg.method === 'Target.targetCreated' && isPageTarget(msg.params?.targetInfo)) {
        attachPage(state, msg.params?.targetInfo?.targetId);
        return;
      }
      if (msg.result?.targetInfos) {
        for (const info of msg.result.targetInfos) {
          if (isPageTarget(info)) attachPage(state, info.targetId);
        }
      }
    });
    ws.on('error', (err) => {
      console.warn(`[chrome-lifecycle] session=${sessionId}`, err.message);
      done();
    });
    ws.on('close', () => {
      if (attached.get(sessionId) === state) attached.delete(sessionId);
    });
  });
}

export function stopChromeLifecycle(sessionId: string) {
  const state = attached.get(sessionId);
  if (!state) return;
  state.closed = true;
  attached.delete(sessionId);
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
