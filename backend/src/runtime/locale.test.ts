import { describe, expect, it } from 'vitest';
import { FALLBACK_LOCALE, localeKey, parseLocaleList, pickLocale } from './locale.js';

describe('session locale', () => {
  it('normalizes codeset spelling like glibc', () => {
    expect(localeKey('zh_TW.UTF-8')).toBe('zh_TW.utf8');
    expect(localeKey('zh_TW.utf8')).toBe('zh_TW.utf8');
    expect(localeKey('C')).toBe('C');
  });

  it('keeps an installed locale', () => {
    const installed = parseLocaleList('C\nC.utf8\nPOSIX\nzh_CN.utf8\nzh_TW.utf8\n');
    expect(pickLocale('zh_TW.UTF-8', installed)).toBe('zh_TW.UTF-8');
  });

  it('falls back to C.UTF-8 when the locale is missing', () => {
    const installed = parseLocaleList('C\nC.utf8\nPOSIX\nzh_CN.utf8\n');
    expect(pickLocale('zh_TW.UTF-8', installed)).toBe(FALLBACK_LOCALE);
    expect(pickLocale('vec_IT.UTF-8', installed)).toBe(FALLBACK_LOCALE);
  });

  it('passes through when locale -a is unavailable', () => {
    expect(pickLocale('ja_JP.UTF-8', null)).toBe('ja_JP.UTF-8');
  });
});
