import http from 'http';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { WebSocket } = require('ws');

const API = process.env.NYA_API || 'http://127.0.0.1:8080';
const USER = process.env.INIT_ADMIN_USER || 'admin';
const PASSWORD = process.env.INIT_ADMIN_PASSWORD || process.env.AUTH_PASSWORD || 'testpass';

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

function openCdpSocket(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  const contexts = [];
  let nextId = 0;
  const ready = new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.on('message', (buf) => {
    const msg = JSON.parse(String(buf));
    if (msg.method === 'Runtime.executionContextCreated' && msg.params?.context) {
      contexts.push(msg.params.context);
    }
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message || 'CDP error'} (${msg.error.code})`));
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
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 35000);
    });
  };
  return { ws, ready, send, contexts };
}

function pageContextId(contexts) {
  const def = contexts.find((c) => c.auxData?.isDefault && /^https?:/i.test(c.origin || ''));
  const http = contexts.find((c) => /^https?:/i.test(c.origin || ''));
  return (def || http)?.id;
}

async function cdpConnect(port) {
  const started = Date.now();
  let page = null;
  let version = null;
  while (Date.now() - started < 50000) {
    try {
      const ver = await fetchJson(`http://127.0.0.1:${port}/json/version`);
      if (ver.data?.webSocketDebuggerUrl) version = ver.data;
      const list = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const targets = Array.isArray(list.data) ? list.data : [];
      page = targets.find((t) => t.type === 'page' && /^https?:/i.test(t.url || ''));
      if (page?.webSocketDebuggerUrl) break;
    } catch {
      /* chrome not ready */
    }
    await sleep(400);
  }
  if (!page?.webSocketDebuggerUrl) throw new Error(`No CDP page on port ${port}`);

  let pageSock = openCdpSocket(page.webSocketDebuggerUrl);
  await pageSock.ready;
  await pageSock.send('Runtime.enable');
  await pageSock.send('Page.enable');
  const ctxWait = Date.now();
  while (Date.now() - ctxWait < 15000 && pageContextId(pageSock.contexts) == null) {
    await sleep(200);
  }
  if (!/example\.com/i.test(page.url || '')) {
    try {
      await pageSock.send('Page.navigate', { url: 'https://example.com/' });
    } catch {
      /* page may already be loading */
    }
  }
  const readyStarted = Date.now();
  while (Date.now() - readyStarted < 20000) {
    try {
      const list = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const targets = Array.isArray(list.data) ? list.data : [];
      const httpsPage = targets.find((t) => t.type === 'page' && /example\.com/i.test(t.url || ''));
      if (httpsPage?.webSocketDebuggerUrl && httpsPage.webSocketDebuggerUrl !== page.webSocketDebuggerUrl) {
        try {
          pageSock.ws.close();
        } catch {
          /* ignore */
        }
        page = httpsPage;
        pageSock = openCdpSocket(page.webSocketDebuggerUrl);
        await pageSock.ready;
        await pageSock.send('Runtime.enable');
        await pageSock.send('Page.enable');
      }
      const info = await pageSock.send('Runtime.evaluate', {
        expression: '({ href: location.href, state: document.readyState })',
        returnByValue: true,
        ...(pageContextId(pageSock.contexts) != null
          ? { contextId: pageContextId(pageSock.contexts) }
          : {}),
      });
      const value = info?.result?.value;
      if (value && /example\.com/i.test(value.href || '') && (value.state === 'interactive' || value.state === 'complete')) {
        break;
      }
    } catch {
      /* execution context not ready */
    }
    await sleep(300);
  }

  let browserSend = async () => {
    throw new Error('no browser CDP');
  };
  let browserWs = null;
  if (version?.webSocketDebuggerUrl) {
    const browserSock = openCdpSocket(version.webSocketDebuggerUrl);
    await browserSock.ready;
    browserSend = browserSock.send;
    browserWs = browserSock.ws;
  }
  const send = (method, params = {}) => {
    if (method === 'Runtime.evaluate') {
      const contextId = pageContextId(pageSock.contexts);
      if (contextId != null && params.contextId == null) {
        return pageSock.send(method, { ...params, contextId });
      }
    }
    return pageSock.send(method, params);
  };
  return {
    send,
    browserSend,
    close: () => {
      try {
        pageSock.ws.close();
      } catch {
        /* ignore */
      }
      try {
        browserWs?.close();
      } catch {
        /* ignore */
      }
    },
  };
}

async function evaluate(cdp, expression, awaitPromise = true) {
  let lastErr;
  for (let i = 0; i < 8; i += 1) {
    try {
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise,
        returnByValue: true,
        timeout: 45000,
      });
      if (result?.exceptionDetails) {
        const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
        throw new Error(`evaluate failed: ${desc}`);
      }
      return result?.result?.value;
    } catch (err) {
      lastErr = err;
      const msg = String(err.message || err);
      if (!/execution context|Inspected target navigated|session with given id/i.test(msg)) throw err;
      await sleep(400);
    }
  }
  throw lastErr;
}

