// Minimal Nya API + CDP client on Node 22 built-ins (global fetch / WebSocket).
export const API = process.env.NYA_API || 'http://127.0.0.1:8080';
const USER = process.env.INIT_ADMIN_USER || 'admin';
const PASSWORD = process.env.INIT_ADMIN_PASSWORD || process.env.AUTH_PASSWORD || 'testpass';

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function login() {
  const res = await fetch(`${API}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie') || ''];
  return cookies.map((c) => String(c).split(';')[0]).filter(Boolean).join('; ');
}

export async function api(cookie, path, method = 'GET', body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { _text: text };
  }
  if (res.status >= 400) {
    const err = new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function deleteSessionsByPrefix(cookie, prefix) {
  const list = await api(cookie, '/api/sessions').catch(() => ({ sessions: [] }));
  for (const session of list.sessions || list || []) {
    if (!String(session.name || '').startsWith(prefix)) continue;
    await api(cookie, `/api/sessions/${session.id}/stop`, 'POST').catch(() => {});
    await api(cookie, `/api/sessions/${session.id}`, 'DELETE').catch(() => {});
  }
}

export function openCdp(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  const listeners = new Set();
  let nextId = 0;
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error(`CDP connect failed: ${url}`)), { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject, timer } = pending.get(msg.id);
      clearTimeout(timer);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message || 'CDP error'} (${msg.error.code})`));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg);
    }
  });
  const send = (method, params = {}, timeoutMs = 60000) => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  return {
    ready,
    send,
    on: (fn) => listeners.add(fn),
    close: () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

export async function waitBrowser(cdpPort, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      const ver = await res.json();
      if (ver.webSocketDebuggerUrl) return ver;
    } catch {
      /* chrome not ready */
    }
    await sleep(400);
  }
  throw new Error(`Chrome CDP not ready on ${cdpPort}`);
}

export async function listTargets(cdpPort) {
  const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
  return res.json();
}

/** Open url in a fresh tab and return a page CDP socket on it. */
export async function openPage(cdpPort, browser, url) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  let target = null;
  const started = Date.now();
  while (!target && Date.now() - started < 20000) {
    target = (await listTargets(cdpPort)).find((t) => t.id === targetId);
    if (!target) await sleep(200);
  }
  if (!target?.webSocketDebuggerUrl) throw new Error('new tab not visible in /json/list');
  const page = openCdp(target.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Page.navigate', { url });
  page.targetId = targetId;
  return page;
}

export async function evaluate(page, expression, { awaitPromise = true, timeoutMs = 60000 } = {}) {
  let lastErr;
  for (let i = 0; i < 10; i += 1) {
    try {
      const r = await page.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }, timeoutMs);
      if (r?.exceptionDetails) {
        throw new Error(`evaluate failed: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      }
      return r?.result?.value;
    } catch (err) {
      lastErr = err;
      if (!/context|navigated|session|Cannot find/i.test(String(err.message))) throw err;
      await sleep(400);
    }
  }
  throw lastErr;
}
