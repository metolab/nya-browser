import { describe, expect, it } from 'vitest';
import { clampDisplayGeom, DISPLAY_LIMITS } from './displayLimits.js';
import {
  loginSchema,
  createUserSchema,
  createProxySchema,
  createGroupSchema,
  putUserGrantsSchema,
  putTargetGrantsSchema,
  createSessionSchema,
  IDLE_TIMEOUT_MINUTES_MAX,
} from './schemas.js';
import { normalizeTimezone, DEFAULT_TIMEZONE, isValidTimezone } from './timezones.js';
import {
  normalizeChromeLanguage,
  DEFAULT_CHROME_LANGUAGE,
  acceptLanguageHeader,
  posixLocale,
} from './languages.js';
import { emptyProxy } from './types.js';
import { regionFromLoc } from './region.js';

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
    expect(putTargetGrantsSchema.parse({ userIds: ['u1', 'u2'] }).userIds).toEqual(['u1', 'u2']);
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

  it('defaults idle timeout to 0', () => {
    const s = createSessionSchema.parse({ name: 's1' });
    expect(s.idleTimeoutMinutes).toBe(0);
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