const PAGE_PROBE = `async () => {
  const webgpu = { hasNavigatorGpu: Boolean(navigator.gpu) };

  let webrtc = { rtcPeerConnection: typeof RTCPeerConnection === 'function' };
  try {
    if (typeof RTCPeerConnection === 'function') {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      const candidates = [];
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 800);
        pc.onicecandidate = (ev) => {
          if (ev.candidate && ev.candidate.candidate) candidates.push(ev.candidate.candidate);
          if (!ev.candidate) {
            clearTimeout(timer);
            resolve();
          }
        };
        pc.createDataChannel('nya');
        pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => resolve());
      });
      const sdp = (pc.localDescription && pc.localDescription.sdp) || '';
      const sdpCandidates = sdp.match(/^a=candidate:.+$/gm) || [];
      const leakRe = /(192\\.168\\.|\\b10\\.\\d|\\b172\\.(1[6-9]|2\\d|3[01])\\.|\\b(fc|fd)[0-9a-f]{2}:[0-9a-f]{2}:)/i;
      pc.close();
      webrtc = {
        rtcPeerConnection: true,
        candidateCount: candidates.length,
        candidates: candidates.slice(0, 6),
        sdpCandidateCount: sdpCandidates.length,
        hasPrivateIp: leakRe.test(sdp) || candidates.some((c) => leakRe.test(c)),
      };
    }
  } catch (err) {
    webrtc = { rtcPeerConnection: typeof RTCPeerConnection === 'function', error: String(err) };
  }

  let media = { present: Boolean(navigator.mediaDevices) };
  try {
    if (!navigator.mediaDevices) {
      media.error = 'mediaDevices missing';
    } else {
      const devices = await navigator.mediaDevices.enumerateDevices();
      media.devices = devices.map((d) => ({ kind: d.kind, label: d.label, deviceId: String(d.deviceId || '').slice(0, 12) }));
    }
  } catch (err) {
    media.error = String(err);
  }

  const geo = { permission: null, position: null };
  try {
    if (navigator.permissions) {
      const p = await navigator.permissions.query({ name: 'geolocation' });
      geo.permission = p.state;
    }
  } catch (err) {
    geo.permissionError = String(err);
  }
  try {
    if (geo.permission === 'granted' && navigator.geolocation) {
      geo.position = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ error: 'timeout' }), 4000);
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            clearTimeout(timer);
            resolve({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            });
          },
          (err) => {
            clearTimeout(timer);
            resolve({ error: err.message || String(err) });
          },
          { timeout: 3500 },
        );
      });
    }
  } catch (err) {
    geo.position = { error: String(err) };
  }

  const fonts = {
    arial: false,
    calibri: false,
    noto: false,
    arialInstalled: false,
    notoInstalled: false,
    arialWidth: 0,
    monoWidth: 0,
  };
  try {
    fonts.arial = document.fonts.check('16px Arial');
    fonts.calibri = document.fonts.check('16px Calibri');
    fonts.noto = document.fonts.check('16px "Noto Sans CJK SC"');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const sample = 'mmmmmmmmmmlli';
      ctx.font = '72px monospace';
      fonts.monoWidth = Math.round(ctx.measureText(sample).width);
      ctx.font = '72px Arial, monospace';
      fonts.arialWidth = Math.round(ctx.measureText(sample).width);
      fonts.arialInstalled = fonts.arialWidth !== fonts.monoWidth;
      ctx.font = '72px "Noto Sans CJK SC", monospace';
      fonts.notoInstalled = Math.round(ctx.measureText(sample).width) !== fonts.monoWidth;
    }
  } catch {
    /* ignore */
  }

  let unmaskedRenderer = null;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl');
    const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
    if (gl && dbg) unmaskedRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
  } catch {
    /* ignore */
  }

  return {
    href: location.href,
    ua: navigator.userAgent,
    unmaskedRenderer,
    webgpu,
    webrtc,
    media,
    geo,
    fonts,
  };
}`;

