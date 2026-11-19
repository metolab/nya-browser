// Metric extraction and rules for scripts/e2e-os.mjs (docs/windows-emulation.md, 5.4).
import fs from 'fs';
import path from 'path';

const WIN_IDENTITY = {
  win10: { chPlatformVersion: '10.0.0' },
  win11: { chPlatformVersion: '19.0.0' },
};
const WIN_UA_PLATFORM = 'Windows NT 10.0; Win64; x64';
const CONTEXTS = ['main', 'dedicatedWorker', 'sharedWorker', 'serviceWorker', 'iframe'];

export const CASES = {
  linux: { os: 'linux', session: { gpuProfile: 'native', os: 'linux' } },
  // 'offline' keeps the WebRTC API surface a real Chrome has.
  win11: { os: 'windows', release: 'win11', session: { gpuProfile: 'native', os: 'windows', windowsRelease: 'win11', webrtcMode: 'offline' } },
  win10: { os: 'windows', release: 'win10', session: { gpuProfile: 'native', os: 'windows', windowsRelease: 'win10', webrtcMode: 'offline' } },
  // A claimed card other than the host's: everything but the model is compared.
  'win11-gpu': {
    os: 'windows',
    release: 'win11',
    gpu: { angleName: 'GeForce RTX 3070', deviceId: '2484', architecture: 'ampere' },
    session: { gpuProfile: 'rtx-3070', os: 'windows', windowsRelease: 'win11', webrtcMode: 'offline' },
  },
};

const sorted = (v) => (Array.isArray(v) ? [...v].sort() : v);
const unquote = (v) => (typeof v === 'string' ? v.replace(/^"|"$/g, '') : v);
const majorOf = (version) => String(version || '').split('.')[0];

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Chrome major differs between the baseline machine and Nya; compare shapes, not versions. */
function normalizeVersions(value) {
  return JSON.parse(
    JSON.stringify(value ?? null)
      .replace(/Chrome\/\d+(\.\d+){3}/g, 'Chrome/N')
      .replace(/(v=\\?")\d+(\.\d+)*(\\?")/g, '$1N$3')
      .replace(/("version":")\d+(\.\d+)*(")/g, '$1N$3')
      .replace(/("uaFullVersion":")[\d.]+(")/g, '$1N$2')
      .replace(/\b1\d\d\.0\.\d{4}\.\d+\b/g, 'N')
      // GREASE brand text is derived from the major version.
      .replace(/Not[^"\\]{0,4}A[^"\\]{0,4}Brand/g, 'GREASE'),
  );
}

function identity(report, ctx) {
  return report?.contexts?.[ctx]?.identity || null;
}

function headerSets(report) {
  const nav = report?.navigationHeaders || {};
  const out = {};
  for (const [key, value] of Object.entries(nav)) {
    if (key.endsWith(':history') || !value || typeof value !== 'object') continue;
    out[key] = value;
  }
  return out;
}

function perContext(report, pick) {
  const out = {};
  for (const ctx of CONTEXTS) {
    const id = identity(report, ctx);
    out[ctx] = id ? pick(id) : undefined;
  }
  return out;
}

function headerValues(report, name) {
  const out = {};
  for (const [src, headers] of Object.entries(headerSets(report))) {
    if (headers[name] !== undefined) out[src] = headers[name];
  }
  return out;
}

function allEqual(map, expected) {
  const bad = Object.entries(map).filter(([, v]) => !deepEqual(v, expected));
  return { ok: bad.length === 0 && Object.keys(map).length > 0, bad: Object.fromEntries(bad) };
}

export function availableFonts(fonts) {
  return Object.entries(fonts || {})
    .filter(([, v]) => v && v.metrics)
    .map(([k]) => k)
    .sort();
}

/** Host-independent metrics used for the Linux regression snapshot. */
export function snapshotMetrics(report) {
  const main = report.main || {};
  const id = identity(report, 'main') || {};
  const nav = headerSets(report).navigation || {};
  return normalizeVersions({
    'ID-01': perContext(report, (i) => i.userAgent),
    'ID-02': perContext(report, (i) => i.platform),
    'ID-03': perContext(report, (i) => i.uaData?.platform),
    'ID-04': perContext(report, (i) => i.highEntropy?.platformVersion),
    'ID-05': {
      architecture: id.highEntropy?.architecture,
      bitness: id.highEntropy?.bitness,
      wow64: id.highEntropy?.wow64,
      model: id.highEntropy?.model,
      formFactors: id.highEntropy?.formFactors,
    },
    'ID-06': {
      'sec-ch-ua-platform': nav['sec-ch-ua-platform'],
      'sec-ch-ua-platform-version': nav['sec-ch-ua-platform-version'],
      'sec-ch-ua-arch': nav['sec-ch-ua-arch'],
      'sec-ch-ua-bitness': nav['sec-ch-ua-bitness'],
    },
    'ID-09': id.uaData?.brands,
    'ID-10': { oscpu: id.oscpu, buildID: id.buildID },
    'FNT-01': main.fonts ? availableFonts(main.fonts) : null,
    'UI-01': main.systemColors || null,
    'UI-02': main.scrollbars || null,
    'MED-01': main.codecs || null,
    'MED-04': Array.isArray(main.voices?.voices) ? main.voices.voices.map((v) => `${v.name}|${v.lang}|${v.localService}`).sort() : null,
    'API-01': main.api ? Object.fromEntries(Object.entries(main.api).map(([k, v]) => [k, sorted(v)])) : null,
    'API-02': main.permissions || null,
  });
}

