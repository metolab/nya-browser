import { describe, expect, it } from 'vitest';
import {
  COMMIT_SUPPRESS_MS,
  advanceTrapX,
  clampTrapPos,
  commitTextFromEvents,
  isCommitKey,
  isCommittedCharKey,
  isComposingKey,
  isFallbackInsert,
  isPasteKey,
  keyboardEventInit,
  shouldForwardKey,
  shouldInterceptPaste,
  shouldPreventDefaultKey,
  shouldSendCommit,
  shouldSuppressCommitKey,
} from './imeInput';

describe('paste keys', () => {
  it('holds Ctrl/Cmd+V for the local paste interceptor, but passes Ctrl+Shift+V and no-handler mode', () => {
    const paste = { key: 'v', code: 'KeyV', ctrlKey: true };
    const plainPaste = { key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true };
    expect(isPasteKey(paste)).toBe(true);
    expect(isPasteKey(plainPaste)).toBe(false);
    expect(shouldInterceptPaste(paste, true)).toBe(true);
    expect(shouldInterceptPaste(paste, false)).toBe(false);
    expect(shouldForwardKey(paste, false, 0, 0)).toBe(false);
    expect(shouldForwardKey(paste, false, 0, 0, { hasLocalPaste: false })).toBe(true);
    expect(shouldForwardKey(plainPaste, false, 0, 0)).toBe(true);
    expect(shouldPreventDefaultKey(paste, false, true)).toBe(false);
    expect(shouldPreventDefaultKey(paste, false, false)).toBe(true);
    expect(isPasteKey({ key: 'v', code: 'KeyV' })).toBe(false);
  });
});

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

  it('swallows commit keys inside the post-commit window without eating fast Enter keydown or keyup after Space', () => {
    const spaceDown = { type: 'keydown', key: ' ', code: 'Space' };
    const spaceUp = { type: 'keyup', key: ' ', code: 'Space' };
    const enterDown = { type: 'keydown', key: 'Enter', code: 'Enter' };
    const enterUp = { type: 'keyup', key: 'Enter', code: 'Enter' };
    expect(shouldSuppressCommitKey(100, 0, spaceDown)).toBe(false);
    expect(shouldSuppressCommitKey(100, 100, spaceDown, 'Space')).toBe(true);
    expect(shouldSuppressCommitKey(100, 100, spaceUp, 'Space')).toBe(true);
    expect(shouldSuppressCommitKey(140, 100, enterDown, 'Space')).toBe(false);
    expect(shouldSuppressCommitKey(180, 100, enterUp, 'Space')).toBe(false);
    expect(shouldSuppressCommitKey(100 + COMMIT_SUPPRESS_MS, 100, spaceDown, 'Space')).toBe(false);
    expect(shouldSuppressCommitKey(150, 100, { type: 'keydown', key: 'a', code: 'KeyA' }, 'Space')).toBe(false);
  });
});