async function login() {
  const res = await fetchJson(`${API}/api/login`, {
    method: 'POST',
    body: { username: USER, password: PASSWORD },
  });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.data)}`);
  return cookieHeader(res.cookies);
}

async function api(cookie, path, method = 'GET', body) {
  const res = await fetchJson(`${API}${path}`, {
    method,
    headers: { Cookie: cookie },
    body,
  });
  if (res.status >= 400) {
    throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

async function cleanup(cookie) {
  try {
    const list = await api(cookie, '/api/sessions');
    const sessions = list.sessions || list || [];
    for (const session of sessions) {
      if (!String(session.name || '').startsWith('fp-')) continue;
      try {
        await api(cookie, `/api/sessions/${session.id}/stop`, 'POST');
      } catch {
        /* already stopped */
      }
      try {
        await api(cookie, `/api/sessions/${session.id}`, 'DELETE');
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* ignore */
  }
}

async function collect(cookie, name, payload) {
  const created = await api(cookie, '/api/sessions', 'POST', {
    name: `fp-${name}-${Date.now().toString(36)}`,
    homeUrl: 'https://example.com/',
    gpuProfile: 'rtx-2080',
    ...payload,
  });
  const session = created.session;
  const started = await api(cookie, `/api/sessions/${session.id}/start`, 'POST');
  const runtime = started.runtime;
  if (!runtime?.cdpPort) throw new Error(`session ${session.id} has no cdpPort`);
  await sleep(1500);
  let cdp = await cdpConnect(runtime.cdpPort);
  if (payload.mediaDevices) {
    try {
      await cdp.browserSend('Browser.grantPermissions', {
        origin: 'https://example.com',
        permissions: ['audioCapture', 'videoCapture'],
      });
    } catch {
      /* labels stay empty if grant is unavailable */
    }
  }
  if (payload.geo?.permission === 'allow' && payload.geo.latitude != null) {
    try {
      await cdp.browserSend('Browser.grantPermissions', {
        origin: 'https://example.com',
        permissions: ['geolocation'],
      });
    } catch {
      /* lifecycle may already have granted */
    }
    try {
      await cdp.send('Emulation.setGeolocationOverride', {
        latitude: payload.geo.latitude,
        longitude: payload.geo.longitude,
        accuracy: payload.geo.accuracy || 80,
      });
    } catch {
      /* keep going */
    }
  }
  const probe = async () => evaluate(cdp, `(${PAGE_PROBE})()`);
  let page;
  try {
    page = await probe();
  } catch (err) {
    cdp.close();
    await sleep(800);
    cdp = await cdpConnect(runtime.cdpPort);
    page = await probe();
  }
  if (!/example\.com/i.test(page?.href || '')) {
    cdp.close();
    await sleep(1200);
    cdp = await cdpConnect(runtime.cdpPort);
    page = await probe();
  }
  if (process.env.NYA_SKIP_WEBGPU_ADAPTER !== '1') {
  try {
    page.webgpu = await evaluate(
      cdp,
      `(() => {
        const webgpu = { hasNavigatorGpu: Boolean(navigator.gpu) };
        if (!navigator.gpu) return Promise.resolve(webgpu);
        const timeout = new Promise((resolve) =>
          setTimeout(() => resolve({ ...webgpu, available: false, reason: 'adapter-timeout' }), 3000),
        );
        return Promise.race([
          navigator.gpu.requestAdapter().then((adapter) => {
            if (!adapter) return { ...webgpu, available: false, reason: 'no-adapter' };
            const info = adapter.info || {};
            return {
              ...webgpu,
              available: true,
              vendor: info.vendor || null,
              architecture: info.architecture || null,
              device: info.device || null,
              description: info.description || null,
            };
          }),
          timeout,
        ]).catch((err) => ({ ...webgpu, available: false, error: String(err) }));
      })()`,
    );
  } catch (err) {
    page.webgpu = { ...(page.webgpu || {}), error: String(err.message || err) };
  }
  }
  cdp.close();
  try {
    await api(cookie, `/api/sessions/${session.id}/stop`, 'POST');
  } catch {
    /* keep going */
  }
  try {
    await api(cookie, `/api/sessions/${session.id}`, 'DELETE');
  } catch {
    /* keep going */
  }
  return {
    name,
    stored: session.fingerprint,
    page,
  };
}

function check(name, ok, detail) {
  return { name, ok, detail };
}

async function main() {
  const cookie = await login();
  await cleanup(cookie);
  const samples = [];
  const errors = [];
  const allCases = [
    ['offline', { webrtcMode: 'offline', deviceName: 'DESKTOP-OFFLINE', fontProfile: 'win10' }],
    ['disabled', { webrtcMode: 'disabled', deviceName: 'DESKTOP-DISABLED' }],
    ['disable-udp', { webrtcMode: 'disable-udp', deviceName: 'DESKTOP-NOUDP' }],
    [
      'replace-no-ip',
      { webrtcMode: 'replace', deviceName: 'DESKTOP-REPLACE' },
    ],
    [
      'media-geo',
      {
        webrtcMode: 'offline',
        deviceName: 'DESKTOP-MEDIA01',
        mediaDevices: {
          audioInput: 'USB Audio Device',
          audioOutput: 'NVIDIA High Definition Audio',
          videoInput: 'HD Pro Webcam C920',
        },
        geo: { permission: 'allow', latitude: 31.23, longitude: 121.47, accuracy: 80 },
      },
    ],
  ];
  const wanted = new Set(
    String(process.env.NYA_FP_CASES || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const cases = wanted.size ? allCases.filter(([name]) => wanted.has(name)) : allCases;
  for (const [name, payload] of cases) {
    process.stderr.write(`collect ${name}\n`);
    try {
      samples.push(await collect(cookie, name, payload));
    } catch (err) {
      errors.push({ name, error: String(err.message || err) });
      process.stderr.write(`  failed ${name}: ${err.message || err}\n`);
      await cleanup(cookie);
    }
    await sleep(600);
  }

  const byName = Object.fromEntries(samples.map((s) => [s.name, s]));
  const checks = [];
  const offline = byName.offline;
  if (offline) {
    checks.push(check('offline-secure-origin', /example\.com/i.test(offline.page.href || ''), offline.page.href));
    checks.push(check('offline-api', offline.page.webrtc?.rtcPeerConnection === true, offline.page.webrtc));
    checks.push(check('offline-no-ice', (offline.page.webrtc?.candidateCount || 0) === 0, offline.page.webrtc));
    checks.push(check('offline-no-sdp-ice', (offline.page.webrtc?.sdpCandidateCount || 0) === 0, offline.page.webrtc));
    checks.push(check('offline-device-name', offline.stored.deviceName === 'DESKTOP-OFFLINE', offline.stored.deviceName));
    const swiftshader = /SwiftShader/i.test(offline.page.unmaskedRenderer || '');
    checks.push(
      check(
        'gpu-spoof',
        swiftshader
          ? !/RTX 2080/i.test(offline.page.unmaskedRenderer || '')
          : /RTX 2080/i.test(offline.page.unmaskedRenderer || ''),
        { renderer: offline.page.unmaskedRenderer, swiftshader },
      ),
    );
    checks.push(
      check(
        'webgpu-js',
        offline.page.webgpu?.hasNavigatorGpu === true,
        offline.page.webgpu,
      ),
    );
    checks.push(check('font-arial', offline.page.fonts?.arial === true, offline.page.fonts));
    checks.push(check('font-calibri', offline.page.fonts?.calibri === true, offline.page.fonts));
    checks.push(check('font-hide-noto-check', offline.page.fonts?.noto === false, offline.page.fonts));
    checks.push(check('font-arial-metrics', offline.page.fonts?.arialInstalled === true, offline.page.fonts));
    checks.push(check('font-hide-noto-metrics', offline.page.fonts?.notoInstalled === false, offline.page.fonts));
  }
  const disabled = byName.disabled;
  if (disabled) {
    checks.push(check('disabled-no-api', disabled.page.webrtc?.rtcPeerConnection === false, disabled.page.webrtc));
  }
  const noUdp = byName['disable-udp'];
  if (noUdp) {
    checks.push(check('disable-udp-api', noUdp.page.webrtc?.rtcPeerConnection === true, noUdp.page.webrtc));
    checks.push(check('disable-udp-no-host', noUdp.page.webrtc?.hasPrivateIp !== true, noUdp.page.webrtc));
  }
  const replace = byName['replace-no-ip'];
  if (replace) {
    checks.push(check('replace-no-ip-no-leak', replace.page.webrtc?.hasPrivateIp !== true, replace.page.webrtc));
  }
  const mediaGeo = byName['media-geo'];
  if (mediaGeo) {
    const labels = (mediaGeo.page.media?.devices || []).map((d) => d.label);
    checks.push(check('media-present', mediaGeo.page.media?.present === true, mediaGeo.page.media));
    checks.push(check('media-mic', labels.includes('USB Audio Device'), labels));
    checks.push(check('media-cam', labels.includes('HD Pro Webcam C920'), labels));
    checks.push(check('geo-granted', mediaGeo.page.geo?.permission === 'granted', mediaGeo.page.geo));
    const pos = mediaGeo.page.geo?.position || {};
    checks.push(check('geo-lat', Math.abs((pos.latitude || 0) - 31.23) < 0.01, pos));
    checks.push(check('geo-lng', Math.abs((pos.longitude || 0) - 121.47) < 0.01, pos));
  }

  const report = {
    at: new Date().toISOString(),
    ok: checks.every((c) => c.ok) && errors.length === 0,
    checks,
    errors,
    samples: samples.map((s) => ({
      name: s.name,
      stored: {
        webrtcMode: s.stored.webrtcMode,
        deviceName: s.stored.deviceName,
        gpuProfile: s.stored.gpuProfile,
        mediaDevices: s.stored.mediaDevices,
        geo: s.stored.geo,
        fontProfile: s.stored.fontProfile,
      },
      page: s.page,
    })),
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