function windowsExpectations(spec, sample, baseline) {
  const chromeVersion = String(sample.cdpVersion?.Browser || '').split('/')[1] || '';
  const major = majorOf(chromeVersion);
  const baseId = baseline ? identity(baseline, 'main') : null;
  return {
    ua: `Mozilla/5.0 (${WIN_UA_PLATFORM}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`,
    platform: baseId?.platform ?? 'Win32',
    chPlatform: baseId?.uaData?.platform ?? 'Windows',
    platformVersion: baseId?.highEntropy?.platformVersion ?? WIN_IDENTITY[spec.release].chPlatformVersion,
    fixed: baseId
      ? {
          architecture: baseId.highEntropy?.architecture,
          bitness: baseId.highEntropy?.bitness,
          wow64: baseId.highEntropy?.wow64,
          model: baseId.highEntropy?.model,
          formFactors: baseId.highEntropy?.formFactors,
        }
      : { architecture: 'x86', bitness: '64', wow64: false, model: '', formFactors: ['Desktop'] },
  };
}

function identityRows(name, spec, sample, expect) {
  const report = sample.first;
  const rows = [];
  const add = (id, rule, ok, detail) => rows.push({ case: name, id, rule, status: ok ? 'PASS' : 'FAIL', detail });

  const ua = perContext(report, (i) => i.userAgent);
  const uaHeaders = headerValues(report, 'user-agent');
  const uaAll = allEqual({ ...ua, ...uaHeaders }, expect.ua);
  const appVersion = allEqual(
    perContext(report, (i) => i.appVersion),
    expect.ua.replace(/^Mozilla\//, ''),
  );
  add('ID-01', 'exact', uaAll.ok && appVersion.ok, { want: expect.ua, bad: { ...uaAll.bad, ...appVersion.bad } });

  const platform = allEqual(perContext(report, (i) => i.platform), expect.platform);
  add('ID-02', 'exact', platform.ok, { want: expect.platform, bad: platform.bad });

  const chPlatform = allEqual(
    { ...perContext(report, (i) => i.uaData?.platform), ...Object.fromEntries(Object.entries(headerValues(report, 'sec-ch-ua-platform')).map(([k, v]) => [k, unquote(v)])) },
    expect.chPlatform,
  );
  add('ID-03', 'exact', chPlatform.ok, { want: expect.chPlatform, bad: chPlatform.bad });

  const pv = allEqual(
    {
      ...perContext(report, (i) => i.highEntropy?.platformVersion),
      ...Object.fromEntries(Object.entries(headerValues(report, 'sec-ch-ua-platform-version')).map(([k, v]) => [k, unquote(v)])),
    },
    expect.platformVersion,
  );
  add('ID-04', 'exact', pv.ok, { want: expect.platformVersion, bad: pv.bad });

  const fixed = perContext(report, (i) => ({
    architecture: i.highEntropy?.architecture,
    bitness: i.highEntropy?.bitness,
    wow64: i.highEntropy?.wow64,
    model: i.highEntropy?.model,
    formFactors: i.highEntropy?.formFactors,
  }));
  const fixedAll = allEqual(fixed, expect.fixed);
  add('ID-05', 'verify', fixedAll.ok, { want: expect.fixed, bad: fixedAll.bad });

  const main = identity(report, 'main') || {};
  const he = main.highEntropy || {};
  const headerChecks = {
    'sec-ch-ua-arch': `"${he.architecture}"`,
    'sec-ch-ua-bitness': `"${he.bitness}"`,
    'sec-ch-ua-full-version-list': (he.fullVersionList || []).map((b) => `"${b.brand}";v="${b.version}"`).join(', '),
    'sec-ch-ua': (main.uaData?.brands || []).map((b) => `"${b.brand}";v="${b.version}"`).join(', '),
    'sec-ch-ua-mobile': main.uaData?.mobile ? '?1' : '?0',
  };
  const headerBad = {};
  for (const [header, want] of Object.entries(headerChecks)) {
    for (const [src, got] of Object.entries(headerValues(report, header))) {
      if (got !== want) headerBad[`${src}:${header}`] = { got, want };
    }
  }
  const navHasHigh = headerValues(report, 'sec-ch-ua-platform-version').navigation !== undefined;
  add('ID-06', 'consistency', navHasHigh && Object.keys(headerBad).length === 0, { navHasHigh, bad: headerBad });

  const ref = JSON.stringify({ ...main, isSecureContext: undefined });
  const ctxBad = {};
  for (const ctx of CONTEXTS.slice(1)) {
    const other = identity(report, ctx);
    if (!other) {
      ctxBad[ctx] = 'missing';
      continue;
    }
    const keys = ['userAgent', 'appVersion', 'platform', 'uaData', 'highEntropy', 'hardwareConcurrency', 'deviceMemory', 'languages'];
    for (const key of keys) {
      if (!deepEqual(other[key], main[key])) ctxBad[`${ctx}.${key}`] = { got: other[key], want: main[key] };
    }
  }
  add('ID-07', 'consistency', Boolean(ref) && Object.keys(ctxBad).length === 0, { bad: ctxBad });

  const cdpUa = sample.cdpVersion?.['User-Agent'];
  add('ID-08', 'exact', cdpUa === expect.ua, { got: cdpUa, want: expect.ua });

  const brands = (main.uaData?.brands || []).map((b) => b.brand);
  add('ID-09', 'exact', brands.includes('Google Chrome') && brands.includes('Chromium'), { brands });

  add('ID-10', 'verify', main.oscpu == null && main.buildID == null, { oscpu: main.oscpu, buildID: main.buildID });

  const fp = sample.session?.fingerprint || {};
  const hc = allEqual(perContext(report, (i) => i.hardwareConcurrency), fp.hardwareConcurrency);
  add('HW-01', 'exact', hc.ok, { want: fp.hardwareConcurrency, bad: hc.bad });
  const dm = allEqual(perContext(report, (i) => i.deviceMemory), fp.deviceMemory);
  const dmHeader = headerValues(report, 'sec-ch-device-memory').navigation;
  add('HW-02', 'consistency', dm.ok && dmHeader === String(fp.deviceMemory), { want: fp.deviceMemory, header: dmHeader, bad: dm.bad });

  if (sample.second) {
    const a = identity(sample.first, 'main');
    const b = identity(sample.second, 'main');
    const same = deepEqual({ ...a, elapsedMs: 0 }, { ...b, elapsedMs: 0 });
    add('STAB-ID', 'stability', same, same ? {} : { first: a, second: b });
  }
  return rows;
}

const WIN11_ONLY_FAMILY = /^(Noto Sans SC|Noto Serif SC|Sans Serif Collection|Segoe UI Variable.*|Segoe Fluent Icons|Cascadia (Code|Mono).*)$/;
const FONT_WIDTH_TOLERANCE = 0.02;
const FONT_EXTENT_TOLERANCE = 1;
const BOX_TOLERANCE = 1;
// Chrome on Windows, maximized: tab strip plus toolbar, no bookmark bar.
const FRAME_HEIGHT_RANGE = [70, 100];
const TASKBAR_PX = { win10: 40, win11: 48 };

function flatten(value, prefix = '', out = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out[prefix] = value;
  }
  return out;
}

