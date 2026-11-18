import { describe, expect, it } from 'vitest';
import { clampDisplayGeom, DISPLAY_LIMITS } from './displayLimits.js';
import {
  loginSchema,
  changePasswordSchema,
  createUserSchema,
  createProxySchema,
  createGroupSchema,
  putUserGrantsSchema,
  putTargetGrantsSchema,
  createSessionSchema,
  pickSessionFingerprint,
  IDLE_TIMEOUT_MINUTES_MAX,
  DEFAULT_IDLE_TIMEOUT_MINUTES,
  putNotepadSchema,
  typeTextSchema,
  TYPE_TEXT_MAX,
} from './schemas.js';
import { normalizeTimezone, DEFAULT_TIMEZONE, isValidTimezone } from './timezones.js';
import {
  normalizeChromeLanguage,
  isValidChromeLanguage,
  DEFAULT_CHROME_LANGUAGE,
  acceptLanguageHeader,
  posixLocale,
} from './languages.js';
import { emptyProxy } from './types.js';
import {
  DEFAULT_GPU_PROFILE,
  coerceGpuProfile,
  gpuProfileById,
  gpuProfileOptionLabel,
  normalizeGpuProfile,
} from './gpuProfiles.js';
import { coerceWebrtcMode, DEFAULT_WEBRTC_MODE } from './webrtc.js';
import { sessionMediaDevices } from './mediaDevices.js';
import { countryLocale, resolveSessionLocale } from './countryLocale.js';
import { windowsFontNames } from './windowsFontNames.js';
import { normalizeGeo } from './geo.js';
import { regionFromLoc } from './region.js';
import { injectIndexHtml, joinBasePath, normalizeBasePath } from './basePath.js';

describe('displayLimits', () => {
  it('clamps oversized geometry', () => {
    const g = clampDisplayGeom(99999, 99999);
    expect(g.w).toBeLessThanOrEqual(DISPLAY_LIMITS.maxW);
    expect(g.h).toBeLessThanOrEqual(DISPLAY_LIMITS.maxH);
  });
});

describe('schemas', () => {
  it('accepts login', () => {
    expect(loginSchema.parse({ username: 'admin', password: 'x' }).username).toBe('admin');
  });

  it('rejects bad username', () => {
    expect(() => createUserSchema.parse({ username: 'bad name', password: '1234' })).toThrow();
  });

  it('accepts password change', () => {
    expect(
      changePasswordSchema.parse({ currentPassword: 'old', newPassword: '1234' }).newPassword,
    ).toBe('1234');
  });

  it('rejects short new password', () => {
    expect(() => changePasswordSchema.parse({ currentPassword: 'old', newPassword: '123' })).toThrow();
  });

  it('accepts group', () => {
    const g = createGroupSchema.parse({ name: '客户', parentId: null });
    expect(g.name).toBe('客户');
  });

  it('accepts user grants', () => {
    const parsed = putUserGrantsSchema.parse({
      grants: [
        { kind: 'folder', targetId: 'g1' },
        { kind: 'session', targetId: 's1' },
      ],
    });
    expect(parsed.grants).toHaveLength(2);
  });

  it('accepts target grants', () => {
    expect(putTargetGrantsSchema.parse({ userIds: ['u1', 'u2'] })).toEqual({
      userIds: ['u1', 'u2'],
      notepadUserIds: [],
    });
  });

  it('accepts notepad grant flags', () => {
    const parsed = putUserGrantsSchema.parse({
      grants: [{ kind: 'session', targetId: 's1', allowNotepad: true }],
    });
    expect(parsed.grants[0].allowNotepad).toBe(true);
    expect(
      putTargetGrantsSchema.parse({ userIds: ['u1'], notepadUserIds: ['u1'] }).notepadUserIds,
    ).toEqual(['u1']);
  });

  it('accepts proxy', () => {
    const p = createProxySchema.parse({
      name: 'p1',
      type: 'socks5',
      host: '127.0.0.1',
      port: 1080,
    });
    expect(p.port).toBe(1080);
  });

  it('defaults idle timeout to 30', () => {
    const s = createSessionSchema.parse({ name: 's1' });
    expect(s.idleTimeoutMinutes).toBe(DEFAULT_IDLE_TIMEOUT_MINUTES);
    expect(s.notepad).toBe('');
  });

  it('drops the removed device name and media fields', () => {
    const parsed = createSessionSchema.parse({
      name: 's1',
      deviceName: 'DESKTOP-X',
      mediaDevices: { audioInput: 'USB Audio Device' },
    });
    expect(parsed).not.toHaveProperty('deviceName');
    expect(parsed).not.toHaveProperty('mediaDevices');
  });

  it('accepts an NVIDIA desktop GPU profile', () => {
    expect(createSessionSchema.parse({ name: 's1', gpuProfile: 'rtx-2080' }).gpuProfile).toBe(
      'rtx-2080',
    );
    expect(
      createSessionSchema.parse({
        name: 's2',
        webrtcMode: 'offline',
        gpuProfile: 'gtx-1050-ti',
      }).gpuProfile,
    ).toBe('gtx-1050-ti');
    expect(() => createSessionSchema.parse({ name: 's1', gpuProfile: 'intel-uhd' })).toThrow();
  });

  it('accepts idle timeout minutes', () => {
    const s = createSessionSchema.parse({ name: 's1', idleTimeoutMinutes: 5 });
    expect(s.idleTimeoutMinutes).toBe(5);
  });

  it('rejects oversized idle timeout', () => {
    expect(() =>
      createSessionSchema.parse({ name: 's1', idleTimeoutMinutes: IDLE_TIMEOUT_MINUTES_MAX + 1 }),
    ).toThrow();
  });

  it('accepts IME type-text payloads', () => {
    expect(typeTextSchema.parse({ text: '这个太平淡了' }).text).toBe('这个太平淡了');
    expect(() => typeTextSchema.parse({ text: 'x'.repeat(TYPE_TEXT_MAX + 1) })).toThrow();
  });

  it('accepts notepad payloads', () => {
    expect(putNotepadSchema.parse({ notepad: 'ok' }).notepad).toBe('ok');
    expect(putNotepadSchema.parse({ notepad: 'x'.repeat(40_000) }).notepad.length).toBe(40_000);
  });
});

