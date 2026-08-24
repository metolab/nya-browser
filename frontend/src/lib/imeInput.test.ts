import { describe, expect, it } from 'vitest';
import {
  COMMIT_SUPPRESS_MS,
  advanceTrapX,
  clampTrapPos,
  commitTextFromEvents,
  isCommitKey,
  isComposingKey,
  isFallbackInsert,
  keysymsFromText,
  shouldForwardKey,
  shouldPreventDefaultKey,
  shouldSendCommit,
  shouldSuppressCommitKey,
  unicodeKeysym,
  sendUnicodeKeysyms,
} from './imeInput';

describe('isComposingKey', () => {
  it('detects isComposing, Process, and keyCode 229', () => {
    expect(isComposingKey({ isComposing: true, key: 'a' })).toBe(true);
    expect(isComposingKey({ key: 'Process' })).toBe(true);
    expect(isComposingKey({ keyCode: 229, key: 'a' })).toBe(true);
    expect(isComposingKey({ key: 'a', code: 'KeyA' })).toBe(false);
  });
});

describe('commit keys', () => {
  it('treats space, enter, and candidate digits as commit keys', () => {
    expect(isCommitKey({ key: ' ', code: 'Space' })).toBe(true);
    expect(isCommitKey({ key: 'Enter', code: 'Enter' })).toBe(true);
    expect(isCommitKey({ key: '1', code: 'Digit1' })).toBe(true);
    expect(isCommitKey({ key: '3', code: 'Numpad3' })).toBe(true);
    expect(isCommitKey({ key: 'a', code: 'KeyA' })).toBe(false);
    expect(isCommitKey({ key: '0', code: 'Digit0' })).toBe(false);
  });

  it('swallows commit keys only inside the post-commit window', () => {
    const space = { key: ' ', code: 'Space' };
    expect(shouldSuppressCommitKey(100, 0, space)).toBe(false);
    expect(shouldSuppressCommitKey(100, 100, space)).toBe(true);
    expect(shouldSuppressCommitKey(100 + COMMIT_SUPPRESS_MS, 100, space)).toBe(false);
    expect(shouldSuppressCommitKey(150, 100, { key: 'a', code: 'KeyA' })).toBe(false);
  });
});

describe('shouldForwardKey', () => {
  it('blocks composing and post-commit keys, forwards the rest', () => {
    expect(shouldForwardKey({ key: 'a', code: 'KeyA' }, true, 200, 0)).toBe(false);
    expect(shouldForwardKey({ keyCode: 229 }, false, 200, 0)).toBe(false);
    expect(shouldForwardKey({ key: ' ', code: 'Space' }, false, 150, 100)).toBe(false);
    expect(shouldForwardKey({ key: 'Enter', code: 'Enter' }, false, 150, 100)).toBe(false);
    expect(shouldForwardKey({ key: 'a', code: 'KeyA' }, false, 150, 100)).toBe(true);
    expect(shouldForwardKey({ key: 'Tab', code: 'Tab' }, false, 1000, 0)).toBe(true);
  });
});

describe('shouldPreventDefaultKey', () => {
  it('lets the IME handle composing keys and blocks the rest', () => {
    expect(shouldPreventDefaultKey({ key: 'a', code: 'KeyA' }, true)).toBe(false);
    expect(shouldPreventDefaultKey({ keyCode: 229 }, false)).toBe(false);
    expect(shouldPreventDefaultKey({ key: ' ', code: 'Space' }, false)).toBe(true);
    expect(shouldPreventDefaultKey({ key: 'a', code: 'KeyA' }, false)).toBe(true);
  });
});

describe('unicode keysyms', () => {
  it('maps latin-1 directly and CJK via the 0x01000000 plane', () => {
    expect(unicodeKeysym(0x41)).toBe(0x41);
    expect(unicodeKeysym(0xff)).toBe(0xff);
    expect(unicodeKeysym('你'.codePointAt(0)!)).toBe(0x01000000 | 0x4f60);
  });

  it('skips control characters and emits down/up pairs', () => {
    expect(keysymsFromText('\n你好')).toEqual([0x01000000 | 0x4f60, 0x01000000 | 0x597d]);
    const sent: Array<[number, string | null, boolean | undefined]> = [];
    sendUnicodeKeysyms((keysym, code, down) => sent.push([keysym, code, down]), 'A你');
    expect(sent).toEqual([
      [0x41, null, true],
      [0x41, null, false],
      [0x01000000 | 0x4f60, null, true],
      [0x01000000 | 0x4f60, null, false],
    ]);
  });
});

describe('commit text', () => {
  it('prefers compositionend data, then textarea value', () => {
    expect(commitTextFromEvents('你好', 'ignored')).toBe('你好');
    expect(commitTextFromEvents('', '好')).toBe('好');
    expect(commitTextFromEvents(null, '')).toBe('');
  });

  it('dedups the same commit across compositionend and input', () => {
    expect(shouldSendCommit('你', 10, null)).toBe(true);
    expect(shouldSendCommit('你', 40, { text: '你', at: 10 })).toBe(false);
    expect(shouldSendCommit('好', 40, { text: '你', at: 10 })).toBe(true);
    expect(shouldSendCommit('你', 80, { text: '你', at: 10 })).toBe(true);
    expect(shouldSendCommit('', 10, null)).toBe(false);
  });

  it('only uses input fallback for insertText-like types', () => {
    expect(isFallbackInsert('insertText', false, '🙂')).toBe(true);
    expect(isFallbackInsert('insertFromYank', false, 'a')).toBe(true);
    expect(isFallbackInsert('insertText', true, 'ni')).toBe(false);
    expect(isFallbackInsert('insertCompositionText', false, 'ni')).toBe(false);
    expect(isFallbackInsert('insertText', false, '')).toBe(false);
  });
});

describe('trap position', () => {
  it('clamps to the wrap and advances after a commit', () => {
    expect(clampTrapPos(-8, -8, 800, 600)).toEqual({ x: 0, y: 0 });
    expect(clampTrapPos(900, 700, 800, 600, 16, 20)).toEqual({ x: 784, y: 580 });
    expect(advanceTrapX(100, 32, 800, 16)).toBe(132);
    expect(advanceTrapX(790, 40, 800, 16)).toBe(784);
  });
});