/** Exact compare of two objects; allowlisted keys and everything below them are skipped. */
function diffExact(want, got, allow = {}) {
  const a = flatten(want);
  const b = flatten(got);
  const allowed = Object.keys(allow || {});
  const bad = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (allowed.some((k) => key === k || key.startsWith(`${k}.`))) continue;
    if (!deepEqual(a[key], b[key])) bad[key] = { want: a[key], got: b[key] };
  }
  return bad;
}

function setDiff(want = [], got = [], allowMissing = {}, allowExtra = {}, ignore = []) {
  const w = new Set(want);
  const g = new Set(got);
  return {
    missing: [...w].filter((v) => !g.has(v) && !allowMissing[v] && !ignore.includes(v)),
    extra: [...g].filter((v) => !w.has(v) && !allowExtra[v] && !ignore.includes(v)),
  };
}

const near = (a, b, tol) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;

/** True when the baseline machine ran a different Windows release than the sample. */
function crossRelease(release, base) {
  const pv = Number.parseInt(base?.__platformVersion || '0', 10);
  return (pv >= 13 ? 'win11' : 'win10') !== release;
}

function fontRows(add, release, main, base, allow) {
  const cross = crossRelease(release, base);
  let wantFonts = availableFonts(base.fonts).filter((f) => !allow.fonts?.missing?.[f]);
  if (release === 'win10') wantFonts = wantFonts.filter((f) => !WIN11_ONLY_FAMILY.test(f));
  const gotFonts = availableFonts(main.fonts);
  const fonts = setDiff(wantFonts, gotFonts, allow.fonts?.missing);
  add('FNT-01', 'set', !fonts.missing.length && !fonts.extra.length, fonts);

  const metricBad = {};
  for (const [family, scripts] of Object.entries(base.fontMetrics || {})) {
    if (!gotFonts.includes(family) && !['Arial', 'Times New Roman', 'Courier New'].includes(family)) continue;
    for (const [script, want] of Object.entries(scripts)) {
      if (allow.fontMetrics?.[`${family}/${script}`]) continue;
      // Non-Latin runs come from the release's fallback faces.
      if (cross && script !== 'latin') continue;
      const got = main.fontMetrics?.[family]?.[script];
      const ok =
        got &&
        near(got.width, want.width, FONT_WIDTH_TOLERANCE) &&
        near(got.ascent, want.ascent, FONT_EXTENT_TOLERANCE) &&
        near(got.descent, want.descent, FONT_EXTENT_TOLERANCE);
      if (!ok) metricBad[`${family}/${script}`] = { want, got };
    }
  }
  add('FNT-02', 'tolerance', !Object.keys(metricBad).length, { bad: metricBad });

  if (!cross) {
    const genericBad = {};
    for (const [key, want] of Object.entries(flatten(base.genericFamilies || {}))) {
      const got = flatten(main.genericFamilies || {})[key];
      if (!near(got, want, FONT_WIDTH_TOLERANCE)) genericBad[key] = { want, got };
    }
    add('FNT-03', 'tolerance', !Object.keys(genericBad).length, { bad: genericBad });
  } else {
    const leaked = gotFonts.filter((f) => WIN11_ONLY_FAMILY.test(f));
    add('FNT-03', 'release', !leaked.length, { win11OnlyPresent: leaked });
  }

  const emojiBad = {};
  for (const [glyph, want] of Object.entries(base.emoji || {})) {
    const got = main.emoji?.[glyph];
    const ok =
      got &&
      near(got.dom, want.dom, FONT_WIDTH_TOLERANCE) &&
      near(got.canvas?.width, want.canvas?.width, FONT_WIDTH_TOLERANCE) &&
      near(got.canvas?.ascent, want.canvas?.ascent, FONT_EXTENT_TOLERANCE) &&
      near(got.canvas?.descent, want.canvas?.descent, FONT_EXTENT_TOLERANCE);
    if (!ok) emojiBad[glyph] = { want, got };
  }
  add('FNT-04', 'tolerance', !Object.keys(emojiBad).length, { bad: emojiBad });
}

