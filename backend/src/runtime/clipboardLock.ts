import path from 'path';
import { type ClipboardKind, type SessionClipboard } from '@nya/shared';

export const CLIP_LOCK_MS = 2000;
export const CLIP_READY_SLACK_MS = 250;
export const CLIP_HTTP_CAP_MS = 150;

export type ClipboardHolder = {
  display?: number;
  clipboardKind?: ClipboardKind | string;
  clipboardText?: string;
  clipboardFiles?: string[];
  clipboardHolder?: { pid?: number } | null;
  clipboardLockUntil?: number;
  holdGen?: number;
};

export function clipboardState(
  holder: ClipboardHolder,
  kind: ClipboardKind,
  text = '',
  files: string[] = [],
): SessionClipboard {
  return {
    kind,
    text: kind === 'text' ? text : '',
    files: kind === 'files' ? files : [],
  };
}

export function rememberedClipboard(holder: ClipboardHolder): SessionClipboard {
  const kind = (holder.clipboardKind || 'text') as ClipboardKind;
  const text = typeof holder.clipboardText === 'string' ? holder.clipboardText : '';
  const files = (Array.isArray(holder.clipboardFiles) ? holder.clipboardFiles : []).map((item) =>
    path.basename(item),
  );
  return clipboardState(holder, kind, text, files);
}

export function isBinaryKind(kind?: string) {
  return kind === 'image' || kind === 'files';
}

export function shouldSkipTextHold(holder: ClipboardHolder, now = Date.now()) {
  return isBinaryKind(String(holder.clipboardKind || '')) && now < (holder.clipboardLockUntil || 0);
}

export function shouldRememberGet(holder: ClipboardHolder, now = Date.now()) {
  return shouldSkipTextHold(holder, now);
}

export function binaryTargetsMatch(kind: string, targets: string) {
  if (kind === 'image') return /image\/png/i.test(targets);
  if (kind === 'files') return /text\/uri-list|x-special\/gnome-copied-files/i.test(targets);
  return /UTF8_STRING|text\/plain|STRING/i.test(targets);
}

export function beginHold(
  holder: ClipboardHolder,
  opts: {
    kind: ClipboardKind;
    text?: string;
    files?: string[];
    child: { pid?: number } | null;
    spawnAt: number;
  },
) {
  const prev = {
    kind: (holder.clipboardKind || 'text') as ClipboardKind,
    text: typeof holder.clipboardText === 'string' ? holder.clipboardText : '',
    files: Array.isArray(holder.clipboardFiles) ? holder.clipboardFiles.slice() : [],
    child: holder.clipboardHolder || null,
  };
  holder.holdGen = (holder.holdGen || 0) + 1;
  holder.clipboardHolder = opts.child;
  holder.clipboardKind = opts.kind;
  holder.clipboardText = opts.kind === 'text' ? String(opts.text || '') : '';
  holder.clipboardFiles = opts.kind === 'files' ? opts.files || [] : [];
  holder.clipboardLockUntil = isBinaryKind(opts.kind) ? opts.spawnAt + CLIP_LOCK_MS : 0;
  return { gen: holder.holdGen, prev };
}

export function applyTargetsReady(
  holder: ClipboardHolder,
  opts: { gen: number; child: { pid?: number } | null; readyAt: number },
) {
  if (opts.gen !== holder.holdGen || opts.child !== holder.clipboardHolder) return false;
  if (!isBinaryKind(String(holder.clipboardKind || ''))) return true;
  holder.clipboardLockUntil = Math.min(holder.clipboardLockUntil || 0, opts.readyAt + CLIP_READY_SLACK_MS);
  return true;
}

/** xclip forks after reading stdin; the parent exits 0. That is not a failed hold. */
export function shouldFailHoldOnExit(code: number | null, signal?: NodeJS.Signals | string | null) {
  if (signal) return true;
  return code != null && code !== 0;
}

export function failHoldIfCurrent(
  holder: ClipboardHolder,
  opts: {
    gen: number;
    child: { pid?: number } | null;
    prev: { kind: ClipboardKind; text: string; files: string[] };
    resolved: boolean;
  },
) {
  if (opts.resolved) return false;
  if (opts.gen !== holder.holdGen || opts.child !== holder.clipboardHolder) return false;
  holder.clipboardHolder = null;
  holder.clipboardLockUntil = 0;
  holder.clipboardKind = opts.prev.kind;
  holder.clipboardText = opts.prev.text;
  holder.clipboardFiles = opts.prev.files;
  return true;
}

export function clearClipboardLock(holder: ClipboardHolder | null | undefined) {
  if (!holder) return;
  holder.clipboardLockUntil = 0;
}
