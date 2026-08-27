import { describe, expect, it } from 'vitest';
import {
  decodeUtf8FromLatin1,
  isLatin1Replacement,
  normalizeClipboardText,
  replaceNonLatin1,
} from './clipboardText.js';

const GOOD = `已開始執行
Initializing environment
Installing packages
Running code
你叫什么名字？
OSError: [Errno 29] I/O error
執行已在 2.5 毫秒內完成`;

function toMojibake(text: string) {
  return String.fromCharCode(...new TextEncoder().encode(text));
}

describe('clipboard encoding recovery', () => {
  it('recovers UTF-8 bytes that were decoded as Latin-1', () => {
    const mojibake = toMojibake(GOOD);
    expect(mojibake.startsWith('å·²')).toBe(true);
    expect(decodeUtf8FromLatin1(mojibake)).toBe(GOOD);
    expect(normalizeClipboardText(mojibake)).toBe(GOOD);
  });

  it('drops the ISO-8859-1 "?" substitution of a known good value', () => {
    const degraded = replaceNonLatin1(GOOD);
    expect(degraded).toContain('?????');
    expect(degraded).toContain('Initializing environment');
    expect(isLatin1Replacement(GOOD, degraded)).toBe(true);
    expect(normalizeClipboardText(degraded, GOOD)).toBeNull();
  });

  it('keeps the correct UTF-8 payload and ignores later degraded copies', () => {
    const mojibake = toMojibake(GOOD);
    const first = normalizeClipboardText(mojibake, '');
    expect(first).toBe(GOOD);
    expect(normalizeClipboardText(GOOD, first || '')).toBe(GOOD);
    expect(normalizeClipboardText(replaceNonLatin1(GOOD), first || '')).toBeNull();
  });

  it('upgrades a "?" Latin-1 fallback when real UTF-8 arrives later', () => {
    const degraded = replaceNonLatin1(GOOD);
    expect(normalizeClipboardText(GOOD, degraded)).toBe(GOOD);
  });

  it('does not treat real question marks as a Latin-1 fallback', () => {
    expect(normalizeClipboardText('hello?', '')).toBe('hello?');
    expect(normalizeClipboardText('你叫什么名字？', '')).toBe('你叫什么名字？');
  });
});