describe('timezones', () => {
  it('defaults empty', () => {
    expect(normalizeTimezone('')).toBe(DEFAULT_TIMEZONE);
  });

  it('accepts IANA zones beyond the common list', () => {
    expect(isValidTimezone('Pacific/Honolulu')).toBe(true);
    expect(normalizeTimezone('Pacific/Honolulu')).toBe('Pacific/Honolulu');
  });
});

describe('chrome languages', () => {
  it('defaults empty', () => {
    expect(normalizeChromeLanguage('')).toBe(DEFAULT_CHROME_LANGUAGE);
  });

  it('builds accept-language', () => {
    expect(acceptLanguageHeader('zh-CN')).toBe('zh-CN,zh,en-US,en');
    expect(posixLocale('zh-TW')).toBe('zh_TW.UTF-8');
  });
});

describe('gpu profiles', () => {
  it('defaults empty to native', () => {
    expect(coerceGpuProfile('')).toBe(DEFAULT_GPU_PROFILE);
    expect(normalizeGpuProfile('')).toBe('native');
  });

  it('maps NVIDIA desktop names and rejects others', () => {
    expect(gpuProfileById('gtx-1080-ti')?.angleName).toBe('GeForce GTX 1080 Ti');
    expect(gpuProfileById('rtx-2080')?.deviceId).toBe('1E87');
    expect(gpuProfileById('rtx-2080')?.architecture).toBe('turing');
    expect(gpuProfileById('gtx-1050-ti')?.architecture).toBe('pascal');
    expect(gpuProfileById('rtx-3050')?.architecture).toBe('ampere');
    expect(gpuProfileById('gtx-1650')?.architecture).toBe('turing');
    expect(gpuProfileById('rtx-4070')?.architecture).toBe('ada');
    expect(gpuProfileById('rtx-4090')?.deviceId).toBe('2684');
    expect(gpuProfileOptionLabel('rtx-4070')).toContain('GeForce RTX 4070');
    expect(() => normalizeGpuProfile('intel-uhd')).toThrow();
  });
});

describe('webrtc and device name', () => {
  it('defaults new sessions to offline and reads unknown stored modes as disabled', () => {
    expect(DEFAULT_WEBRTC_MODE).toBe('offline');
    expect(coerceWebrtcMode('forward')).toBe('forward');
    expect(coerceWebrtcMode('nope')).toBe('disabled');
    expect(coerceWebrtcMode('')).toBe('disabled');
  });
});

describe('windows font names', () => {
  it('follows the Windows release', () => {
    const win10 = windowsFontNames('win10', 'a'.repeat(64));
    expect(win10).toContain('Arial');
    expect(win10).toContain('Times');
    expect(win10).toContain('Courier');
    expect(win10).not.toContain('Cascadia Code');
    expect(windowsFontNames('win11', 'a'.repeat(64))).toContain('Cascadia Code');
  });
});

