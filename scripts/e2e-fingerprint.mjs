import http from 'http';
import { WebSocket } from 'ws';

const API = process.env.NYA_API || 'http://127.0.0.1:8080';
const PASSWORD = process.env.AUTH_PASSWORD || 'testpass';

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
      }, 20000);
    });
  };

  const { targetInfos } = await send('Target.getTargets');
  const page =
    (targetInfos || []).find((t) => t.type === 'page' && /^https?:/i.test(t.url || '')) ||
    (targetInfos || []).find((t) => t.type === 'page');
  if (!page) throw new Error('No page target');
  const attached = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const sessionId = attached.sessionId;
  const sessionSend = (method, params = {}) => send(method, params, sessionId);
  await sessionSend('Page.enable');
  await sessionSend('Runtime.enable');
  return {
    send: sessionSend,
    close: () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

async function evaluate(cdp, expression, awaitPromise = true) {
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
}

async function navigate(cdp, url, settleMs = 2500) {
  const nav = cdp.send('Page.navigate', { url }).catch((err) => {
    if (!String(err.message || err).includes('timeout')) throw err;
  });
  const start = Date.now();
  while (Date.now() - start < 20000) {
    try {
      const info = await evaluate(
        cdp,
        '({ href: location.href, state: document.readyState })',
        false,
      );
      if (info?.state === 'interactive' || info?.state === 'complete') break;
    } catch {
      /* renderer not ready yet */
    }
    await sleep(400);
  }
  await Promise.race([nav, sleep(0)]);
  await sleep(settleMs);
}

const PROBE_SRC = `async () => {
  const sha = async (input) => {
    const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
    let h = 2166136261;
    for (let i = 0; i < bytes.length; i += 1) {
      h ^= bytes[i];
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, '0') + ':' + bytes.length;
  };

  const paint = (ctx) => {
    ctx.fillStyle = 'rgb(255,102,0)';
    ctx.fillRect(10, 10, 240, 50);
    ctx.fillStyle = '#069';
    ctx.font = '16px Arial';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('Cwm fjordbank glyphs vext quiz, 😃', 12, 36);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.font = '18px Times New Roman';
    ctx.fillText('mmmmmmmmmmlli', 12, 54);
  };

  const canvas = document.createElement('canvas');
  canvas.width = 280;
  canvas.height = 70;
  const ctx = canvas.getContext('2d');
  paint(ctx);
  const dataUrl = canvas.toDataURL();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const canvas2 = document.createElement('canvas');
  canvas2.width = 280;
  canvas2.height = 70;
  const ctx2 = canvas2.getContext('2d');
  paint(ctx2);
  const dataUrl2 = canvas2.toDataURL();

  let webgl = { available: false };
  try {
    const glc = document.createElement('canvas');
    glc.width = 256;
    glc.height = 128;
    const gl = glc.getContext('webgl') || glc.getContext('experimental-webgl');
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      gl.clearColor(0.21, 0.42, 0.63, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const pixels = new Uint8Array(256 * 128 * 4);
      gl.readPixels(0, 0, 256, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      webgl = {
        available: true,
        vendor: gl.getParameter(gl.VENDOR),
        renderer: gl.getParameter(gl.RENDERER),
        unmaskedVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
        unmaskedRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
        extensions: (gl.getSupportedExtensions() || []).slice(0, 40),
        readPixelsSha: await sha(pixels.buffer),
      };
    }
  } catch (err) {
    webgl = { available: false, error: String(err) };
  }

  let audio = { available: false };
  try {
    const ac = new OfflineAudioContext(1, 44100, 44100);
    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 10000;
    const comp = ac.createDynamicsCompressor();
    osc.connect(comp);
    comp.connect(ac.destination);
    osc.start(0);
    const buf = await ac.startRendering();
    const ch = buf.getChannelData(0);
    const ch2 = buf.getChannelData(0);
    audio = {
      available: true,
      sampleRate: buf.sampleRate,
      sha: await sha(Float32Array.from(ch).buffer),
      stable: ch[100] === ch2[100],
      sample100: ch[100],
    };
  } catch (err) {
    audio = { available: false, error: String(err) };
  }

  let webrtc = {
    RTCPeerConnection: typeof RTCPeerConnection,
    inWindow: 'RTCPeerConnection' in window,
    webkit: typeof webkitRTCPeerConnection,
    candidates: [],
  };
  if (typeof RTCPeerConnection === 'function') {
    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      pc.createDataChannel('nya');
      pc.onicecandidate = (ev) => {
        if (ev.candidate && ev.candidate.candidate) webrtc.candidates.push(ev.candidate.candidate);
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await new Promise((r) => setTimeout(r, 2500));
      pc.close();
    } catch (err) {
      webrtc.error = String(err);
    }
  }

  let devices = [];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch (err) {
    devices = [{ error: String(err) }];
  }

  let worker = { ok: false };
  try {
    worker = await new Promise((resolve) => {
      const src = \`
        self.onmessage = async () => {
          try {
            const c = new OffscreenCanvas(200, 50);
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#069';
            ctx.fillRect(0, 0, 200, 50);
            ctx.font = '16px Arial';
            ctx.fillStyle = '#fff';
            ctx.fillText('worker glyph quiz', 8, 30);
            const blob = await c.convertToBlob();
            const ab = await blob.arrayBuffer();
            const bytes = new Uint8Array(ab);
            let h = 2166136261;
            for (let i = 0; i < bytes.length; i++) {
              h ^= bytes[i];
              h = Math.imul(h, 16777619);
            }
            const sha = (h >>> 0).toString(16).padStart(8, '0') + ':' + bytes.length;
            self.postMessage({
              ok: true,
              sha,
              len: ab.byteLength,
              hardwareConcurrency: self.navigator.hardwareConcurrency,
            });
          } catch (e) {
            self.postMessage({ ok: false, error: String(e) });
          }
        };
      \`;
      const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      const t = setTimeout(() => {
        w.terminate();
        resolve({ ok: false, error: 'timeout' });
      }, 4000);
      w.onmessage = (e) => {
        clearTimeout(t);
        w.terminate();
        resolve(e.data);
      };
      w.postMessage(1);
    });
  } catch (err) {
    worker = { ok: false, error: String(err) };
  }

  const span = document.createElement('span');
  span.style.cssText = 'position:absolute;left:-9999px;font:16px Arial;';
  span.textContent = 'mmmmmmmmmmlli.WWWWWW';
  document.body.appendChild(span);
  const rect = span.getBoundingClientRect();
  const fonts = {};
  for (const font of ['Arial', 'Times New Roman', 'Courier New', 'Comic Sans MS', 'Noto Sans CJK SC', 'WenQuanYi Zen Hei', 'DejaVu Sans']) {
    span.style.fontFamily = \`'\${font}', monospace\`;
    fonts[font] = span.offsetWidth;
  }
  document.body.removeChild(span);

  return {
    href: location.href,
    ua: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    languages: [...(navigator.languages || [])],
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    maxTouchPoints: navigator.maxTouchPoints,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: { w: screen.width, h: screen.height, depth: screen.colorDepth, dpr: window.devicePixelRatio },
    webgpu: Boolean(navigator.gpu),
    canvas: {
      dataUrlSha: await sha(dataUrl),
      imageDataSha: await sha(img.data.buffer),
      stable: dataUrl === dataUrl2,
    },
    webgl,
    audio,
    webrtc,
    devices: devices.map((d) => ({ kind: d.kind, label: d.label, deviceId: d.deviceId })),
    worker,
    clientRect: { w: rect.width, h: rect.height },
    fonts,
    pluginCount: navigator.plugins.length,
    workerCtorToString:
      typeof Worker === 'function' ? Function.prototype.toString.call(Worker) : String(Worker),
  };
}`;

function ipv4s(text) {
  return [...new Set(String(text).match(/\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g) || [])];
}

function summarizeSite(name, text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return {
    site: name,
    ips: ipv4s(t).slice(0, 12),
    hasRtc: /RTCPeerConnection|host candidate|srflx|local ip/i.test(t),
    snippet: t.slice(0, 500),
  };
}

async function login() {
  const res = await fetchJson(`${API}/api/login`, {
    method: 'POST',
    body: { password: PASSWORD },
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
  if (res.status >= 400) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(res.data)}`);
  return res.data;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

async function collectSession(cookie, label) {
  const created = await api(cookie, '/api/sessions', 'POST', { name: `e2e-${label}`, proxy: { type: 'none' } });
  const session = created.session;
  const started = await api(cookie, `/api/sessions/${session.id}/start`, 'POST');
  const runtime = started.runtime;
  if (!runtime?.cdpPort) {
    throw new Error(`session ${session.id} has no cdpPort; is NYA_CDP_BASE set?`);
  }
  const cdp = await cdpConnect(runtime.cdpPort);
  await navigate(cdp, 'data:text/html,<!doctype html><title>nya</title><body></body>', 800);
  const probe1 = await evaluate(cdp, `(${PROBE_SRC})()`);
  const probe2 = await evaluate(cdp, `(${PROBE_SRC})()`);

  const sites = {};
  const extraSites = process.env.NYA_E2E_SITES === '1';
  for (const [name, url, wait] of extraSites ? [
    ['browserleaks-webrtc', 'https://browserleaks.com/webrtc', 5000],
    ['browserleaks-canvas', 'https://browserleaks.com/canvas', 4000],
    ['browserleaks-webgl', 'https://browserleaks.com/webgl', 4000],
    ['ipleak', 'https://ipleak.net/', 6000],
    ['fingerprintjs', 'https://fingerprintjs.github.io/fingerprintjs/', 8000],
  ] : []) {
    try {
      await navigate(cdp, url, wait);
      const text = await evaluate(cdp, 'document.body ? document.body.innerText : ""', false);
      const extra = {};
      if (name === 'fingerprintjs') {
        extra.visitorHints = String(text)
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => /visitor|fingerprint|id/i.test(l))
          .slice(0, 12);
      }
      if (name === 'browserleaks-canvas') {
        extra.canvasLines = String(text)
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => /signature|hash|md5|sha|canvas/i.test(l))
          .slice(0, 20);
      }
      if (name === 'browserleaks-webgl') {
        extra.webglLines = String(text)
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => /unmasked|renderer|vendor|hash|signature/i.test(l))
          .slice(0, 20);
      }
      sites[name] = { ...summarizeSite(name, text), ...extra, url };
    } catch (err) {
      sites[name] = { site: name, error: String(err.message || err), url };
    }
  }

  cdp.close();
  return {
    id: session.id,
    fingerprint: session.fingerprint,
    runtime,
    probe1,
    probe2,
    sites,
  };
}

function diff(a, b, path = '') {
  const out = [];
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    const pa = path ? `${path}.${k}` : k;
    const va = a?.[k];
    const vb = b?.[k];
    if (va && vb && typeof va === 'object' && typeof vb === 'object' && !Array.isArray(va) && !Array.isArray(vb)) {
      out.push(...diff(va, vb, pa));
    } else {
      const sa = JSON.stringify(va);
      const sb = JSON.stringify(vb);
      if (sa !== sb) out.push({ path: pa, a: va, b: vb });
    }
  }
  return out;
}

async function main() {
  const cookie = await login();
  console.log('logged in');
  const a = await collectSession(cookie, 'a');
  console.log('session A', a.id, 'cdp', a.runtime.cdpPort, 'seed', a.fingerprint?.seed?.slice(0, 12));
  const b = await collectSession(cookie, 'b');
  console.log('session B', b.id, 'cdp', b.runtime.cdpPort, 'seed', b.fingerprint?.seed?.slice(0, 12));

  const intra = diff(a.probe1, a.probe2).filter((d) => !d.path.startsWith('webrtc.candidates'));
  const inter = diff(a.probe1, b.probe1);

  const report = {
    sessionA: {
      id: a.id,
      fingerprint: a.fingerprint,
      probe: pick(a.probe1, [
        'hardwareConcurrency',
        'deviceMemory',
        'ua',
        'platform',
        'timezone',
        'canvas',
        'webgl',
        'audio',
        'webrtc',
        'devices',
        'worker',
        'workerCtorToString',
        'webgpu',
        'fonts',
        'clientRect',
        'screen',
      ]),
      sites: a.sites,
    },
    sessionB: {
      id: b.id,
      fingerprint: b.fingerprint,
      probe: pick(b.probe1, [
        'hardwareConcurrency',
        'deviceMemory',
        'ua',
        'platform',
        'timezone',
        'canvas',
        'webgl',
        'audio',
        'webrtc',
        'devices',
        'worker',
        'workerCtorToString',
        'webgpu',
        'fonts',
        'clientRect',
        'screen',
      ]),
      sites: b.sites,
    },
    sameSessionStable: intra,
    crossSessionDiffs: inter.map((d) => d.path),
    verdict: {
      canvasChanged: a.probe1.canvas.dataUrlSha !== b.probe1.canvas.dataUrlSha,
      audioChanged: a.probe1.audio.sha !== b.probe1.audio.sha,
      webglPixelsChanged: a.probe1.webgl.readPixelsSha !== b.probe1.webgl.readPixelsSha,
      canvasStableInSession: a.probe1.canvas.stable && intra.every((d) => !d.path.startsWith('canvas')),
      webrtcBlocked:
        a.probe1.webrtc.RTCPeerConnection === 'undefined' &&
        b.probe1.webrtc.RTCPeerConnection === 'undefined',
      workerSame: a.probe1.worker.sha && a.probe1.worker.sha === b.probe1.worker.sha,
      workerHwMatchesWindow:
        a.probe1.worker.hardwareConcurrency === a.probe1.hardwareConcurrency &&
        b.probe1.worker.hardwareConcurrency === b.probe1.hardwareConcurrency,
      workerHwNotHost64:
        a.probe1.hardwareConcurrency !== 64 && b.probe1.hardwareConcurrency !== 64,
      workerCtorNative: /\[native code\]/.test(String(a.probe1.workerCtorToString || '')),
      webglRendererSame: a.probe1.webgl.unmaskedRenderer === b.probe1.webgl.unmaskedRenderer,
      fontsSame: JSON.stringify(a.probe1.fonts) === JSON.stringify(b.probe1.fonts),
      timezoneSame: a.probe1.timezone === b.probe1.timezone,
      uaSame: a.probe1.ua === b.probe1.ua,
    },
  };

  const v = report.verdict;
  report.pass =
    v.canvasChanged &&
    v.audioChanged &&
    v.webglPixelsChanged &&
    v.canvasStableInSession &&
    v.workerHwMatchesWindow &&
    v.workerHwNotHost64 &&
    v.workerCtorNative &&
    !v.workerSame;

  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) {
    throw new Error('native farbling e2e failed');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
