import http from 'http';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { WebSocket } = require('ws');

const API = process.env.NYA_API || 'http://127.0.0.1:8080';
const USER = process.env.INIT_ADMIN_USER || 'admin';
const PASSWORD = process.env.INIT_ADMIN_PASSWORD || process.env.AUTH_PASSWORD || 'testpass';
const PROFILES = (process.env.NYA_GPU_PROFILES || 'native,gtx-1070,gtx-1080-ti,rtx-2080,rtx-3070,rtx-4070')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

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
  let nextId = 0;
  const ready = new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.on('message', (buf) => {
    const msg = JSON.parse(String(buf));
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
      }, 25000);
    });
  };
  return { ws, ready, send };
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

  const pageSock = openCdpSocket(page.webSocketDebuggerUrl);
  await pageSock.ready;
  await pageSock.send('Runtime.enable');
  await pageSock.send('Page.enable');
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
      const info = await pageSock.send('Runtime.evaluate', {
        expression: '({ href: location.href, state: document.readyState })',
        returnByValue: true,
      });
      const value = info?.result?.value;
      if (value?.state === 'interactive' || value?.state === 'complete') break;
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
  return {
    browserSend,
    send: pageSock.send,
    browserVersion: version,
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

const GPU_PROBE = `async () => {
  const dumpGl = (gl, kind) => {
    if (!gl) return { available: false, kind };
    const names = [
      'VENDOR', 'RENDERER', 'VERSION', 'SHADING_LANGUAGE_VERSION',
      'MAX_TEXTURE_SIZE', 'MAX_CUBE_MAP_TEXTURE_SIZE', 'MAX_RENDERBUFFER_SIZE',
      'MAX_VIEWPORT_DIMS', 'MAX_VERTEX_ATTRIBS', 'MAX_VERTEX_UNIFORM_VECTORS',
      'MAX_VARYING_VECTORS', 'MAX_COMBINED_TEXTURE_IMAGE_UNITS',
      'MAX_VERTEX_TEXTURE_IMAGE_UNITS', 'MAX_TEXTURE_IMAGE_UNITS',
      'MAX_FRAGMENT_UNIFORM_VECTORS', 'ALIASED_LINE_WIDTH_RANGE',
      'ALIASED_POINT_SIZE_RANGE', 'RED_BITS', 'GREEN_BITS', 'BLUE_BITS',
      'ALPHA_BITS', 'DEPTH_BITS', 'STENCIL_BITS', 'SUBPIXEL_BITS',
      'SAMPLE_BUFFERS', 'SAMPLES',
    ];
    if (kind === 'webgl2') {
      names.push(
        'MAX_3D_TEXTURE_SIZE', 'MAX_ARRAY_TEXTURE_LAYERS', 'MAX_COLOR_ATTACHMENTS',
        'MAX_DRAW_BUFFERS', 'MAX_SAMPLES', 'MAX_UNIFORM_BUFFER_BINDINGS',
        'MAX_UNIFORM_BLOCK_SIZE', 'MAX_VERTEX_UNIFORM_BLOCKS',
        'MAX_FRAGMENT_UNIFORM_BLOCKS', 'MAX_COMBINED_UNIFORM_BLOCKS',
        'MAX_VERTEX_OUTPUT_COMPONENTS', 'MAX_FRAGMENT_INPUT_COMPONENTS',
        'MAX_ELEMENT_INDEX', 'MAX_ELEMENTS_INDICES', 'MAX_ELEMENTS_VERTICES',
        'MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS',
        'MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS',
        'MAX_SERVER_WAIT_TIMEOUT', 'MAX_CLIENT_WAIT_TIMEOUT_WEBGL',
      );
    }
    const params = {};
    for (const name of names) {
      const key = gl[name];
      if (key == null) {
        params[name] = null;
        continue;
      }
      try {
        const value = gl.getParameter(key);
        params[name] = value instanceof Float32Array || value instanceof Int32Array
          ? Array.from(value)
          : value;
      } catch (err) {
        params[name] = { error: String(err) };
      }
    }
    let unmaskedVendor = null;
    let unmaskedRenderer = null;
    try {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) {
        unmaskedVendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
        unmaskedRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
      }
    } catch (err) {
      unmaskedRenderer = { error: String(err) };
    }
    let anisotropy = null;
    try {
      const ext = gl.getExtension('EXT_texture_filter_anisotropic')
        || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
      if (ext) anisotropy = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
    } catch {
      /* ignore */
    }
    const precision = {};
    for (const shader of ['VERTEX_SHADER', 'FRAGMENT_SHADER']) {
      precision[shader] = {};
      for (const type of ['LOW_FLOAT', 'MEDIUM_FLOAT', 'HIGH_FLOAT', 'LOW_INT', 'MEDIUM_INT', 'HIGH_INT']) {
        try {
          const p = gl.getShaderPrecisionFormat(gl[shader], gl[type]);
          precision[shader][type] = p
            ? { rangeMin: p.rangeMin, rangeMax: p.rangeMax, precision: p.precision }
            : null;
        } catch (err) {
          precision[shader][type] = { error: String(err) };
        }
      }
    }
    let pixelsSha = null;
    try {
      gl.clearColor(0.21, 0.42, 0.63, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const pixels = new Uint8Array(64 * 32 * 4);
      gl.readPixels(0, 0, 64, 32, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let h = 2166136261;
      for (let i = 0; i < pixels.length; i += 1) {
        h ^= pixels[i];
        h = Math.imul(h, 16777619);
      }
      pixelsSha = (h >>> 0).toString(16).padStart(8, '0') + ':' + pixels.length;
    } catch (err) {
      pixelsSha = String(err);
    }
    return {
      available: true,
      kind,
      vendor: params.VENDOR,
      renderer: params.RENDERER,
      unmaskedVendor,
      unmaskedRenderer,
      version: params.VERSION,
      shadingLanguageVersion: params.SHADING_LANGUAGE_VERSION,
      extensions: gl.getSupportedExtensions() || [],
      anisotropy,
      params,
      precision,
      attributes: gl.getContextAttributes(),
      pixelsSha,
    };
  };

  const make = (type) => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 32;
    return c.getContext(type, { antialias: true, depth: true, stencil: true });
  };

  let webgpu = { available: false };
  try {
    if (navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        const info = adapter.info || {};
        webgpu = {
          available: true,
          vendor: info.vendor || null,
          architecture: info.architecture || null,
          device: info.device || null,
          description: info.description || null,
        };
      } else {
        webgpu = { available: false, reason: 'no-adapter' };
      }
    }
  } catch (err) {
    webgpu = { available: false, error: String(err) };
  }

  let webrtc = { rtcPeerConnection: typeof RTCPeerConnection === 'function' };
  try {
    if (typeof RTCPeerConnection === 'function') {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      const candidates = [];
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 2500);
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
      pc.close();
      webrtc = { rtcPeerConnection: true, candidateCount: candidates.length, candidates: candidates.slice(0, 4) };
    }
  } catch (err) {
    webrtc = { rtcPeerConnection: typeof RTCPeerConnection === 'function', error: String(err) };
  }

  let media = { error: 'n/a' };
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    media = devices.map((d) => ({ kind: d.kind, label: d.label, deviceId: d.deviceId.slice(0, 12) }));
  } catch (err) {
    media = { error: String(err) };
  }

  let geo = { permission: null };
  try {
    if (navigator.permissions) {
      const p = await navigator.permissions.query({ name: 'geolocation' });
      geo.permission = p.state;
    }
  } catch (err) {
    geo.error = String(err);
  }

  return {
    href: location.href,
    ua: navigator.userAgent,
    platform: navigator.platform,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    maxTouchPoints: navigator.maxTouchPoints,
    webgpu,
    webrtc,
    media,
    geo,
    webgl: dumpGl(make('webgl'), 'webgl'),
    webgl2: dumpGl(make('webgl2'), 'webgl2'),
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

function stable(obj) {
  return JSON.stringify(obj, Object.keys(obj || {}).sort());
}

function pickParams(gl) {
  if (!gl?.params) return {};
  const keys = [
    'MAX_TEXTURE_SIZE',
    'MAX_CUBE_MAP_TEXTURE_SIZE',
    'MAX_RENDERBUFFER_SIZE',
    'MAX_SAMPLES',
    'MAX_DRAW_BUFFERS',
    'MAX_COLOR_ATTACHMENTS',
    'MAX_3D_TEXTURE_SIZE',
    'MAX_ARRAY_TEXTURE_LAYERS',
    'MAX_VERTEX_ATTRIBS',
    'MAX_COMBINED_TEXTURE_IMAGE_UNITS',
    'MAX_TEXTURE_IMAGE_UNITS',
    'SAMPLES',
    'ALIASED_LINE_WIDTH_RANGE',
    'ALIASED_POINT_SIZE_RANGE',
  ];
  const out = {};
  for (const k of keys) if (gl.params[k] != null) out[k] = gl.params[k];
  return out;
}

async function cleanupProbeSessions(cookie) {
  try {
    const list = await api(cookie, '/api/sessions');
    const sessions = list.sessions || list || [];
    for (const session of sessions) {
      if (!String(session.name || '').startsWith('gpu-')) continue;
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

async function collectProfile(cookie, gpuProfile) {
  const created = await api(cookie, '/api/sessions', 'POST', {
    name: `gpu-${gpuProfile}-${Date.now().toString(36)}`,
    gpuProfile,
  });
  const session = created.session;
  const started = await api(cookie, `/api/sessions/${session.id}/start`, 'POST');
  const runtime = started.runtime;
  if (!runtime?.cdpPort) throw new Error(`session ${session.id} has no cdpPort`);
  await sleep(1500);

  const cdp = await cdpConnect(runtime.cdpPort);
  const page = await evaluate(cdp, `(${GPU_PROBE})()`);

  let systemInfo = null;
  try {
    systemInfo = await cdp.browserSend('SystemInfo.getInfo');
  } catch (err) {
    systemInfo = { error: String(err.message || err) };
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
    gpuProfile,
    storedProfile: session.fingerprint?.gpuProfile,
    ua: page.ua,
    platform: page.platform,
    hardwareConcurrency: page.hardwareConcurrency,
    deviceMemory: page.deviceMemory,
    webgpu: page.webgpu,
    webrtc: page.webrtc,
    media: page.media,
    geo: page.geo,
    webgl: {
      vendor: page.webgl.vendor,
      renderer: page.webgl.renderer,
      unmaskedVendor: page.webgl.unmaskedVendor,
      unmaskedRenderer: page.webgl.unmaskedRenderer,
      version: page.webgl.version,
      shadingLanguageVersion: page.webgl.shadingLanguageVersion,
      extensions: page.webgl.extensions,
      anisotropy: page.webgl.anisotropy,
      params: pickParams(page.webgl),
      allParams: page.webgl.params,
      precision: page.webgl.precision,
      attributes: page.webgl.attributes,
      pixelsSha: page.webgl.pixelsSha,
    },
    webgl2: {
      available: page.webgl2.available,
      vendor: page.webgl2.vendor,
      renderer: page.webgl2.renderer,
      unmaskedVendor: page.webgl2.unmaskedVendor,
      unmaskedRenderer: page.webgl2.unmaskedRenderer,
      version: page.webgl2.version,
      extensions: page.webgl2.extensions,
      params: pickParams(page.webgl2),
      allParams: page.webgl2.params,
      precision: page.webgl2.precision,
      pixelsSha: page.webgl2.pixelsSha,
    },
    chromeGpu: systemInfo?.gpu || systemInfo,
    browser: cdp.browserVersion
      ? {
          browser: cdp.browserVersion.Browser,
          protocol: cdp.browserVersion['Protocol-Version'],
          userAgent: cdp.browserVersion['User-Agent'],
        }
      : null,
  };
}

function compare(baseline, sample) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  add(
    'unmaskedRenderer',
    baseline.webgl.unmaskedRenderer === sample.webgl.unmaskedRenderer,
    { baseline: baseline.webgl.unmaskedRenderer, sample: sample.webgl.unmaskedRenderer },
  );
  add(
    'unmaskedVendor',
    baseline.webgl.unmaskedVendor === sample.webgl.unmaskedVendor,
    { baseline: baseline.webgl.unmaskedVendor, sample: sample.webgl.unmaskedVendor },
  );
  add('webglParams', stable(baseline.webgl.allParams) === stable(sample.webgl.allParams), null);
  add('webgl2Params', stable(baseline.webgl2.allParams) === stable(sample.webgl2.allParams), null);
  add(
    'webglExtensions',
    JSON.stringify(baseline.webgl.extensions) === JSON.stringify(sample.webgl.extensions),
    {
      onlyBaseline: baseline.webgl.extensions.filter((x) => !sample.webgl.extensions.includes(x)),
      onlySample: sample.webgl.extensions.filter((x) => !baseline.webgl.extensions.includes(x)),
    },
  );
  add(
    'webgl2Extensions',
    JSON.stringify(baseline.webgl2.extensions || []) === JSON.stringify(sample.webgl2.extensions || []),
    null,
  );
  add('precision', stable(baseline.webgl.precision) === stable(sample.webgl.precision), null);
  add('anisotropy', baseline.webgl.anisotropy === sample.webgl.anisotropy, {
    baseline: baseline.webgl.anisotropy,
    sample: sample.webgl.anisotropy,
  });
  add('webgpuOff', sample.webgpu?.available === false, sample.webgpu);
  add('linuxUa', /Linux/.test(sample.ua || ''), sample.ua);
  return checks;
}

async function main() {
  const cookie = await login();
  await cleanupProbeSessions(cookie);
  const health = await api(cookie, '/api/health');
  const samples = [];
  const errors = [];
  for (const profile of PROFILES) {
    process.stderr.write(`collect ${profile}\n`);
    try {
      samples.push(await collectProfile(cookie, profile));
    } catch (err) {
      errors.push({ gpuProfile: profile, error: String(err.message || err) });
      process.stderr.write(`  failed ${profile}: ${err.message || err}\n`);
      await cleanupProbeSessions(cookie);
    }
    await sleep(800);
  }
  if (!samples.length) {
    console.log(JSON.stringify({ at: new Date().toISOString(), health, errors }, null, 2));
    throw new Error('no GPU samples collected');
  }
  const baseline = samples.find((s) => s.gpuProfile === 'native') || samples[0];
  const comparisons = samples
    .filter((s) => s !== baseline)
    .map((s) => ({
      gpuProfile: s.gpuProfile,
      storedProfile: s.storedProfile,
      rendererChanged: s.webgl.unmaskedRenderer !== baseline.webgl.unmaskedRenderer,
      checks: compare(baseline, s),
    }));

  const nvidia = /NVIDIA/i.test(String(baseline.webgl.unmaskedRenderer || ''));
  const looks1080 = /1080\s*Ti/i.test(String(baseline.webgl.unmaskedRenderer || ''));
  const spoofApplied = comparisons.some((c) => c.rendererChanged);

  const report = {
    at: new Date().toISOString(),
    health,
    hostHint: {
      nvidiaRenderer: nvidia,
      mentions1080Ti: looks1080,
      spoofApplied,
      note: spoofApplied
        ? 'UNMASKED_RENDERER changed with session gpuProfile (Chromium patch is live).'
        : 'UNMASKED_RENDERER identical across profiles. Chromium still reports the real card; rebuild Chrome to apply --nya-gpu-model.',
    },
    baseline: {
      gpuProfile: baseline.gpuProfile,
      unmaskedVendor: baseline.webgl.unmaskedVendor,
      unmaskedRenderer: baseline.webgl.unmaskedRenderer,
      webglVersion: baseline.webgl.version,
      webgl2Version: baseline.webgl2.version,
      params: baseline.webgl.params,
      webgl2Params: baseline.webgl2.params,
      anisotropy: baseline.webgl.anisotropy,
      extensionCount: baseline.webgl.extensions.length,
      webgl2ExtensionCount: (baseline.webgl2.extensions || []).length,
      webgpu: baseline.webgpu,
      chromeGpu: baseline.chromeGpu,
    },
    samples: samples.map((s) => ({
      gpuProfile: s.gpuProfile,
      storedProfile: s.storedProfile,
      unmaskedRenderer: s.webgl.unmaskedRenderer,
      unmaskedVendor: s.webgl.unmaskedVendor,
      params: s.webgl.params,
      webgl2Params: s.webgl2.params,
      extensionCount: s.webgl.extensions.length,
      pixelsSha: s.webgl.pixelsSha,
      webgl2PixelsSha: s.webgl2.pixelsSha,
      webgpu: s.webgpu,
      webrtc: s.webrtc,
      media: s.media,
      geo: s.geo,
    })),
    comparisons,
    errors,
    extensions: baseline.webgl.extensions,
    webgl2Extensions: baseline.webgl2.extensions,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