describe('session media devices', () => {
  it('names endpoints the way each OS does, stable per seed', () => {
    const seed = 'a'.repeat(64);
    const win = sessionMediaDevices('windows', seed, 'en-US');
    expect(win.audioInput).toMatch(/^Microphone \(/);
    expect(win.audioOutput).toMatch(/^Speakers \(/);
    expect(win.videoInput).toMatch(/\([0-9a-f]{4}:[0-9a-f]{4}\)$/);
    expect(sessionMediaDevices('windows', seed, 'zh-CN').audioInput).toMatch(/^麦克风 \(/);
    const linux = sessionMediaDevices('linux', seed, 'zh-CN');
    expect(linux.audioInput).toBe(linux.audioOutput);
    expect(linux.audioInput).toMatch(/Analog Stereo$/);
    expect(linux.videoInput).toMatch(/\([0-9a-f]{4}:[0-9a-f]{4}\)$/);
    expect(sessionMediaDevices('linux', seed, 'en-US')).toEqual(linux);
  });
});

describe('country locale', () => {
  it('maps a proxy exit to a timezone and Chrome language', () => {
    expect(countryLocale('JP')).toEqual({ timezone: 'Asia/Tokyo', language: 'ja' });
    expect(countryLocale('us', 'LAX')?.timezone).toBe('America/Los_Angeles');
    expect(countryLocale('CA', 'SEA')?.timezone).toBe('America/Toronto');
    expect(countryLocale('XX')).toBeNull();
  });

  it('resolves auto from a tested exit and keeps explicit values', () => {
    const exit = { ok: true, loc: 'DE', colo: 'FRA' };
    expect(resolveSessionLocale({ timezone: 'auto', chromeLanguage: 'auto' }, exit)).toEqual({
      timezone: 'Europe/Berlin',
      language: 'de',
    });
    expect(resolveSessionLocale({ timezone: 'Asia/Tokyo', chromeLanguage: 'auto' }, exit).timezone).toBe('Asia/Tokyo');
    expect(resolveSessionLocale({ timezone: 'auto', chromeLanguage: 'auto' }, { ...exit, ok: false })).toEqual({
      timezone: 'Asia/Shanghai',
      language: 'zh-CN',
    });
  });

  it('only uses valid timezones and languages', () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (const a of letters) {
      for (const b of letters) {
        const row = countryLocale(a + b);
        if (!row) continue;
        expect(isValidTimezone(row.timezone), a + b).toBe(true);
        expect(isValidChromeLanguage(row.language), a + b).toBe(true);
      }
    }
  });
});

describe('geo', () => {
  it('does not persist allow without coordinates', () => {
    expect(normalizeGeo({ permission: 'allow' }).permission).toBe('ask');
    expect(
      normalizeGeo({ permission: 'allow', latitude: 31.2, longitude: 121.5 }).permission,
    ).toBe('allow');
    expect(normalizeGeo({ permission: 'block' }).permission).toBe('block');
  });
});

describe('nested fingerprint on session schema', () => {
  it('accepts GET-shaped fingerprint on create/update', () => {
    const parsed = createSessionSchema.parse({
      name: 's1',
      fingerprint: { webrtcMode: 'replace', gpuProfile: 'rtx-2080', fontProfile: 'win11' },
    });
    expect(parsed.fingerprint).not.toHaveProperty('fontProfile');
    expect(pickSessionFingerprint(parsed)).toEqual({
      gpuProfile: 'rtx-2080',
      webrtcMode: 'replace',
      geo: undefined,
    });
  });
});

describe('emptyProxy', () => {
  it('is none', () => {
    expect(emptyProxy().type).toBe('none');
  });
});

describe('regionFromLoc', () => {
  it('maps JP to 日本', () => {
    expect(regionFromLoc('JP')).toBe('日本');
  });
});

describe('basePath', () => {
  it('normalizes missing, slash, and trailing slash', () => {
    expect(normalizeBasePath(undefined)).toBe('/');
    expect(normalizeBasePath('')).toBe('/');
    expect(normalizeBasePath('/')).toBe('/');
    expect(normalizeBasePath('nya-browser')).toBe('/nya-browser');
    expect(normalizeBasePath('/nya-browser/')).toBe('/nya-browser');
  });

  it('rejects unsafe values', () => {
    expect(normalizeBasePath('/foo/../bar')).toBe('/');
    expect(normalizeBasePath('//evil')).toBe('/');
    expect(normalizeBasePath('/foo bar')).toBe('/');
  });

  it('joins API and websocket paths', () => {
    expect(joinBasePath('/', '/api/health')).toBe('/api/health');
    expect(joinBasePath('/nya-browser', '/api/me')).toBe('/nya-browser/api/me');
    expect(joinBasePath('/nya-browser', '/ws/vnc/abc')).toBe('/nya-browser/ws/vnc/abc');
    expect(joinBasePath('/nya-browser', '/api/audit?q=1')).toBe('/nya-browser/api/audit?q=1');
  });

  it('rewrites index.html assets and injects the runtime prefix', () => {
    const html = `<head>
    <script>window.__NYA_BASE_PATH__ = window.__NYA_BASE_PATH__ || '/';</script>
    <script type="module" crossorigin src="./assets/index-aaaa.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-bbbb.css">
  </head>`;
    const out = injectIndexHtml(html, '/nya-browser');
    expect(out).toContain('window.__NYA_BASE_PATH__="/nya-browser";');
    expect(out).toContain('src="/nya-browser/assets/index-aaaa.js"');
    expect(out).toContain('href="/nya-browser/assets/index-bbbb.css"');
    expect(injectIndexHtml(html, '/')).toContain('src="/assets/index-aaaa.js"');
  });
});