function uiRows(add, release, main, base, allow) {
  const cross = crossRelease(release, base);
  const colors = diffExact(base.systemColors, main.systemColors);
  add('UI-01', 'exact', !Object.keys(colors).length, { bad: colors });
  const scroll = diffExact(base.scrollbars, main.scrollbars);
  add('UI-02', 'exact', !Object.keys(scroll).length, { bad: scroll });

  const formBad = {};
  for (const [control, want] of Object.entries(base.formControls || {})) {
    if (allow.formControls?.[control]) continue;
    // input-file sizes from the CJK fallback face, which differs per release.
    if (cross && control === 'input-file') continue;
    const got = main.formControls?.[control];
    const ok = typeof want === 'number' ? near(got, want, BOX_TOLERANCE) :
      got &&
      near(got.width, want.width, BOX_TOLERANCE) &&
      near(got.height, want.height, BOX_TOLERANCE) &&
      got.fontFamily === want.fontFamily &&
      got.fontSize === want.fontSize;
    if (!ok) formBad[control] = { want, got };
  }
  add('UI-03', 'tolerance', !Object.keys(formBad).length, { bad: formBad });

  // Window placement keys depend on the baseline window state; the
  // maximized checks below cover them.
  const windowKeys = ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'frameWidth', 'frameHeight', 'screenX', 'screenY'];
  const omitWindow = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !windowKeys.includes(k)));
  const wantScreen = omitWindow(base.screen);
  if (cross && typeof wantScreen.height === 'number') {
    wantScreen.availHeight = wantScreen.height - TASKBAR_PX[release];
  }
  const screen = diffExact(wantScreen, omitWindow(main.screen), allow.screen);
  const s = main.screen || {};
  const frame = s.frameHeight;
  const frameOk = typeof frame === 'number' && frame >= FRAME_HEIGHT_RANGE[0] && frame <= FRAME_HEIGHT_RANGE[1];
  // Nya windows are maximized: the outer rect is the work area and Chrome
  // draws no side frame (the baseline window may be restored).
  const maximized = {
    outerWidth: [s.outerWidth, s.availWidth],
    outerHeight: [s.outerHeight, s.availHeight],
    screenX: [s.screenX, s.availLeft],
    screenY: [s.screenY, s.availTop],
    innerWidth: [s.innerWidth, s.outerWidth],
    frameWidth: [s.frameWidth, 0],
  };
  const maxBad = Object.fromEntries(Object.entries(maximized).filter(([, [got, want]]) => got !== want));
  add('UI-04', 'exact+range', !Object.keys(screen).length && frameOk && !Object.keys(maxBad).length, {
    bad: screen,
    maximized: maxBad,
    frameHeight: frame,
    range: FRAME_HEIGHT_RANGE,
  });

  const mq = diffExact(base.mediaQueries, main.mediaQueries, allow.mediaQueries);
  add('UI-05', 'exact', !Object.keys(mq).length, { bad: mq });
  const kb = diffExact(base.keyboard, main.keyboard);
  add('UI-06', 'exact', !Object.keys(kb).length, { bad: kb });
}

function voiceKey(v) {
  return `${v.name}|${v.lang}|${v.localService}|${v.default}`;
}

function sameGpu(report, baseReport) {
  const want = baseReport.contexts?.main?.webgl?.unmaskedRenderer;
  return Boolean(want) && report.contexts?.main?.webgl?.unmaskedRenderer === want;
}

const NVIDIA_D3D11 = /^ANGLE \(NVIDIA, NVIDIA .+ Direct3D11 vs_5_0 ps_5_0, D3D11\)$/;

/** Both on NVIDIA under D3D11: GPU-shape metrics (limits, extensions, media) match across models. */
function sameGpuShape(report, baseReport) {
  const renderer = (r) => r.contexts?.main?.webgl?.unmaskedRenderer || '';
  return NVIDIA_D3D11.test(renderer(baseReport)) && NVIDIA_D3D11.test(renderer(report));
}

/**
 * Hardware video keys (HEVC, power-efficient decode, H.264 High / HEVC RTP)
 * come from the host GPU. On another GPU they are moved into `skipped`.
 */
function hostMedia(sameHost, allow) {
  const patterns = (allow.hostMedia?.patterns || []).map((p) => new RegExp(p));
  const skipped = {};
  const hw = (key) => patterns.some((re) => re.test(key));
  return {
    skipped,
    diff(section, bad) {
      if (sameHost) return bad;
      const kept = {};
      for (const [key, d] of Object.entries(bad)) {
        if (hw(`${section}:${key}`)) skipped[`${section}.${key}`] = d;
        else kept[key] = d;
      }
      return kept;
    },
    list(section, values = []) {
      return sameHost ? values : values.filter((v) => !hw(`${section}:${v}`));
    },
  };
}