describe('shouldForwardKey', () => {
  it('blocks composing and post-commit keys, forwards the rest', () => {
    expect(shouldForwardKey({ key: 'a', code: 'KeyA' }, true, 200, 0)).toBe(false);
    expect(shouldForwardKey({ keyCode: 229 }, false, 200, 0)).toBe(false);
    expect(shouldForwardKey({ type: 'keyup', key: ' ', code: 'Space' }, false, 150, 100)).toBe(false);
    expect(shouldForwardKey({ type: 'keydown', key: 'Enter', code: 'Enter' }, false, 150, 100, { lastCommitCode: 'Space' })).toBe(true);
    expect(shouldForwardKey({ key: 'a', code: 'KeyA' }, false, 150, 100)).toBe(true);
    expect(shouldForwardKey({ key: 'Tab', code: 'Tab' }, false, 1000, 0)).toBe(true);
  });

  it('does not send IME-committed CJK/punctuation via VNC keys, while letting textarea receive them', () => {
    expect(isCommittedCharKey({ key: '你' })).toBe(true);
    expect(isCommittedCharKey({ key: '，' })).toBe(true);
    expect(isCommittedCharKey({ key: '⬆' })).toBe(true);
    expect(isCommittedCharKey({ key: 'a', code: 'KeyA' })).toBe(false);
    expect(isCommittedCharKey({ key: 'Enter', code: 'Enter' })).toBe(false);
    expect(isCommittedCharKey({ key: 'с', code: 'KeyC', ctrlKey: true })).toBe(false);
    expect(isCommittedCharKey({ key: 'с', code: 'KeyC', metaKey: true })).toBe(false);
    expect(shouldForwardKey({ key: 'с', code: 'KeyC', ctrlKey: true }, false, 200, 0)).toBe(true);
    expect(shouldForwardKey({ key: '你' }, false, 200, 0)).toBe(false);
    expect(shouldForwardKey({ key: '，' }, false, 200, 0)).toBe(false);
    expect(shouldPreventDefaultKey({ key: '，' }, false)).toBe(false);
    expect(shouldPreventDefaultKey({ key: 'é' }, false)).toBe(false);
  });
});

describe('shouldPreventDefaultKey', () => {
  it('lets the IME and direct non-ASCII keys pass to textarea and blocks the rest', () => {
    expect(shouldPreventDefaultKey({ key: 'a', code: 'KeyA' }, true)).toBe(false);
    expect(shouldPreventDefaultKey({ keyCode: 229 }, false)).toBe(false);
    expect(shouldPreventDefaultKey({ key: ' ', code: 'Space' }, false)).toBe(true);
    expect(shouldPreventDefaultKey({ key: 'a', code: 'KeyA' }, false)).toBe(true);
  });
});

describe('keyboardEventInit', () => {
  it('preserves CapsLock and NumLock modifier states', () => {
    const fake = {
      key: 'A',
      code: 'KeyA',
      location: 0,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      repeat: false,
      getModifierState: (mod: string) => mod === 'CapsLock' || mod === 'NumLock',
    } as unknown as KeyboardEvent;
    const init = keyboardEventInit(fake);
    expect(init.modifierCapsLock).toBe(true);
    expect(init.modifierNumLock).toBe(true);
  });
});

describe('commit text', () => {
  it('prefers compositionend data, then textarea value', () => {
    expect(commitTextFromEvents('你好', '你好')).toBe('你好');
    expect(commitTextFromEvents('', '好')).toBe('好');
    expect(commitTextFromEvents(null, '')).toBe('');
  });

  it('uses the longer committed string when the IME split data and value', () => {
    expect(commitTextFromEvents('个', '这个太平淡了')).toBe('这个太平淡了');
    expect(commitTextFromEvents('我比较喜欢', '我')).toBe('我比较喜欢');
  });

  it('keeps only the committed segment when the next composition already started', () => {
    expect(commitTextFromEvents('我', '我比较喜欢', true)).toBe('我');
    expect(commitTextFromEvents('要有一', '要有一些剧情', true)).toBe('要有一');
    expect(commitTextFromEvents('', '比较喜欢', true)).toBe('');
  });

  it('dedups the same commit across compositionend and input', () => {
    expect(shouldSendCommit('你', 10, null)).toBe(true);
    expect(shouldSendCommit('你', 40, { text: '你', at: 10 })).toBe(false);
    expect(shouldSendCommit('好', 40, { text: '你', at: 10 })).toBe(true);
    expect(shouldSendCommit('你', 80, { text: '你', at: 10 })).toBe(true);
    expect(shouldSendCommit('', 10, null)).toBe(false);
  });

  it('uses input fallback for insertText-like types including empty inputType', () => {
    expect(isFallbackInsert('insertText', false, '🙂')).toBe(true);
    expect(isFallbackInsert('insertFromYank', false, 'a')).toBe(true);
    expect(isFallbackInsert('insertReplacementText', false, '，')).toBe(true);
    expect(isFallbackInsert('', false, '，')).toBe(true);
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
