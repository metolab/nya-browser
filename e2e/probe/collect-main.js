// Window-only collectors: fonts, theme, screen, media, API surface, render hashes.
(function (scope) {
  const { plain, safe, withTimeout } = scope.nyaProbeUtil;

  const WINDOWS_FONTS = [
    'Arial', 'Arial Black', 'Arial Narrow', 'Bahnschrift', 'Calibri', 'Calibri Light', 'Cambria', 'Cambria Math',
    'Candara', 'Cascadia Code', 'Cascadia Mono', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier',
    'Courier New', 'DengXian', 'Ebrima', 'FangSong', 'Franklin Gothic Medium', 'Gabriola', 'Gadugi', 'Georgia',
    'HoloLens MDL2 Assets', 'Impact', 'Ink Free', 'Javanese Text', 'KaiTi', 'Leelawadee UI', 'Lucida Console',
    'Lucida Sans Unicode', 'Malgun Gothic', 'Malgun Gothic Semilight', 'Marlett', 'Microsoft Himalaya',
    'Microsoft JhengHei', 'Microsoft JhengHei UI', 'Microsoft New Tai Lue', 'Microsoft PhagsPa',
    'Microsoft Sans Serif', 'Microsoft Tai Le', 'Microsoft Uighur', 'Microsoft YaHei', 'Microsoft YaHei UI',
    'Microsoft Yi Baiti', 'MingLiU-ExtB', 'Mongolian Baiti', 'MS Gothic', 'MS PGothic', 'MS UI Gothic', 'MV Boli',
    'Myanmar Text', 'Nirmala UI', 'NSimSun', 'Palatino Linotype', 'Segoe Fluent Icons', 'Segoe MDL2 Assets',
    'Segoe Print', 'Segoe Script', 'Segoe UI', 'Segoe UI Black', 'Segoe UI Emoji', 'Segoe UI Historic',
    'Segoe UI Light', 'Segoe UI Semibold', 'Segoe UI Semilight', 'Segoe UI Symbol', 'Segoe UI Variable', 'SimHei',
    'SimSun', 'SimSun-ExtB', 'Sitka Banner', 'Sitka Display', 'Sitka Heading', 'Sitka Small', 'Sitka Subheading',
    'Sitka Text', 'Sylfaen', 'Symbol', 'Tahoma', 'Times', 'Times New Roman', 'Trebuchet MS', 'Urdu Typesetting',
    'Verdana', 'Webdings', 'Wingdings', 'Yu Gothic', 'Yu Gothic Light', 'Yu Gothic UI', 'Aptos', 'Aptos Display',
    'Aptos Narrow',
    'Candara Light', 'Corbel Light', 'DengXian Light', 'Leelawadee UI Semilight', 'Microsoft JhengHei Light',
    'Microsoft JhengHei UI Light', 'Microsoft YaHei Light', 'Microsoft YaHei UI Light', 'MingLiU_HKSCS-ExtB',
    'MingLiU_MSCS-ExtB', 'Nirmala Text', 'Nirmala Text Semilight', 'Nirmala UI Semilight', 'Noto Sans SC',
    'Noto Serif SC', 'PMingLiU-ExtB', 'Sans Serif Collection', 'SimSun-ExtG', 'Sitka', 'Yu Gothic Medium',
    'Yu Gothic UI Light', 'Yu Gothic UI Semibold', 'Yu Gothic UI Semilight',
  ];

  const LINUX_FONTS = [
    'Liberation Sans', 'Liberation Serif', 'Liberation Mono', 'DejaVu Sans', 'DejaVu Serif', 'DejaVu Sans Mono',
    'Noto Sans', 'Noto Serif', 'Noto Sans CJK SC', 'Noto Serif CJK SC', 'Noto Sans Mono CJK SC', 'Noto Color Emoji',
    'WenQuanYi Micro Hei', 'WenQuanYi Zen Hei', 'IPAGothic', 'IPAMincho', 'NanumGothic', 'Carlito', 'Caladea',
    'Ubuntu', 'Cantarell', 'Droid Sans', 'FreeSans', 'FreeSerif', 'Nimbus Sans', 'Bitstream Vera Sans',
  ];

  const METRIC_FONTS = [
    'Arial', 'Times New Roman', 'Courier New', 'Segoe UI', 'Segoe UI Emoji', 'Microsoft YaHei', 'SimSun', 'SimHei',
    'Consolas', 'Calibri', 'Cambria', 'Tahoma', 'Verdana', 'Georgia', 'Trebuchet MS', 'Lucida Console', 'Impact',
    'Comic Sans MS', 'Malgun Gothic', 'Yu Gothic', 'MS Gothic',
  ];

  const METRIC_TEXTS = {
    latin: 'mmmmmmmmmmlli The quick brown fox 0123456789',
    cjkSc: '你好世界汉字测试中文排版',
    kana: 'あいうえおカタカナ',
    hangul: '한국어 텍스트',
    symbols: '→★♠♣©®™€£¥',
  };

  const EMOJI = ['😀', '👍', '🇨🇳', '👨‍👩‍👧', '❤️', '✅', '🦄', '🧑🏽‍💻'];

  const GENERIC_FAMILIES = ['serif', 'sans-serif', 'monospace', 'system-ui', 'cursive', 'fantasy', 'math'];

  const SYSTEM_COLORS = [
    'AccentColor', 'AccentColorText', 'ActiveText', 'ButtonBorder', 'ButtonFace', 'ButtonText', 'Canvas',
    'CanvasText', 'Field', 'FieldText', 'GrayText', 'Highlight', 'HighlightText', 'LinkText', 'Mark', 'MarkText',
    'SelectedItem', 'SelectedItemText', 'VisitedText', 'ActiveBorder', 'ActiveCaption', 'AppWorkspace',
    'Background', 'ButtonHighlight', 'ButtonShadow', 'CaptionText', 'InactiveBorder', 'InactiveCaption',
    'InactiveCaptionText', 'InfoBackground', 'InfoText', 'Menu', 'MenuText', 'Scrollbar', 'ThreeDDarkShadow',
    'ThreeDFace', 'ThreeDHighlight', 'ThreeDLightShadow', 'ThreeDShadow', 'Window', 'WindowFrame', 'WindowText',
  ];

  const MEDIA_QUERIES = [
    '(pointer: fine)', '(pointer: coarse)', '(any-pointer: fine)', '(any-pointer: coarse)', '(hover: hover)',
    '(any-hover: hover)', '(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)',
    '(prefers-contrast: more)', '(forced-colors: active)', '(inverted-colors: inverted)',
    '(prefers-reduced-transparency: reduce)', '(dynamic-range: high)', '(color-gamut: srgb)', '(color-gamut: p3)',
    '(monochrome)', '(update: fast)', '(scripting: enabled)', '(display-mode: browser)', '(orientation: landscape)',
  ];

  const MEDIA_TYPES = [
    'video/mp4; codecs="avc1.42E01E"', 'video/mp4; codecs="avc1.640028"', 'video/mp4; codecs="hev1.1.6.L93.B0"',
    'video/mp4; codecs="hvc1.1.6.L93.B0"', 'video/mp4; codecs="av01.0.05M.08"', 'video/mp4; codecs="vp09.00.10.08"',
    'video/mp4; codecs="dvh1.05.06"', 'video/webm; codecs="vp8"', 'video/webm; codecs="vp9"',
    'video/webm; codecs="av01.0.05M.08"', 'video/ogg; codecs="theora"', 'audio/mp4; codecs="mp4a.40.2"',
    'audio/mp4; codecs="ac-3"', 'audio/mp4; codecs="ec-3"', 'audio/mp4; codecs="flac"', 'audio/mpeg',
    'audio/ogg; codecs="opus"', 'audio/ogg; codecs="vorbis"', 'audio/webm; codecs="opus"', 'audio/flac',
    'audio/wav',
  ];

  const DECODING_CONFIGS = [
    ['avc1.640028', 'video/mp4'],
    ['hev1.1.6.L93.B0', 'video/mp4'],
    ['vp09.00.10.08', 'video/webm'],
    ['av01.0.05M.08', 'video/mp4'],
  ];

  const PERMISSIONS = [
    'geolocation', 'notifications', 'push', 'midi', 'camera', 'microphone', 'background-sync',
    'persistent-storage', 'accelerometer', 'gyroscope', 'magnetometer', 'clipboard-read', 'clipboard-write',
    'payment-handler', 'idle-detection', 'screen-wake-lock', 'nfc', 'display-capture', 'storage-access',
    'window-management', 'local-fonts', 'keyboard-lock', 'pointer-lock', 'fullscreen',
    'captured-surface-control', 'speaker-selection', 'system-wake-lock', 'top-level-storage-access',
    'background-fetch', 'periodic-background-sync',
  ];

  const API_PROTOTYPES = [
    'Navigator', 'Document', 'Element', 'HTMLElement', 'HTMLMediaElement', 'HTMLCanvasElement', 'Screen',
    'Window', 'CanvasRenderingContext2D', 'WebGL2RenderingContext', 'MediaDevices', 'Performance',
  ];

  function hash(str) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i += 1) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }

  const ctx2d = document.createElement('canvas').getContext('2d');

  function measure(fontCss, text) {
    ctx2d.font = fontCss;
    const m = ctx2d.measureText(text);
    return {
      width: Math.round(m.width * 1000) / 1000,
      ascent: Math.round(m.actualBoundingBoxAscent * 1000) / 1000,
      descent: Math.round(m.actualBoundingBoxDescent * 1000) / 1000,
    };
  }

  function fontAvailability() {
    const bases = ['monospace', 'serif', 'sans-serif'];
    const probeText = 'mmmmmmmmmmlli 你好 WwQq@#';
    const baseWidths = bases.map((b) => measure('48px ' + b, probeText).width);
    const names = Array.from(new Set(WINDOWS_FONTS.concat(LINUX_FONTS)));
    const out = {};
    for (const name of names) {
      let byMetrics = false;
      for (let i = 0; i < bases.length; i += 1) {
        if (measure('48px "' + name + '", ' + bases[i], probeText).width !== baseWidths[i]) {
          byMetrics = true;
          break;
        }
      }
      let byCheck = null;
      try {
        byCheck = document.fonts.check('16px "' + name + '"');
      } catch {
        byCheck = null;
      }
      out[name] = { metrics: byMetrics, check: byCheck };
    }
    return out;
  }

  async function localFonts() {
    if (!scope.queryLocalFonts) return { available: false };
    const fonts = await withTimeout(scope.queryLocalFonts(), 3000, 'queryLocalFonts');
    if (!Array.isArray(fonts)) return { available: true, result: fonts };
    return { available: true, families: Array.from(new Set(fonts.map((f) => f.family))).sort() };
  }

  function fontMetrics() {
    const out = {};
    for (const font of METRIC_FONTS) {
      out[font] = {};
      for (const [key, text] of Object.entries(METRIC_TEXTS)) {
        out[font][key] = measure('32px "' + font + '"', text);
      }
    }
    return out;
  }

  function domWidth(style, text, lang) {
    const span = document.createElement('span');
    span.textContent = text;
    span.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:nowrap;font-size:32px;' + style;
    if (lang) span.lang = lang;
    document.body.appendChild(span);
    const r = span.getBoundingClientRect();
    span.remove();
    return Math.round(r.width * 1000) / 1000;
  }

  function genericFamilies() {
    const out = {};
    for (const lang of ['en-US', 'zh-CN', 'ja-JP']) {
      out[lang] = {};
      for (const family of GENERIC_FAMILIES.concat(['__nya_missing_font__'])) {
        out[lang][family] = {};
        for (const [key, text] of Object.entries(METRIC_TEXTS)) {
          const css = family === '__nya_missing_font__' ? 'font-family:"__nya_missing_font__"' : 'font-family:' + family;
          out[lang][family][key] = domWidth(css, text, lang);
        }
      }
      out[lang].__named = {};
      for (const font of METRIC_FONTS) {
        out[lang].__named[font] = {};
        for (const [key, text] of Object.entries(METRIC_TEXTS)) {
          out[lang].__named[font][key] = domWidth('font-family:"' + font + '"', text, lang);
        }
      }
    }
    return out;
  }

  function emojiMetrics() {
    const out = {};
    for (const e of EMOJI) {
      out[e] = { canvas: measure('32px sans-serif', e), dom: domWidth('font-family:sans-serif', e) };
    }
    return out;
  }

  function systemColors(scheme) {
    const el = document.createElement('div');
    if (scheme) el.style.colorScheme = scheme;
    document.body.appendChild(el);
    const out = {};
    for (const name of SYSTEM_COLORS) {
      el.style.color = '';
      el.style.color = name;
      out[name] = el.style.color ? getComputedStyle(el).color : null;
    }
    el.remove();
    return out;
  }

  function scrollbars() {
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:-9999px;top:0;width:100px;height:100px;overflow:scroll;';
    document.body.appendChild(box);
    const out = {
      width: box.offsetWidth - box.clientWidth,
      height: box.offsetHeight - box.clientHeight,
    };
    box.style.scrollbarWidth = 'thin';
    out.thinWidth = box.offsetWidth - box.clientWidth;
    box.remove();
    return out;
  }

  function formControls() {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-9999px;top:0;';
    document.body.appendChild(host);
    const specs = [
      ['button', () => Object.assign(document.createElement('button'), { textContent: 'Button' })],
      ['select', () => {
        const s = document.createElement('select');
        s.appendChild(new Option('Option'));
        return s;
      }],
      ['select-multiple', () => {
        const s = document.createElement('select');
        s.multiple = true;
        s.appendChild(new Option('Option'));
        return s;
      }],
      ['textarea', () => document.createElement('textarea')],
      ['progress', () => document.createElement('progress')],
      ['meter', () => document.createElement('meter')],
    ];
    for (const type of ['text', 'password', 'number', 'search', 'email', 'date', 'time', 'datetime-local', 'month',
      'week', 'color', 'range', 'checkbox', 'radio', 'file']) {
      specs.push(['input-' + type, () => Object.assign(document.createElement('input'), { type })]);
    }
    const out = {};
    for (const [name, make] of specs) {
      const el = make();
      host.appendChild(el);
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out[name] = {
        width: Math.round(r.width * 1000) / 1000,
        height: Math.round(r.height * 1000) / 1000,
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
      };
    }
    // Separate locale date patterns (LocaleWin vs ICU) from glyph metrics.
    for (const type of ['date', 'time', 'datetime-local', 'month', 'week']) {
      for (const [tag, lang, font] of [
        ['en', 'en-US', ''],
        ['zh-arial', 'zh-CN', 'Arial'],
        ['en-arial', 'en-US', 'Arial'],
        ['ja', 'ja-JP', ''],
        ['de', 'de-DE', ''],
      ]) {
        const el = Object.assign(document.createElement('input'), { type, lang });
        if (font) el.style.fontFamily = font;
        host.appendChild(el);
        out[`input-${type}:${tag}`] = Math.round(el.getBoundingClientRect().width * 1000) / 1000;
      }
    }
    // Per-part widths: hide one shadow part at a time.
    const style = document.createElement('style');
    const parts = {
      picker: '::-webkit-calendar-picker-indicator',
      edit: '::-webkit-datetime-edit',
      year: '::-webkit-datetime-edit-year-field',
      month: '::-webkit-datetime-edit-month-field',
      day: '::-webkit-datetime-edit-day-field',
      hour: '::-webkit-datetime-edit-hour-field',
      minute: '::-webkit-datetime-edit-minute-field',
      text: '::-webkit-datetime-edit-text',
    };
    style.textContent = Object.entries(parts)
      .map(([k, sel]) => `.nya-hide-${k}${sel}{display:none}`)
      .join('\n');
    document.head.appendChild(style);
    for (const type of ['date', 'time']) {
      for (const k of Object.keys(parts)) {
        const el = Object.assign(document.createElement('input'), { type, className: `nya-hide-${k}` });
        host.appendChild(el);
        out[`input-${type}:hide-${k}`] = Math.round(el.getBoundingClientRect().width * 1000) / 1000;
      }
    }
    style.remove();
    // Strings DateTimeEditElement sizes its fields with (13.333px monospace).
    for (const text of ['275760', '12', '31', '23', '59', '/', ':', '年', '月', '日', '--', '0', '7']) {
      const span = document.createElement('span');
      span.style.cssText = 'font: 13.3333px monospace; white-space: pre;';
      span.textContent = text;
      host.appendChild(span);
      out[`mono13:${text}`] = Math.round(span.getBoundingClientRect().width * 1000) / 1000;
    }
    host.remove();
    return out;
  }

  async function screenInfo() {
    // Chromium on X11 can briefly push a window rect equal to the view rect.
    const until = Date.now() + 3000;
    while (Date.now() < until && !(scope.outerHeight > scope.innerHeight)) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const s = scope.screen;
    return {
      width: s.width,
      height: s.height,
      availWidth: s.availWidth,
      availHeight: s.availHeight,
      availLeft: s.availLeft ?? null,
      availTop: s.availTop ?? null,
      colorDepth: s.colorDepth,
      pixelDepth: s.pixelDepth,
      orientation: s.orientation ? s.orientation.type : null,
      isExtended: s.isExtended ?? null,
      devicePixelRatio: scope.devicePixelRatio,
      innerWidth: scope.innerWidth,
      innerHeight: scope.innerHeight,
      outerWidth: scope.outerWidth,
      outerHeight: scope.outerHeight,
      frameWidth: scope.outerWidth - scope.innerWidth,
      frameHeight: scope.outerHeight - scope.innerHeight,
      screenX: scope.screenX,
      screenY: scope.screenY,
    };
  }

  function mediaQueries() {
    const out = {};
    for (const q of MEDIA_QUERIES) out[q] = scope.matchMedia(q).matches;
    return out;
  }

  async function keyboardLayout() {
    if (!navigator.keyboard || !navigator.keyboard.getLayoutMap) return { available: false };
    const map = await withTimeout(navigator.keyboard.getLayoutMap(), 2000, 'getLayoutMap');
    if (!map || map.error) return { available: true, error: map && map.error };
    const keys = ['KeyA', 'KeyQ', 'KeyZ', 'Semicolon', 'Quote', 'Backquote', 'BracketLeft', 'IntlBackslash', 'Digit2'];
    const sample = {};
    for (const k of keys) sample[k] = map.get(k) ?? null;
    const all = Object.fromEntries([...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    return { available: true, size: map.size, sample, all };
  }

  /** Codecs and header extensions a real offer negotiates (vs getCapabilities). */
  async function sdpOffer() {
    if (typeof RTCPeerConnection === 'undefined') return { available: false };
    const pc = new RTCPeerConnection();
    try {
      pc.addTransceiver('audio');
      pc.addTransceiver('video');
      const offer = await withTimeout(pc.createOffer(), 5000, 'createOffer');
      if (!offer || offer.error) return { available: true, error: offer && offer.error };
      const out = {};
      let kind = null;
      let names = {};
      let fmtp = {};
      const flush = () => {
        if (!kind) return;
        const codecs = Object.entries(names).map(([pt, name]) => {
          const params = (fmtp[pt] || '').split(';').filter((p) => p && !p.startsWith('apt=')).sort().join(';');
          return name + (params ? ';' + params : '');
        });
        out[kind] = Array.from(new Set(codecs)).sort();
      };
      for (const line of offer.sdp.split(/\r?\n/)) {
        const m = /^m=(\w+) /.exec(line);
        if (m) {
          flush();
          kind = m[1];
          names = {};
          fmtp = {};
          out[kind + 'Extmap'] = [];
          continue;
        }
        let r = /^a=rtpmap:(\d+) (.+)$/.exec(line);
        if (r) names[r[1]] = r[2];
        r = /^a=fmtp:(\d+) (.+)$/.exec(line);
        if (r) fmtp[r[1]] = r[2];
        r = /^a=extmap:\d+ (\S+)/.exec(line);
        if (r && kind) out[kind + 'Extmap'].push(r[1]);
      }
      flush();
      return { available: true, ...out };
    } finally {
      pc.close();
    }
  }

  const WEBCODECS_VIDEO = ['avc1.42001E', 'avc1.640028', 'hev1.1.6.L93.B0', 'vp8', 'vp09.00.10.08', 'av01.0.04M.08'];

  async function webCodecs() {
    if (typeof VideoDecoder === 'undefined') return { available: false };
    const out = {};
    const check = async (key, fn) => {
      out[key] = await safe(async () => {
        const r = await withTimeout(fn(), 4000, key);
        return r && r.error ? r.error : Boolean(r && r.supported);
      });
    };
    for (const codec of WEBCODECS_VIDEO) {
      for (const hw of ['no-preference', 'prefer-hardware', 'prefer-software']) {
        await check(`decode:${codec}:${hw}`, () =>
          VideoDecoder.isConfigSupported({ codec, codedWidth: 1920, codedHeight: 1080, hardwareAcceleration: hw }));
        await check(`encode:${codec}:${hw}`, () =>
          VideoEncoder.isConfigSupported({ codec, width: 1280, height: 720, bitrate: 2000000, framerate: 30, hardwareAcceleration: hw }));
      }
    }
    for (const codec of ['opus', 'mp4a.40.2', 'flac', 'vorbis', 'mp3', 'alaw', 'ulaw', 'pcm-s16']) {
      await check(`audio-decode:${codec}`, () => AudioDecoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2 }));
      await check(`audio-encode:${codec}`, () => AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 }));
    }
    return out;
  }

  function codecSupport() {
    const video = document.createElement('video');
    const out = {};
    for (const type of MEDIA_TYPES) {
      out[type] = {
        canPlayType: video.canPlayType(type),
        mse: typeof MediaSource !== 'undefined' ? MediaSource.isTypeSupported(type) : null,
      };
    }
    return out;
  }

  async function decodingInfo() {
    if (!navigator.mediaCapabilities) return { available: false };
    const out = {};
    for (const [codec, container] of DECODING_CONFIGS) {
      for (const type of ['file', 'media-source']) {
        const key = type + ':' + codec;
        out[key] = await safe(async () => {
          const r = await navigator.mediaCapabilities.decodingInfo({
            type,
            video: {
              contentType: container + '; codecs="' + codec + '"',
              width: 1920,
              height: 1080,
              bitrate: 5000000,
              framerate: 30,
            },
          });
          return { supported: r.supported, smooth: r.smooth, powerEfficient: r.powerEfficient };
        });
      }
    }
    for (const codec of ['video/H264', 'video/VP8', 'video/VP9', 'video/AV1', 'video/H265']) {
      out['webrtc-encode:' + codec] = await safe(async () => {
        const r = await navigator.mediaCapabilities.encodingInfo({
          type: 'webrtc',
          video: { contentType: codec, width: 1280, height: 720, bitrate: 2000000, framerate: 30 },
        });
        return { supported: r.supported, smooth: r.smooth, powerEfficient: r.powerEfficient };
      });
      out['webrtc-decode:' + codec] = await safe(async () => {
        const r = await navigator.mediaCapabilities.decodingInfo({
          type: 'webrtc',
          video: { contentType: codec, width: 1920, height: 1080, bitrate: 4000000, framerate: 30 },
        });
        return { supported: r.supported, smooth: r.smooth, powerEfficient: r.powerEfficient };
      });
    }
    return out;
  }

  async function eme() {
    if (!navigator.requestMediaKeySystemAccess) return { available: false };
    const out = {};
    const systems = ['com.widevine.alpha', 'org.w3.clearkey', 'com.microsoft.playready', 'com.microsoft.playready.recommendation'];
    const robustness = ['', 'SW_SECURE_CRYPTO', 'SW_SECURE_DECODE', 'HW_SECURE_CRYPTO', 'HW_SECURE_DECODE', 'HW_SECURE_ALL'];
    for (const ks of systems) {
      out[ks] = {};
      const levels = ks === 'com.widevine.alpha' ? robustness : [''];
      for (const level of levels) {
        const r = await withTimeout(
          navigator
            .requestMediaKeySystemAccess(ks, [{
              initDataTypes: ['cenc'],
              videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"', robustness: level }],
            }])
            .then(() => true, () => false),
          4000,
          'eme',
        );
        out[ks][level || 'default'] = r === true;
      }
    }
    return out;
  }

  async function voices() {
    if (!scope.speechSynthesis) return { available: false };
    let list = speechSynthesis.getVoices();
    const started = Date.now();
    while (!list.length && Date.now() - started < 3000) {
      await new Promise((r) => setTimeout(r, 200));
      list = speechSynthesis.getVoices();
    }
    return {
      available: true,
      voices: list.map((v) => ({ name: v.name, lang: v.lang, localService: v.localService, default: v.default, voiceURI: v.voiceURI })),
    };
  }

  function rtcCapabilities() {
    if (typeof RTCRtpSender === 'undefined') return { available: false };
    const pick = (caps) => (caps ? caps.codecs.map((c) => c.mimeType + (c.sdpFmtpLine ? ';' + c.sdpFmtpLine : '')).sort() : null);
    return {
      available: true,
      senderVideo: pick(RTCRtpSender.getCapabilities('video')),
      senderAudio: pick(RTCRtpSender.getCapabilities('audio')),
      receiverVideo: pick(RTCRtpReceiver.getCapabilities('video')),
      receiverAudio: pick(RTCRtpReceiver.getCapabilities('audio')),
    };
  }

  async function audioInfo() {
    const out = {};
    const AC = scope.AudioContext;
    if (AC) {
      const ac = new AC();
      out.context = {
        sampleRate: ac.sampleRate,
        baseLatency: ac.baseLatency ?? null,
        outputLatency: ac.outputLatency ?? null,
        state: ac.state,
        maxChannelCount: ac.destination.maxChannelCount,
        channelCount: ac.destination.channelCount,
        channelCountMode: ac.destination.channelCountMode,
        channelInterpretation: ac.destination.channelInterpretation,
      };
      await ac.close();
    }
    out.offlineHash = await safe(async () => {
      const oac = new OfflineAudioContext(1, 5000, 44100);
      const osc = oac.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = 10000;
      const comp = oac.createDynamicsCompressor();
      osc.connect(comp);
      comp.connect(oac.destination);
      osc.start(0);
      const buf = await oac.startRendering();
      const data = buf.getChannelData(0);
      let sum = 0;
      for (let i = 4500; i < 5000; i += 1) sum += Math.abs(data[i]);
      return String(sum);
    });
    return out;
  }

  function apiSurface() {
    const out = {
      window: Object.getOwnPropertyNames(scope).filter((n) => !n.startsWith('__nya') && !n.startsWith('nya')).sort(),
    };
    for (const name of API_PROTOTYPES) {
      const ctor = scope[name];
      out[name] = ctor && ctor.prototype ? Object.getOwnPropertyNames(ctor.prototype).sort() : null;
    }
    return out;
  }

  async function permissions() {
    if (!navigator.permissions) return { available: false };
    const out = {};
    for (const name of PERMISSIONS) {
      const desc = name === 'push' ? { name, userVisibleOnly: true } : { name };
      out[name] = await withTimeout(
        navigator.permissions.query(desc).then((s) => s.state, (e) => 'error:' + e.name),
        2000,
        'permission ' + name,
      );
      if (out[name] && out[name].error) out[name] = 'timeout';
    }
    return out;
  }

  async function devices() {
    const out = {};
    out.battery = await safe(async () => {
      if (!navigator.getBattery) return { available: false };
      const b = await withTimeout(navigator.getBattery(), 2000, 'getBattery');
      if (b.error) return b;
      return { charging: b.charging, chargingTime: b.chargingTime, dischargingTime: b.dischargingTime, level: b.level };
    });
    out.bluetooth = await safe(async () => {
      if (!navigator.bluetooth) return { available: false };
      return { availability: await withTimeout(navigator.bluetooth.getAvailability(), 2000, 'bluetooth') };
    });
    out.relatedApps = await safe(async () => {
      if (!navigator.getInstalledRelatedApps) return { available: false };
      const apps = await withTimeout(navigator.getInstalledRelatedApps(), 2000, 'relatedApps');
      return { available: true, count: Array.isArray(apps) ? apps.length : null };
    });
    out.mediaDevices = await safe(async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return { available: false };
      const list = await navigator.mediaDevices.enumerateDevices();
      return {
        available: true,
        devices: list.map((d) => ({ kind: d.kind, label: d.label, deviceId: d.deviceId ? (d.deviceId === 'default' || d.deviceId === 'communications' ? d.deviceId : 'id') : '' })),
        supportedConstraints: Object.keys(navigator.mediaDevices.getSupportedConstraints()).sort(),
      };
    });
    out.notification = typeof Notification !== 'undefined'
      ? { permission: Notification.permission, maxActions: Notification.maxActions ?? null }
      : { available: false };
    out.presence = {};
    for (const name of ['hid', 'serial', 'usb', 'xr', 'gpu', 'ml', 'bluetooth', 'share', 'canShare', 'contacts',
      'windowControlsOverlay', 'ink', 'virtualKeyboard', 'wakeLock', 'scheduling', 'login', 'credentials',
      'managed', 'devicePosture', 'keyboard', 'locks', 'storageBuckets', 'getInstalledRelatedApps', 'presentation',
      'setAppBadge', 'getGamepads', 'requestMIDIAccess', 'userActivation']) {
      out.presence[name] = name in navigator;
    }
    return out;
  }

  function misc() {
    const intl = Intl.DateTimeFormat().resolvedOptions();
    return {
      pdfViewerEnabled: navigator.pdfViewerEnabled,
      webdriver: navigator.webdriver,
      plugins: Array.from(navigator.plugins || []).map((p) => p.name),
      mimeTypes: Array.from(navigator.mimeTypes || []).map((m) => m.type),
      doNotTrack: navigator.doNotTrack,
      cookieEnabled: navigator.cookieEnabled,
      maxTouchPoints: navigator.maxTouchPoints,
      intl: { locale: intl.locale, timeZone: intl.timeZone, calendar: intl.calendar, numberingSystem: intl.numberingSystem },
      timezoneOffset: new Date().getTimezoneOffset(),
      chromeKeys: scope.chrome ? Object.keys(scope.chrome).sort() : null,
      jsHeapSizeLimit: performance.memory ? performance.memory.jsHeapSizeLimit : null,
      connection: navigator.connection
        ? { effectiveType: navigator.connection.effectiveType, saveData: navigator.connection.saveData, type: navigator.connection.type ?? null }
        : null,
    };
  }

  // Per-glyph advances across fractional sizes: separates DirectWrite natural
  // (linear) from GDI-classic (integer, bitmap-strike) measuring per font.
  function glyphAdvances() {
    const fonts = ['NSimSun', 'SimSun', 'MS Gothic', 'MS PGothic', 'MingLiU', 'Gulim', 'Consolas',
      'Courier New', 'Arial', 'Segoe UI', 'Microsoft YaHei', 'Calibri', 'Times New Roman', 'Tahoma'];
    const sizes = [9.5, 10.5, 11.3333, 12, 12.5, 13, 13.3333, 13.5, 14.5, 15.5, 16, 16.4, 17.5, 18.5, 20.25];
    const chars = { half: '0', full: '\u5E74', a: 'a', W: 'W' };
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:pre;';
    document.body.appendChild(host);
    const out = {};
    for (const font of fonts) {
      const row = {};
      for (const size of sizes) {
        const cell = [];
        for (const ch of Object.values(chars)) {
          const span = document.createElement('span');
          span.style.cssText = `font-family:"${font}";font-size:${size}px;`;
          span.textContent = ch.repeat(10);
          host.appendChild(span);
          cell.push(Math.round(span.getBoundingClientRect().width * 100) / 1000);
          span.remove();
        }
        row[size] = cell.join('|');
      }
      out[font] = row;
    }
    host.remove();
    return out;
  }

  async function env() {
    const out = {};
    out.cssSystemFonts = {};
    for (const kw of ['caption', 'icon', 'menu', 'message-box', 'small-caption', 'status-bar']) {
      const el = document.createElement('span');
      el.style.font = kw;
      document.body.appendChild(el);
      const cs = getComputedStyle(el);
      out.cssSystemFonts[kw] = [cs.fontFamily, cs.fontSize, cs.fontWeight, cs.fontStyle].join('|');
      el.remove();
    }
    out.defaultFonts = {};
    for (const [tag, lang] of [['div', ''], ['div', 'zh-CN'], ['div', 'ja'], ['code', ''], ['pre', '']]) {
      const el = document.createElement(tag);
      if (lang) el.lang = lang;
      document.body.appendChild(el);
      const cs = getComputedStyle(el);
      out.defaultFonts[tag + (lang ? ':' + lang : '')] = cs.fontFamily + '|' + cs.fontSize;
      el.remove();
    }
    out.webauthn = await safe(async () => {
      if (!scope.PublicKeyCredential) return null;
      const r = {};
      r.uvpaa = await withTimeout(PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(), 3000, 'uvpaa');
      if (PublicKeyCredential.isConditionalMediationAvailable) {
        r.conditional = await withTimeout(PublicKeyCredential.isConditionalMediationAvailable(), 3000, 'conditional');
      }
      if (PublicKeyCredential.getClientCapabilities) {
        const caps = await withTimeout(PublicKeyCredential.getClientCapabilities(), 3000, 'caps');
        r.capabilities = Object.fromEntries(Object.entries(caps || {}).sort());
      }
      return r;
    });
    out.storage = await safe(async () => {
      const e = await withTimeout(navigator.storage.estimate(), 3000, 'estimate');
      return { quotaGiB: Math.round((e.quota / 2 ** 30) * 10) / 10, persisted: await navigator.storage.persisted() };
    });
    out.battery = await safe(async () => {
      if (!navigator.getBattery) return null;
      const b = await withTimeout(navigator.getBattery(), 3000, 'battery');
      return { charging: b.charging, level: b.level, chargingTime: b.chargingTime, dischargingTime: b.dischargingTime };
    });
    out.bluetooth = await safe(async () =>
      navigator.bluetooth ? withTimeout(navigator.bluetooth.getAvailability(), 3000, 'bluetooth') : null,
    );
    const d = new Date(Date.UTC(2024, 0, 2, 3, 4, 5));
    out.dates = {
      toString: d.toString().replace(/\d{2}:\d{2}:\d{2}/, 'T'),
      toLocaleString: d.toLocaleString(),
      toLocaleDateString: d.toLocaleDateString(),
      toLocaleTimeString: d.toLocaleTimeString(),
      dtf: new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'long' }).format(d),
    };
    out.notificationMaxActions = scope.Notification ? Notification.maxActions : null;
    out.rtcOrder = (() => {
      if (typeof RTCRtpSender === 'undefined') return null;
      const raw = (caps) => (caps ? caps.codecs.map((c) => c.mimeType + (c.sdpFmtpLine ? ';' + c.sdpFmtpLine : '')) : null);
      return { senderVideo: raw(RTCRtpSender.getCapabilities('video')), receiverVideo: raw(RTCRtpReceiver.getCapabilities('video')) };
    })();
    return out;
  }

  function canvasHash() {
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = 60;
    const g = c.getContext('2d');
    g.textBaseline = 'top';
    g.font = '16px Arial';
    g.fillStyle = '#f60';
    g.fillRect(100, 1, 62, 20);
    g.fillStyle = '#069';
    g.fillText('Nya probe 😀 你好', 2, 15);
    g.fillStyle = 'rgba(102, 204, 0, 0.7)';
    g.fillText('Nya probe 😀 你好', 4, 17);
    return hash(c.toDataURL());
  }

  function webglHash() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const gl = c.getContext('webgl');
    if (!gl) return null;
    gl.clearColor(0.2, 0.4, 0.6, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const px = new Uint8Array(64 * 64 * 4);
    gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let s = '';
    for (let i = 0; i < px.length; i += 97) s += px[i] + ',';
    return hash(s);
  }

  async function pixelIntegrity() {
    const out = {};
    for (const [name, style, exp] of [
      ['solidBlack', '#000000', [0, 0, 0, 255]],
      ['solidRed', 'rgb(255,0,0)', [255, 0, 0, 255]],
    ]) {
      const c = document.createElement('canvas');
      c.width = 8;
      c.height = 8;
      const g = c.getContext('2d');
      g.fillStyle = style;
      g.fillRect(0, 0, 8, 8);
      const d = g.getImageData(0, 0, 8, 8).data;
      let ok = true;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] !== exp[0] || d[i + 1] !== exp[1] || d[i + 2] !== exp[2] || d[i + 3] !== exp[3]) {
          ok = false;
          break;
        }
      }
      out[name] = ok;
    }
    const c2 = document.createElement('canvas');
    c2.width = 16;
    c2.height = 16;
    const g2 = c2.getContext('2d');
    const src = g2.createImageData(16, 16);
    for (let i = 0; i < src.data.length; i += 4) {
      src.data[i] = (i * 37) & 255;
      src.data[i + 1] = (i * 73) & 255;
      src.data[i + 2] = (i * 109) & 255;
      src.data[i + 3] = 255;
    }
    g2.putImageData(src, 0, 0);
    const full = g2.getImageData(0, 0, 16, 16).data;
    let putGet = true;
    for (let i = 0; i < full.length; i += 1) {
      if (full[i] !== src.data[i]) {
        putGet = false;
        break;
      }
    }
    out.putGet = putGet;
    const url = c2.toDataURL('image/png');
    out.toDataUrlRoundtrip = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c3 = document.createElement('canvas');
        c3.width = 16;
        c3.height = 16;
        const g3 = c3.getContext('2d');
        g3.drawImage(img, 0, 0);
        const back = g3.getImageData(0, 0, 16, 16).data;
        for (let i = 0; i < back.length; i += 1) {
          if (back[i] !== src.data[i]) return resolve(false);
        }
        resolve(true);
      };
      img.onerror = () => resolve(false);
      img.src = url;
    });
    const cw = document.createElement('canvas');
    cw.width = 16;
    cw.height = 16;
    const gl = cw.getContext('webgl');
    if (gl) {
      gl.clearColor(0, 1, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const px = new Uint8Array(16 * 16 * 4);
      gl.readPixels(0, 0, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let glOk = true;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] !== 0 || px[i + 1] !== 255 || px[i + 2] !== 0 || px[i + 3] !== 255) {
          glOk = false;
          break;
        }
      }
      out.webglReadPixels = glOk;
      const dbg = gl.getExtension('WEBGL_debug_shaders');
      if (dbg) {
        const fs = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fs, 'precision mediump float; void main() { gl_FragColor = vec4(1.0); }');
        gl.compileShader(fs);
        const translated = dbg.getTranslatedShaderSource(fs) || '';
        out.shaderIsHlsl = translated.includes('// INITIAL HLSL BEGIN') && translated.includes('// FRAGMENT SHADER END');
      }
    }
    if (typeof OfflineAudioContext !== 'undefined') {
      const ac = new OfflineAudioContext(1, 64, 44100);
      const buf = ac.createBuffer(1, 64, 44100);
      buf.getChannelData(0).fill(0.5);
      const ch = buf.getChannelData(0);
      out.audioExact = ch[0] === 0.5 && ch[63] === 0.5;
    }
    return out;
  }

  async function collectMain() {
    const started = Date.now();
    const out = {};
    out.fonts = await safe(async () => fontAvailability());
    out.localFonts = await safe(localFonts);
    out.fontMetrics = await safe(async () => fontMetrics());
    out.genericFamilies = await safe(async () => genericFamilies());
    out.emoji = await safe(async () => emojiMetrics());
    out.systemColors = await safe(async () => systemColors());
    out.systemColorsDark = await safe(async () => systemColors('dark'));
    out.scrollbars = await safe(async () => scrollbars());
    out.formControls = await safe(async () => formControls());
    out.screen = await safe(async () => screenInfo());
    out.mediaQueries = await safe(async () => mediaQueries());
    out.keyboard = await safe(keyboardLayout);
    out.codecs = await safe(async () => codecSupport());
    out.decoding = await safe(decodingInfo);
    out.eme = await safe(eme);
    out.voices = await safe(voices);
    out.rtc = await safe(async () => rtcCapabilities());
    out.sdp = await safe(sdpOffer);
    out.webcodecs = await safe(webCodecs);
    out.audio = await safe(audioInfo);
    out.api = await safe(async () => apiSurface());
    out.permissions = await safe(permissions);
    out.devices = await safe(devices);
    out.misc = await safe(async () => misc());
    out.env = await safe(env);
    out.glyphAdvances = await safe(async () => glyphAdvances());
    out.pixelIntegrity = await safe(pixelIntegrity);
    out.hashes = { canvas: await safe(async () => canvasHash()), webgl: await safe(async () => webglHash()), audio: out.audio && out.audio.offlineHash };
    out.elapsedMs = Date.now() - started;
    return plain(out);
  }

  scope.nyaCollectMain = collectMain;
})(window);
