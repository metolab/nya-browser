import { execFileSync, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { WebSocket } from 'ws';

const API = process.env.NYA_API || 'http://127.0.0.1:8080';
const PASSWORD = process.env.AUTH_PASSWORD || 'testpass';
const DATA_DIR = process.env.DATA_DIR || '/data';
const xclipHolders = [];

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
          resolve({ status: res.statusCode, data, cookies, raw });
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

async function login() {
  const res = await fetchJson(`${API}/api/login`, {
    method: 'POST',
    body: { password: PASSWORD },
  });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.data)}`);
  return cookieHeader(res.cookies);
}

async function api(cookie, p, method = 'GET', body) {
  const res = await fetchJson(`${API}${p}`, {
    method,
    headers: { Cookie: cookie },
    body,
  });
  if (res.status >= 400) {
    throw new Error(`${method} ${p} -> ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

async function cdpConnect(port) {
  const started = Date.now();
  let version = null;
  while (Date.now() - started < 40000) {
    try {
      const { data } = await fetchJson(`http://127.0.0.1:${port}/json/version`);
      if (data?.webSocketDebuggerUrl) {
        version = data;
        break;
      }
    } catch {
      /* chrome not ready */
    }
    await sleep(400);
  }
  if (!version) throw new Error(`No CDP browser on port ${port}`);

  const ws = new WebSocket(version.webSocketDebuggerUrl);
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
      if (msg.error) reject(new Error(`${msg.error.message || 'CDP error'} (${msg.error.code})`));
      else resolve(msg.result);
    }
  });

  const send = (method, params = {}, sessionId) => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 40000);
    });
  };

  return {
    send,
    close: () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

async function attachPage(browser, targetId) {
  const attached = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const sessionId = attached.sessionId;
  const send = (method, params = {}) => browser.send(method, params, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  return {
    send,
    async evaluate(expression, awaitPromise = true) {
      const result = await send('Runtime.evaluate', {
        expression,
        awaitPromise,
        returnByValue: true,
        timeout: 45000,
      });
      if (result?.exceptionDetails) {
        const desc =
          result.exceptionDetails.exception?.description || result.exceptionDetails.text;
        throw new Error(`evaluate failed: ${desc}`);
      }
      return result?.result?.value;
    },
    async navigate(url, settleMs = 1500) {
      await send('Page.navigate', { url }).catch(() => undefined);
      await sleep(settleMs);
    },
  };
}

function sessionHome(id) {
  return path.join(DATA_DIR, 'sessions', id);
}

function chromeProfile(id) {
  return path.join(sessionHome(id), 'chrome');
}

function runDisplay(display, authFile, file, args, timeout = 8000) {
  return execFileSync(file, args, {
    encoding: 'utf8',
    timeout,
    env: {
      ...process.env,
      DISPLAY: `:${display}`,
      XAUTHORITY: authFile,
    },
  });
}

function chromeBrowserCount(userDataDir) {
  let out = '';
  try {
    out = execFileSync('ps', ['-eo', 'args='], { encoding: 'utf8' });
  } catch {
    return 0;
  }
  return out.split('\n').filter((line) => {
    if (!line.includes(`--user-data-dir=${userDataDir}`)) return false;
    if (line.includes('--type=')) return false;
    return true;
  }).length;
}

function xdotoolChromeIds(display, authFile) {
  const classes = ['chromium', 'Chromium', 'chromium-browser', 'Chromium-browser'];
  const ids = [];
  for (const cls of classes) {
    try {
      const raw = runDisplay(display, authFile, 'xdotool', [
        'search',
        '--onlyvisible',
        '--class',
        cls,
      ]);
      ids.push(...String(raw).trim().split(/\s+/).filter(Boolean));
    } catch {
      /* class missing */
    }
  }
  return [...new Set(ids)];
}

function xclipSet(display, authFile, text) {
  const child = spawn('xclip', ['-selection', 'clipboard', '-i'], {
    env: { ...process.env, DISPLAY: `:${display}`, XAUTHORITY: authFile },
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  child.stdin.end(text);
  xclipHolders.push(child);
}

function killXclipHolders() {
  for (const child of xclipHolders) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
  xclipHolders.length = 0;
}

function xclipGet(display, authFile) {
  try {
    return execFileSync('timeout', ['1', 'xclip', '-selection', 'clipboard', '-o'], {
      encoding: 'utf8',
      env: { ...process.env, DISPLAY: `:${display}`, XAUTHORITY: authFile },
    });
  } catch {
    return '';
  }
}

function rfbHandshake(cookie, pathName, timeoutMs = 8000) {
  const u = new URL(API);
  const host = u.hostname;
  const port = Number(u.port || 80);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}:${port}${pathName}`, {
      headers: { Cookie: cookie },
    });
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      reject(new Error(`RFB timeout ${pathName}`));
    }, timeoutMs);
    ws.on('message', (data) => {
      const s = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      if (s.startsWith('RFB')) {
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        resolve(s.slice(0, 12));
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function waitUntil(fn, timeoutMs, label) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const v = await fn();
      if (v) return v;
      last = v;
    } catch (err) {
      last = err;
    }
    await sleep(300);
  }
  throw new Error(`timeout ${label}: ${last}`);
}

async function main() {
  const checks = {};
  const fail = (name, err) => {
    checks[name] = { ok: false, error: String(err?.message || err) };
  };
  const ok = (name, extra = {}) => {
    checks[name] = { ok: true, ...extra };
  };

  const cookie = await login();
  const created = await api(cookie, '/api/sessions', 'POST', {
    name: 'e2e-multi-display',
    proxy: { type: 'none' },
  });
  const session = created.session;
  const started = await api(cookie, `/api/sessions/${session.id}/start`, 'POST');
  const runtime = started.runtime;
  if (!runtime?.cdpPort) throw new Error('session has no cdpPort');

  await sleep(2500);
  const subRes = await api(cookie, `/api/sessions/${session.id}/subs`, 'POST', {
    url: 'about:blank',
  });
  const sub = subRes.sub;
  const listed = await api(cookie, '/api/sessions');
  const sess = (listed.sessions || []).find((s) => s.id === session.id);
  const mainDisplay = sess?.runtime?.display ?? runtime.display;
  const subDisplay = sub.display;
  const authFile = path.join(sessionHome(session.id), '.Xauthority');
  const profile = chromeProfile(session.id);

  try {
    const browsers = chromeBrowserCount(profile);
    const lock = path.join(profile, 'SingletonLock');
    const profiles = [profile].filter((p) => fs.existsSync(p));
    if (browsers !== 1) throw new Error(`browser processes=${browsers}`);
    try {
      fs.lstatSync(lock);
    } catch {
      throw new Error('missing SingletonLock');
    }
    if (profiles.length !== 1) throw new Error('expected one user-data-dir');
    ok('singleton', { browsers, lock: true });
  } catch (err) {
    fail('singleton', err);
  }

  try {
    await waitUntil(() => xdotoolChromeIds(mainDisplay, authFile).length > 0, 15000, 'main chrome');
    await waitUntil(() => xdotoolChromeIds(subDisplay, authFile).length > 0, 15000, 'sub chrome');
    const mainSock = path.join(sessionHome(session.id), 'vnc.sock');
    const subSock = path.join(sessionHome(session.id), `vnc-sub-${sub.id}.sock`);
    if (!fs.existsSync(mainSock) || !fs.existsSync(subSock)) {
      throw new Error('missing vnc socks');
    }
    ok('twoX', { mainDisplay, subDisplay, mainIds: xdotoolChromeIds(mainDisplay, authFile), subIds: xdotoolChromeIds(subDisplay, authFile) });
  } catch (err) {
    fail('twoX', err);
  }

  const listedAfterSub = await api(cookie, '/api/sessions');
  const sessAfterSub = (listedAfterSub.sessions || []).find((s) => s.id === session.id);
  const cdpPort = sessAfterSub?.runtime?.cdpPort || runtime.cdpPort;
  const browser = await cdpConnect(cdpPort);
  try {
    const { targetInfos } = await browser.send('Target.getTargets');
    const pages = (targetInfos || []).filter((t) => {
      if (t.type !== 'page') return false;
      const url = String(t.url || '');
      return !url.startsWith('chrome://') && !url.startsWith('chrome-extension://');
    });
    if (pages.length < 2) throw new Error(`expected 2 pages, got ${pages.length}`);
    const a = await attachPage(browser, pages[0].targetId);
    const b = await attachPage(browser, pages[1].targetId);
    const inputPage =
      'data:text/html,<!doctype html><input id=i autofocus style="font-size:40px">';
    await a.navigate(inputPage, 800);
    await b.navigate(inputPage, 800);
    await a.send('Network.enable');
    await b.send('Network.enable');
    await a.send('Network.setCookie', {
      name: 'nya',
      value: '1',
      url: 'https://example.com/',
      path: '/',
    });
    const jar = await b.send('Network.getCookies', { urls: ['https://example.com/'] });
    const cookieB = (jar.cookies || []).find((c) => c.name === 'nya');
    if (!cookieB || cookieB.value !== '1') {
      throw new Error(`cookie jar=${JSON.stringify(jar.cookies)}`);
    }
    const hwA = await a.evaluate('navigator.hardwareConcurrency');
    const hwB = await b.evaluate('navigator.hardwareConcurrency');
    if (hwA !== hwB) throw new Error(`hw ${hwA} vs ${hwB}`);
    ok('sharedProfile', { cookieB, hwA, hwB, pages: pages.length });
  } catch (err) {
    fail('sharedProfile', err);
  } finally {
    browser.close();
  }

  try {
    xclipSet(mainDisplay, authFile, 'AAA');
    xclipSet(subDisplay, authFile, 'BBB');
    await sleep(300);
    const mainClip = xclipGet(mainDisplay, authFile).trim();
    const subClip = xclipGet(subDisplay, authFile).trim();
    if (mainClip !== 'AAA' || subClip !== 'BBB') {
      throw new Error(`clips main=${mainClip} sub=${subClip}`);
    }
    ok('clipboard', { mainClip, subClip });
  } catch (err) {
    fail('clipboard', err);
  } finally {
    killXclipHolders();
  }

  try {
    const mainId = xdotoolChromeIds(mainDisplay, authFile)[0];
    const subId = xdotoolChromeIds(subDisplay, authFile)[0];
    if (!mainId || !subId) throw new Error('missing chrome windows for input');
    const typeOn = (display, winId, text) => {
      runDisplay(display, authFile, 'xdotool', ['windowactivate', '--sync', winId]);
      runDisplay(display, authFile, 'xdotool', ['click', '--window', winId, '1']);
      runDisplay(display, authFile, 'xdotool', ['type', '--window', winId, '--delay', '20', text]);
    };
    await Promise.all([
      Promise.resolve().then(() => typeOn(mainDisplay, mainId, 'MAIN')),
      Promise.resolve().then(() => typeOn(subDisplay, subId, 'SUBX')),
    ]);
    ok('simultaneousInput', { mainId, subId });
  } catch (err) {
    fail('simultaneousInput', err);
  }

  try {
    const xrBefore = runDisplay(mainDisplay, authFile, 'xrandr', []);
    const currentBefore = String(xrBefore).match(/current\s+(\d+)\s+x\s+(\d+)/i);
    await api(cookie, `/api/sessions/${session.id}/subs/${sub.id}/display`, 'POST', {
      width: 1280,
      height: 720,
    });
    await sleep(800);
    const xrAfter = runDisplay(mainDisplay, authFile, 'xrandr', []);
    const currentAfter = String(xrAfter).match(/current\s+(\d+)\s+x\s+(\d+)/i);
    if (
      currentBefore &&
      currentAfter &&
      (currentBefore[1] !== currentAfter[1] || currentBefore[2] !== currentAfter[2])
    ) {
      throw new Error(
        `main geom changed ${currentBefore[1]}x${currentBefore[2]} -> ${currentAfter[1]}x${currentAfter[2]}`,
      );
    }
    ok('resize', {
      main: currentAfter ? `${currentAfter[1]}x${currentAfter[2]}` : null,
    });
  } catch (err) {
    fail('resize', err);
  }

  try {
    const mainRfb = await rfbHandshake(cookie, `/ws/vnc/${session.id}`);
    const subRfb = await rfbHandshake(cookie, `/ws/vnc/${session.id}/${sub.id}`);
    if (!String(mainRfb).startsWith('RFB') || !String(subRfb).startsWith('RFB')) {
      throw new Error(`rfb main=${mainRfb} sub=${subRfb}`);
    }
    ok('vnc', { mainRfb, subRfb });
  } catch (err) {
    fail('vnc', err);
  }

  try {
    await api(cookie, `/api/sessions/${session.id}/subs/${sub.id}`, 'DELETE');
    const after = await api(cookie, `/api/sessions/${session.id}/subs`);
    const subSock = path.join(sessionHome(session.id), `vnc-sub-${sub.id}.sock`);
    if ((after.subs || []).length) throw new Error('sub still listed');
    if (fs.existsSync(subSock)) throw new Error('sub vnc sock remains');
    await rfbHandshake(cookie, `/ws/vnc/${session.id}`);
    await api(cookie, `/api/sessions/${session.id}/stop`, 'POST');
    await sleep(800);
    const xvfbLeft = execFileSync('ps', ['-eo', 'args='], { encoding: 'utf8' })
      .split('\n')
      .filter((l) => l.includes('Xvfb') && l.includes(`:${mainDisplay}`));
    const sock = path.join(chromeProfile(session.id), 'nya-chrome.sock');
    if (xvfbLeft.length) throw new Error('Xvfb leftover');
    if (fs.existsSync(sock)) throw new Error('nya-chrome.sock leftover');
    ok('lifecycle');
  } catch (err) {
    fail('lifecycle', err);
    try {
      await api(cookie, `/api/sessions/${session.id}/stop`, 'POST');
    } catch {
      /* ignore */
    }
  }

  try {
    await api(cookie, `/api/sessions/${session.id}`, 'DELETE');
  } catch {
    /* ignore */
  }

  const required = [
    'singleton',
    'twoX',
    'sharedProfile',
    'clipboard',
    'simultaneousInput',
    'resize',
    'vnc',
    'lifecycle',
  ];

  if (process.env.NYA_E2E_SKIP_FINGERPRINT !== '1') {
    try {
      const here = path.dirname(new URL(import.meta.url).pathname);
      const fp = spawnSync(process.execPath, [path.join(here, 'e2e-fingerprint.mjs')], {
        encoding: 'utf8',
        env: process.env,
        timeout: 240000,
      });
      if (fp.status !== 0) {
        throw new Error((fp.stderr || fp.stdout || '').slice(-800) || `exit ${fp.status}`);
      }
      ok('fingerprintRegression');
    } catch (err) {
      fail('fingerprintRegression', err);
    }
    required.push('fingerprintRegression');
  }
  const pass = required.every((name) => checks[name]?.ok);
  const report = { pass, checks };
  console.log(JSON.stringify(report, null, 2));
  if (!pass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