function mediaRows(add, main, base, allow, media) {
  const codecs = media.diff('codecs', diffExact(base.codecs, main.codecs, allow.codecs));
  add('MED-01', 'exact', !Object.keys(codecs).length, { bad: codecs });
  const decoding = media.diff('decoding', diffExact(base.decoding, main.decoding, allow.decoding));
  add('MED-02', 'exact', !Object.keys(decoding).length, { bad: decoding });
  const eme = diffExact(base.eme, main.eme, allow.eme);
  add('MED-03', 'exact', !Object.keys(eme).length, { bad: eme });

  const remote = new RegExp(allow.voices?.remotePattern || '$^');
  const pick = (list) => (Array.isArray(list) ? list.filter((v) => !remote.test(v.name)).map(voiceKey).sort() : null);
  const wantVoices = pick(base.voices?.voices);
  const gotVoices = pick(main.voices?.voices);
  add('MED-04', 'exact', deepEqual(wantVoices, gotVoices), { want: wantVoices, got: gotVoices });

  const audio = diffExact(base.audio, main.audio, allow.audio);
  add('MED-05', 'exact', !Object.keys(audio).length, { bad: audio });

  const rtcBad = {};
  for (const key of new Set([...Object.keys(base.rtc || {}), ...Object.keys(main.rtc || {})])) {
    const want = base.rtc?.[key];
    const got = main.rtc?.[key];
    if (Array.isArray(want) && Array.isArray(got)) {
      const d = setDiff(media.list('rtc', want), media.list('rtc', got), allow.rtc, allow.rtc);
      if (d.missing.length || d.extra.length) rtcBad[key] = d;
    } else if (!deepEqual(want, got)) {
      rtcBad[key] = { want, got };
    }
  }
  add('RTC-01', 'exact', !Object.keys(rtcBad).length, { bad: rtcBad });
}

function apiRows(add, main, base, allow) {
  const apiBad = {};
  for (const iface of new Set([...Object.keys(base.api || {}), ...Object.keys(main.api || {})])) {
    const d = setDiff(base.api?.[iface], main.api?.[iface], allow.api?.onlyBaseline, allow.api?.onlySample, allow.api?.hostGpu);
    if (d.missing.length || d.extra.length) apiBad[iface] = d;
  }
  add('API-01', 'set', !Object.keys(apiBad).length, { bad: apiBad });
  const perms = diffExact(base.permissions, main.permissions, allow.permissions);
  add('API-02', 'exact', !Object.keys(perms).length, { bad: perms });
}

const GLYPH_TOLERANCE = 0.002;

/** Per-glyph advances at fractional sizes (DirectWrite natural vs GDI-classic). */
function glyphRows(add, release, main, base, allow) {
  const cross = crossRelease(release, base);
  const installed = new Set(availableFonts(base.fonts));
  const bad = {};
  for (const [family, sizes] of Object.entries(base.glyphAdvances || {})) {
    if (allow.glyphAdvances?.[family] || !installed.has(family)) continue;
    if (cross && WIN11_ONLY_FAMILY.test(family)) continue;
    for (const [size, want] of Object.entries(sizes)) {
      const got = main.glyphAdvances?.[family]?.[size];
      const w = String(want).split('|').map(Number);
      const g = String(got ?? '').split('|').map(Number);
      if (w.length !== g.length || w.some((v, i) => !near(g[i], v, GLYPH_TOLERANCE))) bad[`${family}@${size}`] = { want, got };
    }
  }
  add('FNT-05', 'tolerance', !Object.keys(bad).length, { bad });
}

function envRows(add, main, base, allow, media) {
  const env = media.diff('env', diffExact(base.env, main.env, allow.env));
  add('ENV-01', 'exact', !Object.keys(env).length, { bad: env });
  const misc = diffExact(base.misc, main.misc, allow.misc);
  add('MISC-01', 'exact', !Object.keys(misc).length, { bad: misc });
  const localFonts = diffExact(base.localFonts, main.localFonts);
  add('API-04', 'exact', !Object.keys(localFonts).length, { bad: localFonts });

  const devices = diffExact(base.devices, main.devices, allow.devices);
  add('DEV-01', 'exact', !Object.keys(devices).length, { bad: devices });
  // Before a grant Chrome lists one entry per kind with every id blanked.
  const list = main.devices?.mediaDevices?.devices || [];
  const kinds = list.map((d) => d.kind);
  const baseKinds = (base.devices?.mediaDevices?.devices || []).map((d) => d.kind);
  const leaked = list.filter((d) => d.deviceId !== '' || d.label !== '' || (d.groupId !== undefined && d.groupId !== ''));
  const masked = !leaked.length && new Set(kinds).size === kinds.length && baseKinds.every((k) => kinds.includes(k));
  add('DEV-02', 'policy', masked, { kinds, baseKinds, leaked });

  const hashes = main.hashes || {};
  const missing = Object.keys(base.hashes || {}).filter((k) => typeof hashes[k] !== 'string' || !hashes[k]);
  add('HASH-01', 'present', !missing.length, { missing, note: allow.hashes });
  const pi = main.pixelIntegrity || {};
  const piKeys = ['solidBlack', 'solidRed', 'putGet', 'toDataUrlRoundtrip', 'webglReadPixels', 'audioExact'];
  const piBad = Object.fromEntries(piKeys.filter((k) => pi[k] !== true).map((k) => [k, pi[k]]));
  add('HASH-02', 'policy', !Object.keys(piBad).length, { bad: piBad });
}

/** Every identity field in every context, version-normalized. */
function contextRows(add, report, baseReport, allow, cross) {
  // Across releases the platform version differs by design (ID-04).
  const identityAllow = cross ? { ...allow.identity, 'highEntropy.platformVersion': true } : allow.identity;
  const bad = {};
  for (const ctx of CONTEXTS) {
    if (allow.contexts?.[ctx]) continue;
    const want = normalizeVersions(baseReport.contexts?.[ctx]?.identity);
    const got = normalizeVersions(report.contexts?.[ctx]?.identity);
    for (const [key, d] of Object.entries(diffExact(want, got, identityAllow))) bad[`${ctx}.${key}`] = d;
  }
  add('CTX-01', 'exact', !Object.keys(bad).length, { bad });
}

