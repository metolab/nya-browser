import http from 'http';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { WebSocket } = require('ws');

const API = process.env.NYA_API || 'http://127.0.0.1:8080';
const USER = process.env.INIT_ADMIN_USER || 'admin';
const PASSWORD = process.env.INIT_ADMIN_PASSWORD || 'gputest-1080ti';
const PROFILE = process.env.NYA_FONT_PROFILE || 'win10';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = { ...(opts.headers || {}) };
    let body = opts.body;
    if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
      body = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 80,
        path: `${u.pathname}${u.search}`,
        method: opts.method || 'GET',
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          const cookies = res.headers['set-cookie'] || [];
          let data = raw;
          try {
            data = raw ? JSON.parse(raw) : {};
          } catch {
            data = { _text: raw };
          }
          resolve({ status: res.statusCode, data, cookies });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function cookieHeader(cookies) {
  return cookies
    .map((c) => String(c).split(';')[0])
    .filter(Boolean)
    .join('; ');
}

const FONT_EXPR = `(() => {
  const sample = 'mmmmmmmmmmlliWw@';
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = '72px monospace';
  const mono = ctx.measureText(sample).width;
  ctx.font = '72px sans-serif';
  const sans = ctx.measureText(sample).width;
  const detect = (name) => {
    ctx.font = '72px "' + name + '", monospace';
    const w1 = ctx.measureText(sample).width;
    ctx.font = '72px "' + name + '", sans-serif';
    const w2 = ctx.measureText(sample).width;
    return {
      check: document.fonts.check('16px "' + name + '"'),
      installed: w1 !== mono || w2 !== sans,
      wMono: Math.round(w1),
      wSans: Math.round(w2),
    };
  };
  return Promise.resolve().then(async () => {
    let localFonts = { ok: false, count: 0, families: [], error: null };
    try {
      if (typeof queryLocalFonts === 'function') {
        const list = await queryLocalFonts();
        localFonts = {
          ok: true,
          count: list.length,
          families: list.slice(0, 12).map((f) => f.family),
          hasArial: list.some((f) => f.family === 'Arial'),
          hasNoto: list.some((f) => /Noto|DejaVu/i.test(f.family)),
          error: null,
        };
      } else {
        localFonts.error = 'queryLocalFonts missing';
      }
    } catch (err) {
      localFonts.error = err && err.message ? err.message : String(err);
    }
    return {
      href: location.href,
      baselines: { mono: Math.round(mono), sans: Math.round(sans) },
      arial: detect('Arial'),
      calibri: detect('Calibri'),
      segoe: detect('Segoe UI'),
      impact: detect('Impact'),
      times: detect('Times New Roman'),
      noto: detect('Noto Sans CJK SC'),
      dejavu: detect('DejaVu Sans'),
      localFonts,
    };
  });
})()`;

async function main() {
  const login = await fetchJson(`${API}/api/login`, {
    method: 'POST',
    body: { username: USER, password: PASSWORD },
  });
  if (login.status !== 200) throw new Error(`login ${login.status}`);
  const cookie = cookieHeader(login.cookies);
  const created = await fetchJson(`${API}/api/sessions`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: {
      name: `fp-font-${Date.now()}`,
      gpuProfile: 'rtx-2080',
      fontProfile: PROFILE,
      webrtcMode: 'offline',
      homeUrl: 'https://example.com/',
    },
  });
  const session = created.data.session;
  const started = await fetchJson(`${API}/api/sessions/${session.id}/start`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: {},
  });
  const port = started.data.runtime?.cdpPort;
  if (!port) throw new Error('no cdp');
  await sleep(2000);
  let version = null;
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetchJson(`http://127.0.0.1:${port}/json/version`);
      if (res.data?.webSocketDebuggerUrl) {
        version = res.data;
        break;
      }
    } catch {
      /* wait */
    }
    await sleep(400);
  }
  if (!version) throw new Error('no cdp version');
  let pageTarget = null;
  for (let i = 0; i < 20; i += 1) {
    try {
      const list = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const targets = Array.isArray(list.data) ? list.data : [];
      pageTarget = targets.find((t) => t.type === 'page' && /^https?:/i.test(t.url || ''));
      if (pageTarget?.webSocketDebuggerUrl) break;
    } catch {
      /* wait */
    }
    await sleep(400);
  }
  if (!pageTarget?.webSocketDebuggerUrl) throw new Error('no page target');
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  let nextId = 0;
  const pending = new Map();
  ws.on('message', (buf) => {
    const msg = JSON.parse(String(buf));
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  const send = (method, params = {}) => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`timeout ${method}`));
        }
      }, 20000);
    });
  };
  await send('Runtime.enable');
  await send('Page.enable');
  if (!/example\.com/i.test(pageTarget.url || '')) {
    try {
      await send('Page.navigate', { url: 'https://example.com/' });
    } catch {
      /* ignore */
    }
    await sleep(1500);
  }
  const ev = await send('Runtime.evaluate', {
    expression: FONT_EXPR,
    awaitPromise: true,
    returnByValue: true,
  });
  const value = ev?.result?.value;
  ws.close();
  try {
    await fetchJson(`${API}/api/sessions/${session.id}/stop`, { method: 'POST', headers: { Cookie: cookie }, body: {} });
  } catch {
    /* ignore */
  }
  try {
    await fetchJson(`${API}/api/sessions/${session.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
  } catch {
    /* ignore */
  }

  const spoofing = PROFILE !== 'native';
  const checks = {
    arialMetrics: value?.arial?.installed === true,
    calibriMetrics: value?.calibri?.installed === true,
    segoeMetrics: value?.segoe?.installed === true,
    impactMetrics: value?.impact?.installed === true,
    notoHidden: value?.noto?.installed === false,
    dejavuHidden: value?.dejavu?.installed === false,
    arialCheck: spoofing ? value?.arial?.check === true : true,
    notoCheck: spoofing ? value?.noto?.check === false : true,
    localFonts: !spoofing || value?.localFonts?.ok === true,
    localHasArial: !spoofing || value?.localFonts?.hasArial === true,
    localNoLinux: !spoofing || value?.localFonts?.hasNoto === false,
  };
  const report = {
    stored: session.fingerprint.fontProfile,
    page: value,
    checks,
  };
  report.ok = Object.values(checks).every(Boolean);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
