import { normalizeClipboardText, type ClipboardKind } from '@nya/shared';

export const CLIP_MAX = 1024 * 1024;
export const BINARY_HOLD_MS = 2000;
export const EMPTY_SETTLE_MS = 2000;

export type GateMode = 'auto' | 'manual';
export type ApplyAction = 'apply-binary' | 'apply-text' | 'ignore-stale';

export type GateState = {
  lastText: string;
  remoteKind: ClipboardKind;
  binaryUntil: number;
  emptySettleUntil: number;
};

export function clipText(value: unknown) {
  const text = String(value ?? '');
  return text.length > CLIP_MAX ? text.slice(0, CLIP_MAX) : text;
}

export function normalizeClip(incoming: unknown, previous = '') {
  return normalizeClipboardText(clipText(incoming), previous);
}

export function shouldPushLocalText(
  state: GateState,
  next: string,
  mode: GateMode,
  now = Date.now(),
  opts?: { pendingFlush?: boolean },
): 'push' | 'skip' {
  const pendingFlush = Boolean(opts?.pendingFlush && (state.remoteKind === 'image' || state.remoteKind === 'files'));
  if (!pendingFlush && next === state.lastText) return 'skip';
  if (mode === 'auto' && now < state.binaryUntil) return 'skip';
  if (mode === 'auto' && now < (state.emptySettleUntil || 0) && next !== state.lastText) return 'skip';
  if (mode === 'auto' && next === '' && state.remoteKind !== 'text') return 'skip';
  return 'push';
}

export function shouldApplyRemote(
  state: GateState,
  remote: { kind?: string; text?: string },
  source: GateMode,
  now = Date.now(),
): ApplyAction {
  const kind = remote.kind || 'text';
  if (kind === 'image' || kind === 'files') return 'apply-binary';
  if (source === 'manual' && kind === 'text') return 'apply-text';
  if (source === 'auto' && kind === 'text' && now < state.binaryUntil) return 'ignore-stale';
  return 'apply-text';
}