// Depth bottoms out at the interpreter frame size and rises by up to ~45% when
// concurrent Sparkplug code arrives mid-recursion. The one-shot baseline may
// sit anywhere in that band, so both sides are wide.
const STACK_TOLERANCE = 0.3;
const STACK_JIT_TOLERANCE = 0.5;
const BOUNDS_TOLERANCE = 1;
// Generic families whose per-locale default differs between releases (zh-CN:
// Noto Sans/Serif SC on Windows 11, Microsoft YaHei/SimSun on Windows 10).
const RELEASE_GENERIC_FONT = /^16px (sans-serif|serif)$/;

/**
 * Per-context JS runtime: recursion depth from -30% to +50% (it varies with JIT
 * state) and canvas text metrics (width to 0.02 px, bounding boxes to 1 px).
 */
function runtimeRows(add, report, baseReport, allow, cross) {
  const bad = {};
  for (const ctx of CONTEXTS) {
    const want = baseReport.contexts?.[ctx]?.runtime;
    if (!want || allow.contexts?.[ctx]) continue;
    const got = report.contexts?.[ctx]?.runtime;
    if (!got) {
      bad[ctx] = 'missing';
      continue;
    }
    if (
      typeof want.stackDepth === 'number' &&
      !(got.stackDepth >= want.stackDepth * (1 - STACK_TOLERANCE) && got.stackDepth <= want.stackDepth * (1 + STACK_JIT_TOLERANCE))
    ) {
      bad[`${ctx}.stackDepth`] = { want: want.stackDepth, got: got.stackDepth };
    }
    for (const [font, w] of Object.entries(want.textMetrics || {})) {
      if (cross && RELEASE_GENERIC_FONT.test(font)) continue;
      const g = got.textMetrics?.[font];
      const wv = String(w).split('|').map(Number);
      const gv = String(g ?? '').split('|').map(Number);
      const ok =
        wv.length === gv.length &&
        near(gv[0], wv[0], FONT_WIDTH_TOLERANCE) &&
        wv.slice(1).every((v, i) => near(gv[i + 1], v, BOUNDS_TOLERANCE));
      if (!ok) bad[`${ctx}.textMetrics.${font}`] = { want: w, got: g };
    }
  }
  add('CTX-02', 'tolerance', !Object.keys(bad).length, { bad });
}

/** Request headers of every context and of the top-level navigation. */
function headerRows(add, report, baseReport, allow, cross) {
  const sets = (r) => {
    const out = { ...headerSets(r) };
    for (const ctx of CONTEXTS) if (r.contexts?.[ctx]?.headers) out[`ctx:${ctx}`] = r.contexts[ctx].headers;
    return out;
  };
  const want = sets(baseReport);
  const got = sets(report);
  const allowed = cross ? { ...allow.headers, 'sec-ch-ua-platform-version': true } : allow.headers || {};
  const bad = {};
  for (const src of Object.keys(want)) {
    if (allow.contexts?.[src.replace(/^(fetch|ctx):/, '')]) continue;
    if (!got[src]) {
      bad[src] = 'missing';
      continue;
    }
    const w = normalizeVersions(want[src]);
    const g = normalizeVersions(got[src]);
    for (const name of new Set([...Object.keys(w), ...Object.keys(g)])) {
      if (allowed[name]) continue;
      if (!deepEqual(w[name], g[name])) bad[`${src}.${name}`] = { want: w[name], got: g[name] };
    }
  }
  const nav = got.navigation || {};
  const viewport = nav['sec-ch-viewport-width'];
  const inner = report.main?.screen?.innerWidth;
  if (viewport !== undefined && viewport !== String(inner)) bad['navigation.sec-ch-viewport-width'] = { want: String(inner), got: viewport };
  add('HDR-01', 'exact', !Object.keys(bad).length, { bad });
}

// Sections owned by a dedicated rule; any other section of the main report
// is compared exactly by ALL-01 so new probe metrics are never unchecked.
const OWNED_SECTIONS = new Set([
  'fonts', 'localFonts', 'fontMetrics', 'genericFamilies', 'emoji', 'glyphAdvances', 'systemColors', 'scrollbars',
  'formControls', 'screen', 'mediaQueries', 'keyboard', 'codecs', 'decoding', 'eme', 'voices', 'rtc', 'audio', 'api',
  'permissions', 'devices', 'misc', 'env', 'hashes', 'pixelIntegrity', 'elapsedMs',
]);

function catchAllRows(add, main, base, allow, media) {
  const bad = {};
  for (const section of new Set([...Object.keys(base), ...Object.keys(main)])) {
    if (section.startsWith('__') || OWNED_SECTIONS.has(section)) continue;
    for (const [key, d] of Object.entries(diffExact(base[section], main[section], allow.catchAll))) bad[`${section}.${key}`] = d;
  }
  const kept = media.diff('all', bad);
  add('ALL-01', 'exact', !Object.keys(kept).length, { bad: kept });
}

/** Values that name the card; compared only on the baseline's exact model. */
function withoutModel(gl) {
  return gl && { ...gl, unmaskedRenderer: undefined };
}

