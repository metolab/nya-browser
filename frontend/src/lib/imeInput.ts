export const COMMIT_SUPPRESS_MS = 120;
export const COMMIT_DEDUP_MS = 50;
export const TRAP_MIN_W = 16;
export const TRAP_H = 20;
export const TRAP_FONT = '16px/1.2 system-ui, sans-serif';

const COMMIT_CODES = new Set([
  'Space',
  'Enter',
  'NumpadEnter',
  'Digit1',
  'Digit2',
  'Digit3',
  'Digit4',
  'Digit5',
  'Digit6',
  'Digit7',
  'Digit8',
  'Digit9',
  'Numpad1',
  'Numpad2',
  'Numpad3',
  'Numpad4',
  'Numpad5',
  'Numpad6',
  'Numpad7',
  'Numpad8',
  'Numpad9',
]);

export type KeyLike = {
  type?: string;
  isComposing?: boolean;
  key?: string;
  code?: string;
  keyCode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

export function isPasteKey(e: KeyLike): boolean {
  if (e.altKey || e.shiftKey) return false;
  if (!(e.ctrlKey || e.metaKey)) return false;
  return e.key === 'v' || e.key === 'V' || e.code === 'KeyV';
}

export function shouldInterceptPaste(e: KeyLike, hasLocalPaste: boolean): boolean {
  return hasLocalPaste && isPasteKey(e);
}

export type DedupState = {
  text: string;
  at: number;
};

export function isComposingKey(e: KeyLike): boolean {
  if (e.isComposing) return true;
  if (e.key === 'Process') return true;
  if (e.keyCode === 229) return true;
  return false;
}

export function isCommitKey(e: KeyLike): boolean {
  if (e.key === ' ' || e.key === 'Space' || e.key === 'Enter') return true;
  return Boolean(e.code && COMMIT_CODES.has(e.code));
}

export function shouldSuppressCommitKey(
  now: number,
  lastCommitAt: number,
  e: KeyLike,
  lastCommitCode?: string | null,
): boolean {
  if (lastCommitAt <= 0) return false;
  if (now - lastCommitAt >= COMMIT_SUPPRESS_MS) return false;
  if (!isCommitKey(e)) return false;
  // Only suppress the same physical commit key when known so Space-commit + fast
  // Enter/Digit does not drop either keydown or its matching keyup.
  if (lastCommitCode && e.code && e.code !== lastCommitCode) {
    return false;
  }
  return true;
}

export function isCommittedCharKey(e: KeyLike): boolean {
  // Never swallow Ctrl/Meta shortcuts on non-Latin keyboard layouts (e.g. Cyrillic Ctrl+C).
  if ((e.ctrlKey && !e.altKey) || e.metaKey) return false;
  const key = e.key || '';
  if (!key || key === 'Unidentified' || key === 'Process' || key === 'Dead') return false;
  return [...key].some((ch) => (ch.codePointAt(0) || 0) > 0x7e);
}

export function shouldForwardKey(
  e: KeyLike,
  composing: boolean,
  now: number,
  lastCommitAt: number,
  opts?: { hasLocalPaste?: boolean; lastCommitCode?: string | null },
): boolean {
  if (composing) return false;
  if (isComposingKey(e)) return false;
  if (shouldInterceptPaste(e, opts?.hasLocalPaste ?? true)) return false;
  if (isCommittedCharKey(e)) return false;
  if (shouldSuppressCommitKey(now, lastCommitAt, e, opts?.lastCommitCode)) return false;
  return true;
}

export function shouldPreventDefaultKey(
  e: KeyLike,
  composing: boolean,
  hasLocalPaste = true,
): boolean {
  if (composing || isComposingKey(e)) return false;
  if (shouldInterceptPaste(e, hasLocalPaste)) return false;
  // Let direct non-ASCII keys (e.g. CJK punctuation or dead-key/accented chars)
  // land in the textarea so the input fallback can inject them via xtype.
  if (isCommittedCharKey(e)) return false;
  return true;
}

export function commitTextFromEvents(
  data: string | null | undefined,
  value: string,
  nextComposing = false,
): string {
  const fromData = String(data ?? '');
  const fromValue = String(value ?? '');
  if (nextComposing) return fromData;
  if (fromValue.length > fromData.length) return fromValue;
  return fromData;
}

export function shouldSendCommit(
  text: string,
  now: number,
  last: DedupState | null,
  windowMs = COMMIT_DEDUP_MS,
): boolean {
  if (!text) return false;
  if (last && last.text === text && now - last.at <= windowMs) return false;
  return true;
}

export function isFallbackInsert(inputType: string, composing: boolean, value: string): boolean {
  if (composing || !value) return false;
  return (
    inputType === 'insertText' ||
    inputType === 'insertFromYank' ||
    inputType === 'insertReplacementText' ||
    inputType === ''
  );
}

export function clampTrapPos(
  x: number,
  y: number,
  wrapW: number,
  wrapH: number,
  trapW = TRAP_MIN_W,
  trapH = TRAP_H,
): { x: number; y: number } {
  const maxX = Math.max(0, wrapW - trapW);
  const maxY = Math.max(0, wrapH - trapH);
  return {
    x: Math.min(Math.max(0, x), maxX),
    y: Math.min(Math.max(0, y), maxY),
  };
}

export function advanceTrapX(x: number, textWidth: number, wrapW: number, trapW = TRAP_MIN_W): number {
  return Math.min(Math.max(0, x + Math.max(0, textWidth)), Math.max(0, wrapW - trapW));
}

export function keyboardEventInit(e: KeyboardEvent): KeyboardEventInit {
  return {
    key: e.key,
    code: e.code,
    location: e.location,
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
    repeat: e.repeat,
    modifierCapsLock: e.getModifierState?.('CapsLock') ?? false,
    modifierNumLock: e.getModifierState?.('NumLock') ?? false,
    bubbles: true,
    cancelable: true,
  };
}

export function canTakeImeFocus(wrap: HTMLElement, trap: HTMLElement): boolean {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return true;
  if (el === trap || wrap.contains(el)) return true;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
  if (el instanceof HTMLElement && el.isContentEditable) return false;
  return true;
}
