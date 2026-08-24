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
  isComposing?: boolean;
  key?: string;
  code?: string;
  keyCode?: number;
};

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

export function shouldSuppressCommitKey(now: number, lastCommitAt: number, e: KeyLike): boolean {
  if (lastCommitAt <= 0) return false;
  if (now - lastCommitAt >= COMMIT_SUPPRESS_MS) return false;
  return isCommitKey(e);
}

export function shouldForwardKey(
  e: KeyLike,
  composing: boolean,
  now: number,
  lastCommitAt: number,
): boolean {
  if (composing) return false;
  if (isComposingKey(e)) return false;
  if (shouldSuppressCommitKey(now, lastCommitAt, e)) return false;
  return true;
}

export function shouldPreventDefaultKey(e: KeyLike, composing: boolean): boolean {
  if (composing || isComposingKey(e)) return false;
  return true;
}

export function unicodeKeysym(codePoint: number): number {
  if (codePoint >= 0x20 && codePoint <= 0xff) return codePoint;
  return 0x01000000 | codePoint;
}

export function keysymsFromText(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (!cp || cp < 0x20) continue;
    out.push(unicodeKeysym(cp));
  }
  return out;
}

export function commitTextFromEvents(data: string | null | undefined, value: string): string {
  const fromData = String(data ?? '');
  if (fromData) return fromData;
  return String(value ?? '');
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
  return inputType === 'insertText' || inputType === 'insertFromYank';
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

export function sendUnicodeKeysyms(
  sendKey: (keysym: number, code: string | null, down?: boolean) => void,
  text: string,
) {
  for (const keysym of keysymsFromText(text)) {
    sendKey(keysym, null, true);
    sendKey(keysym, null, false);
  }
}