// Probe values that only exist while the extension is exposed.
const EXTENSION_EXTRA = { WEBGL_draw_buffers: 'maxDrawBuffersWebgl', OVR_multiview2: 'maxViewsOvr' };

/** Drops allowlisted extensions from the ordered list and their dependent values. */
function withoutAllowedExtensions(gl, allowed = {}) {
  if (!gl) return gl;
  const extra = gl.extra && { ...gl.extra };
  for (const [ext, key] of Object.entries(EXTENSION_EXTRA)) if (allowed[ext] && extra) delete extra[key];
  const order = Array.isArray(gl.extensionOrder) ? gl.extensionOrder.filter((e) => !allowed[e]) : gl.extensionOrder;
  return { ...gl, extensionOrder: order, extra };
}

function gfxRows(add, report, baseReport, allow, spec) {
  const base = baseReport.contexts?.main || {};
  const got = report.contexts?.main || {};
  const exact = sameGpu(report, baseReport);
  if (!exact && !sameGpuShape(report, baseReport)) {
    const detail = { baseline: base.webgl?.unmaskedRenderer, got: got.webgl?.unmaskedRenderer, note: 'host GPU differs from the baseline machine' };
    for (const id of ['GFX-01', 'GFX-02', 'GFX-03', 'GFX-04', 'GFX-05', 'GFX-06']) add(id, 'same-gpu', null, detail);
    return;
  }
  for (const ctx of CONTEXTS.filter((c) => baseReport.contexts?.[c]?.webgl)) {
    const b = baseReport.contexts?.[ctx] || {};
    const g = report.contexts?.[ctx] || {};
    const suffix = ctx === 'main' ? '' : `@${ctx}`;
    for (const [gl, label] of [['webgl', 'GFX-01'], ['webgl2', 'GFX-02']]) {
      const allowed = allow.webgl?.extensions;
      const want = withoutAllowedExtensions(exact ? b[gl] : withoutModel(b[gl]), allowed);
      const have = withoutAllowedExtensions(exact ? g[gl] : withoutModel(g[gl]), allowed);
      const bad = diffExact({ ...want, extensions: undefined }, { ...have, extensions: undefined });
      const ext = setDiff(b[gl]?.extensions, g[gl]?.extensions, allow.webgl?.extensions);
      const ok = !Object.keys(bad).length && !ext.missing.length && !ext.extra.length;
      add(label + suffix, 'exact', ok, { bad, extensions: ext });
    }
    const wb = b.webgpu || {};
    const wg = g.webgpu || {};
    const info = exact
      ? diffExact(wb.info, wg.info)
      : diffExact({ ...wb.info, architecture: undefined }, { ...wg.info, architecture: undefined });
    add('GFX-03' + suffix, 'exact', wb.available === wg.available && !Object.keys(info).length, { available: wg.available, bad: info });
    const features = setDiff(wb.features, wg.features, allow.webgpu?.features, allow.webgpu?.features);
    add('GFX-04' + suffix, 'set', !features.missing.length && !features.extra.length, features);
    const limits = diffExact(wb.limits, wg.limits, allow.webgpu?.limits);
    add('GFX-05' + suffix, 'exact', !Object.keys(limits).length, { bad: limits });
    const wgsl = setDiff(wb.wgslLanguageFeatures, wg.wgslLanguageFeatures, allow.webgpu?.wgsl, allow.webgpu?.wgsl);
    const formatOk = wb.preferredCanvasFormat === wg.preferredCanvasFormat;
    add('GFX-06' + suffix, 'exact', formatOk && !wgsl.missing.length && !wgsl.extra.length, {
      format: { want: wb.preferredCanvasFormat, got: wg.preferredCanvasFormat },
      wgsl,
    });
  }
  if (spec.gpu) {
    // The claimed card in every context, formatted as ANGLE D3D11 names it.
    const renderer = `ANGLE (NVIDIA, NVIDIA ${spec.gpu.angleName} (0x0000${spec.gpu.deviceId.toUpperCase()}) Direct3D11 vs_5_0 ps_5_0, D3D11)`;
    const bad = {};
    for (const ctx of CONTEXTS.filter((c) => report.contexts?.[c]?.webgl)) {
      const g = report.contexts[ctx];
      for (const gl of ['webgl', 'webgl2']) {
        if (g[gl]?.unmaskedRenderer !== renderer) bad[`${ctx}.${gl}`] = { want: renderer, got: g[gl]?.unmaskedRenderer };
      }
      const info = g.webgpu?.info;
      if (info && (info.architecture !== spec.gpu.architecture || info.device !== '' || info.description !== '')) {
        bad[`${ctx}.webgpu`] = { want: { architecture: spec.gpu.architecture, device: '', description: '' }, got: info };
      }
    }
    add('GFX-07', 'exact', !Object.keys(bad).length, { bad });
  }
  const shaderIsHlsl = report.main?.pixelIntegrity?.shaderIsHlsl;
  add('GFX-08', 'policy', shaderIsHlsl === true, { shaderIsHlsl });
}

