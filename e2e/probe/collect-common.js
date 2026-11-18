// Collectors that run in every context: window, iframe, dedicated/shared/service worker.
// Results must be structured-clone safe (plain objects, arrays, strings, numbers, booleans, null).
(function (scope) {
  const HIGH_ENTROPY_HINTS = [
    'architecture',
    'bitness',
    'brands',
    'formFactors',
    'fullVersionList',
    'mobile',
    'model',
    'platform',
    'platformVersion',
    'uaFullVersion',
    'wow64',
  ];

  const WEBGL1_PARAMS = [
    'ALIASED_LINE_WIDTH_RANGE',
    'ALIASED_POINT_SIZE_RANGE',
    'ALPHA_BITS',
    'BLUE_BITS',
    'DEPTH_BITS',
    'GREEN_BITS',
    'MAX_COMBINED_TEXTURE_IMAGE_UNITS',
    'MAX_CUBE_MAP_TEXTURE_SIZE',
    'MAX_FRAGMENT_UNIFORM_VECTORS',
    'MAX_RENDERBUFFER_SIZE',
    'MAX_TEXTURE_IMAGE_UNITS',
    'MAX_TEXTURE_SIZE',
    'MAX_VARYING_VECTORS',
    'MAX_VERTEX_ATTRIBS',
    'MAX_VERTEX_TEXTURE_IMAGE_UNITS',
    'MAX_VERTEX_UNIFORM_VECTORS',
    'MAX_VIEWPORT_DIMS',
    'RED_BITS',
    'RENDERER',
    'SAMPLES',
    'SAMPLE_BUFFERS',
    'SHADING_LANGUAGE_VERSION',
    'STENCIL_BITS',
    'SUBPIXEL_BITS',
    'VENDOR',
    'VERSION',
  ];

  const WEBGL2_PARAMS = [
    'MAX_3D_TEXTURE_SIZE',
    'MAX_ARRAY_TEXTURE_LAYERS',
    'MAX_CLIENT_WAIT_TIMEOUT_WEBGL',
    'MAX_COLOR_ATTACHMENTS',
    'MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS',
    'MAX_COMBINED_UNIFORM_BLOCKS',
    'MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS',
    'MAX_DRAW_BUFFERS',
    'MAX_ELEMENT_INDEX',
    'MAX_ELEMENTS_INDICES',
    'MAX_ELEMENTS_VERTICES',
    'MAX_FRAGMENT_INPUT_COMPONENTS',
    'MAX_FRAGMENT_UNIFORM_BLOCKS',
    'MAX_FRAGMENT_UNIFORM_COMPONENTS',
    'MAX_PROGRAM_TEXEL_OFFSET',
    'MAX_SAMPLES',
    'MAX_SERVER_WAIT_TIMEOUT',
    'MAX_TEXTURE_LOD_BIAS',
    'MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS',
    'MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS',
    'MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS',
    'MAX_UNIFORM_BLOCK_SIZE',
    'MAX_UNIFORM_BUFFER_BINDINGS',
    'MAX_VARYING_COMPONENTS',
    'MAX_VERTEX_OUTPUT_COMPONENTS',
    'MAX_VERTEX_UNIFORM_BLOCKS',
    'MAX_VERTEX_UNIFORM_COMPONENTS',
    'MIN_PROGRAM_TEXEL_OFFSET',
    'UNIFORM_BUFFER_OFFSET_ALIGNMENT',
  ];

  function plain(value) {
    if (value == null) return null;
    if (typeof value === 'bigint') return String(value);
    if (ArrayBuffer.isView(value)) return Array.from(value);
    if (Array.isArray(value)) return value.map(plain);
    if (typeof value === 'object') {
      const out = {};
      for (const key of Object.keys(value)) out[key] = plain(value[key]);
      return out;
    }
    return value;
  }

  async function safe(fn, fallback = null) {
    try {
      return await fn();
    } catch (err) {
      return { error: String((err && err.name) || 'Error') + ': ' + String((err && err.message) || err), fallback };
    }
  }

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve({ error: 'timeout: ' + label }), ms)),
    ]);
  }

  async function identity() {
    const nav = scope.navigator;
    const out = {
      userAgent: nav.userAgent,
      appVersion: nav.appVersion,
      platform: nav.platform,
      vendor: nav.vendor === undefined ? null : nav.vendor,
      product: nav.product === undefined ? null : nav.product,
      productSub: nav.productSub === undefined ? null : nav.productSub,
      vendorSub: nav.vendorSub === undefined ? null : nav.vendorSub,
      oscpu: nav.oscpu === undefined ? null : nav.oscpu,
      buildID: nav.buildID === undefined ? null : nav.buildID,
      language: nav.language,
      languages: Array.from(nav.languages || []),
      hardwareConcurrency: nav.hardwareConcurrency,
      deviceMemory: nav.deviceMemory === undefined ? null : nav.deviceMemory,
      isSecureContext: scope.isSecureContext,
      uaData: null,
      highEntropy: null,
    };
    if (nav.userAgentData) {
      out.uaData = plain(nav.userAgentData.toJSON());
      out.highEntropy = await safe(async () => plain(await nav.userAgentData.getHighEntropyValues(HIGH_ENTROPY_HINTS)));
    }
    return out;
  }

  function newCanvas() {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(64, 64);
    if (scope.document) {
      const c = scope.document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      return c;
    }
    return null;
  }

  function shaderPrecision(gl) {
    const out = {};
    for (const shader of ['VERTEX_SHADER', 'FRAGMENT_SHADER']) {
      for (const kind of ['LOW_FLOAT', 'MEDIUM_FLOAT', 'HIGH_FLOAT', 'LOW_INT', 'MEDIUM_INT', 'HIGH_INT']) {
        const f = gl.getShaderPrecisionFormat(gl[shader], gl[kind]);
        out[shader + '.' + kind] = f ? [f.rangeMin, f.rangeMax, f.precision] : null;
      }
    }
    return out;
  }

  /** Driver-dependent values outside getParameter's common list. */
  function webglExtra(gl, kind) {
    const out = {};
    const read = (key, fn) => {
      try {
        out[key] = plain(fn());
      } catch (err) {
        out[key] = 'error:' + String((err && err.name) || err);
      }
    };
    read('readFormat', () => gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT));
    read('readType', () => gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE));
    const timer = gl.getExtension(kind === 'webgl2' ? 'EXT_disjoint_timer_query_webgl2' : 'EXT_disjoint_timer_query');
    if (timer) {
      const query = kind === 'webgl2' ? (t, p) => gl.getQuery(t, p) : (t, p) => timer.getQueryEXT(t, p);
      read('timerBits', () => query(timer.TIME_ELAPSED_EXT, timer.QUERY_COUNTER_BITS_EXT));
      read('timestampBits', () => query(timer.TIMESTAMP_EXT, timer.QUERY_COUNTER_BITS_EXT));
    }
    const drawBuffers = gl.getExtension('WEBGL_draw_buffers');
    if (drawBuffers) read('maxDrawBuffersWebgl', () => gl.getParameter(drawBuffers.MAX_DRAW_BUFFERS_WEBGL));
    const multiview = gl.getExtension('OVR_multiview2');
    if (multiview) read('maxViewsOvr', () => gl.getParameter(multiview.MAX_VIEWS_OVR));
    if (kind === 'webgl2') {
      gl.getExtension('EXT_color_buffer_float');
      out.samples = {};
      for (const fmt of ['RGBA8', 'SRGB8_ALPHA8', 'RGB565', 'DEPTH24_STENCIL8', 'DEPTH_COMPONENT32F', 'RGBA16F', 'RGBA32F', 'R11F_G11F_B10F', 'RGBA8UI']) {
        try {
          out.samples[fmt] = plain(gl.getInternalformatParameter(gl.RENDERBUFFER, gl[fmt], gl.SAMPLES));
        } catch (err) {
          out.samples[fmt] = 'error:' + String((err && err.name) || err);
        }
      }
      read('maxTextureLodBias', () => gl.getParameter(gl.MAX_TEXTURE_LOD_BIAS));
    }
    return out;
  }

  /** Max JS recursion depth: depends on the thread's stack size per platform. */
  function stackDepth() {
    let depth = 0;
    const f = () => {
      depth += 1;
      f();
    };
    try {
      f();
    } catch {
      // RangeError: Maximum call stack size exceeded
    }
    return depth;
  }

  /** Canvas text metrics in this context (workers use OffscreenCanvas). */
  function textMetrics() {
    if (typeof OffscreenCanvas === 'undefined') return null;
    const g = new OffscreenCanvas(300, 60).getContext('2d');
    if (!g) return null;
    const out = {};
    for (const font of ['16px Arial', '16px "Segoe UI"', '16px sans-serif', '16px serif', '16px monospace', '16px "Microsoft YaHei"', '16px system-ui']) {
      g.font = font;
      const m = g.measureText('The quick brown fox 0123 你好');
      out[font] = [m.width, m.actualBoundingBoxAscent, m.actualBoundingBoxDescent, m.fontBoundingBoxAscent, m.fontBoundingBoxDescent]
        .map((v) => Math.round(v * 1000) / 1000)
        .join('|');
    }
    return out;
  }

  function webglInfo(kind) {
    const canvas = newCanvas();
    if (!canvas) return { available: false, reason: 'no-canvas' };
    let gl = null;
    try {
      gl = canvas.getContext(kind);
    } catch (err) {
      return { available: false, reason: String(err) };
    }
    if (!gl) return { available: false, reason: 'no-context' };
    const params = {};
    const names = kind === 'webgl2' ? WEBGL1_PARAMS.concat(WEBGL2_PARAMS) : WEBGL1_PARAMS;
    for (const name of names) {
      const enumValue = gl[name];
      if (enumValue === undefined) continue;
      try {
        params[name] = plain(gl.getParameter(enumValue));
      } catch (err) {
        params[name] = { error: String(err) };
      }
    }
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    const out = {
      available: true,
      params,
      unmaskedVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
      unmaskedRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
      maxAnisotropy: aniso ? gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : null,
      extensions: (gl.getSupportedExtensions() || []).slice().sort(),
      extensionOrder: gl.getSupportedExtensions() || [],
      precision: shaderPrecision(gl),
      contextAttributes: plain(gl.getContextAttributes()),
      extra: webglExtra(gl, kind),
    };
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return out;
  }

  async function webgpuInfo() {
    const gpu = scope.navigator.gpu;
    if (!gpu) return { available: false, reason: 'no-navigator-gpu' };
    const adapter = await withTimeout(gpu.requestAdapter(), 5000, 'requestAdapter');
    if (!adapter) return { available: false, reason: 'no-adapter' };
    if (adapter.error) return { available: false, reason: adapter.error };
    const info = adapter.info || {};
    const limits = {};
    const proto = Object.getPrototypeOf(adapter.limits);
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor') continue;
      const v = adapter.limits[key];
      if (typeof v === 'number' || typeof v === 'bigint') limits[key] = plain(v);
    }
    return {
      available: true,
      info: {
        vendor: info.vendor ?? null,
        architecture: info.architecture ?? null,
        device: info.device ?? null,
        description: info.description ?? null,
        subgroupMinSize: info.subgroupMinSize ?? null,
        subgroupMaxSize: info.subgroupMaxSize ?? null,
        isFallbackAdapter: info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null,
      },
      features: Array.from(adapter.features || []).sort(),
      limits,
      preferredCanvasFormat: gpu.getPreferredCanvasFormat ? gpu.getPreferredCanvasFormat() : null,
      wgslLanguageFeatures: gpu.wgslLanguageFeatures ? Array.from(gpu.wgslLanguageFeatures).sort() : null,
    };
  }

  async function echoHeaders(ctx) {
    const run = scope.__nyaRun || '';
    const res = await fetch('/api/echo?ctx=' + encodeURIComponent(ctx) + '&run=' + encodeURIComponent(run), {
      cache: 'no-store',
    });
    const body = await res.json();
    return body.headers || {};
  }

  async function collectCommon(ctx) {
    const started = Date.now();
    const out = { ctx };
    out.identity = await safe(identity);
    out.webgl = await safe(async () => webglInfo('webgl'));
    out.webgl2 = await safe(async () => webglInfo('webgl2'));
    out.webgpu = await safe(webgpuInfo);
    out.headers = await safe(() => echoHeaders(ctx));
    out.runtime = await safe(async () => ({ stackDepth: stackDepth(), textMetrics: textMetrics() }));
    out.elapsedMs = Date.now() - started;
    return out;
  }

  scope.nyaCollectCommon = collectCommon;
  scope.nyaProbeUtil = { plain, safe, withTimeout };
})(self);