function windowsMetricRows(name, spec, sample, baseline, allow) {
  const rows = [];
  const add = (id, rule, ok, detail) =>
    rows.push({ case: name, id, rule, status: ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL', detail });
  if (!baseline) {
    add('T3', 'baseline', null, 'no real-machine baseline in e2e/fixtures/windows');
    return rows;
  }
  const main = sample.first.main || {};
  const base = { ...baseline.report.main, __platformVersion: identity(baseline.report, 'main')?.highEntropy?.platformVersion };
  const sameHost = sameGpuShape(sample.first, baseline.report);
  const media = hostMedia(sameHost, allow);
  fontRows(add, spec.release, main, base, allow);
  glyphRows(add, spec.release, main, base, allow);
  uiRows(add, spec.release, main, base, allow);
  mediaRows(add, main, base, allow, media);
  apiRows(add, main, base, allow);
  envRows(add, main, base, allow, media);
  add('MED-HW', 'same-gpu', sameHost ? true : null, sameHost ? {} : {
    note: 'host GPU differs from the baseline machine; hardware video keys are compared on a matching GPU only',
    skipped: media.skipped,
  });
  const cross = crossRelease(spec.release, base);
  contextRows(add, sample.first, baseline.report, allow, cross);
  runtimeRows(add, sample.first, baseline.report, allow, cross);
  headerRows(add, sample.first, baseline.report, allow, cross);
  catchAllRows(add, main, base, allow, media);
  gfxRows(add, sample.first, baseline.report, allow, spec);
  if (sample.second) {
    const a = sample.first.main?.hashes || {};
    const b = sample.second.main?.hashes || {};
    add('STAB-FP', 'stability', deepEqual(a, b), deepEqual(a, b) ? {} : { first: a, second: b });
  }
  return rows;
}

/** Drops globals that only exist when the host GPU supports them. */
function withoutHostGpu(api, names = []) {
  if (!api || typeof api !== 'object') return api;
  return Object.fromEntries(Object.entries(api).map(([k, v]) => [k, Array.isArray(v) ? v.filter((n) => !names.includes(n)) : v]));
}

function linuxRegressionRows(name, sample, snapshot, allow) {
  if (!snapshot) {
    return [{ case: name, id: 'T1', rule: 'snapshot', status: 'SKIP', detail: 'no linux snapshot; run with --update-snapshot' }];
  }
  const got = snapshotMetrics(sample.first);
  const hostGpu = allow?.api?.hostGpu || [];
  got['API-01'] = withoutHostGpu(got['API-01'], hostGpu);
  const rows = [];
  for (const [id, rawWant] of Object.entries(snapshot.metrics)) {
    const want = id === 'API-01' ? withoutHostGpu(rawWant, hostGpu) : rawWant;
    const ok = deepEqual(got[id], want);
    let detail = {};
    if (!ok) {
      detail = Array.isArray(want) && Array.isArray(got[id])
        ? { extra: got[id].filter((v) => !want.includes(v)).slice(0, 20), missing: want.filter((v) => !got[id].includes(v)).slice(0, 20) }
        : { got: got[id], want };
    }
    rows.push({ case: name, id, rule: 'snapshot', status: ok ? 'PASS' : 'FAIL', detail });
  }
  return rows;
}

export function loadFixtures(fixturesDir, chromeMajor) {
  const out = { linux: null, windows: {}, allow: {} };
  const linuxFile = path.join(fixturesDir, 'linux', chromeMajor, 'snapshot.json');
  if (fs.existsSync(linuxFile)) out.linux = JSON.parse(fs.readFileSync(linuxFile, 'utf8'));
  // Real-machine reports; any browser major (compared version-normalized).
  const winDir = path.join(fixturesDir, 'windows');
  if (fs.existsSync(winDir)) {
    const allowFile = path.join(winDir, 'allowlist.json');
    if (fs.existsSync(allowFile)) out.allow = JSON.parse(fs.readFileSync(allowFile, 'utf8'));
    for (const file of fs.readdirSync(winDir).filter((f) => f.endsWith('.json') && f !== 'allowlist.json').sort()) {
      const report = JSON.parse(fs.readFileSync(path.join(winDir, file), 'utf8'));
      const pv = Number.parseInt(identity(report, 'main')?.highEntropy?.platformVersion || '0', 10);
      const release = pv >= 13 ? 'win11' : 'win10';
      out.windows[release] ||= { file, report, others: [] };
      if (out.windows[release].file !== file) out.windows[release].others.push({ file, report });
    }
  }
  return out;
}

export function evaluateCases(samples, { fixturesDir }) {
  const rows = [];
  const anySample = Object.values(samples)[0];
  const chromeMajor = majorOf(String(anySample?.cdpVersion?.Browser || '').split('/')[1]);
  const fixtures = loadFixtures(fixturesDir, chromeMajor);
  const used = {};
  for (const [name, sample] of Object.entries(samples)) {
    const spec = CASES[name];
    if (spec.os === 'linux') {
      rows.push(...linuxRegressionRows(name, sample, fixtures.linux, fixtures.allow));
      continue;
    }
    const baseline = fixtures.windows[spec.release];
    // Release-independent metrics fall back to the other release's machine.
    const metricBaseline = baseline || fixtures.windows.win11 || fixtures.windows.win10;
    used[name] = baseline ? baseline.file : `osProfiles; metrics vs ${metricBaseline?.file || 'none'}`;
    rows.push(...identityRows(name, spec, sample, windowsExpectations(spec, sample, baseline?.report)));
    rows.push(...windowsMetricRows(name, spec, sample, metricBaseline, fixtures.allow));
  }
  const ids = Object.fromEntries(Object.entries(samples).map(([n, s]) => [n, identity(s.first, 'main')]));
  if (ids.win10 && ids.win11) {
    const differ = ids.win10.highEntropy?.platformVersion !== ids.win11.highEntropy?.platformVersion;
    rows.push({ case: 'cross', id: 'ID-04', rule: 'release', status: differ ? 'PASS' : 'FAIL', detail: {} });
  }
  return { chromeMajor, baselines: used, rows };
}
