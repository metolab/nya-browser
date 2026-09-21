import { describe, expect, it } from 'vitest';
import {
  BINARY_HOLD_MS,
  shouldApplyRemote,
  shouldPushLocalText,
  type GateState,
} from './clipboardGate';

const base = (partial: Partial<GateState> = {}): GateState => ({
  lastText: 'hello',
  remoteKind: 'text',
  binaryUntil: 0,
  emptySettleUntil: 0,
  ...partial,
});

describe('shouldPushLocalText', () => {
  it('skips all auto text during binaryUntil', () => {
    const state = base({ remoteKind: 'image', binaryUntil: 5_000 });
    expect(shouldPushLocalText(state, '', 'auto', 1_000)).toBe('skip');
    expect(shouldPushLocalText(state, 'new', 'auto', 1_000)).toBe('skip');
    expect(shouldPushLocalText(state, '', 'manual', 1_000)).toBe('push');
  });

  it('skips auto empty after lock if remote is still binary', () => {
    const state = base({ remoteKind: 'image', binaryUntil: 0, lastText: 'hello' });
    expect(shouldPushLocalText(state, '', 'auto', 9_000)).toBe('skip');
  });

  it('pushes auto non-empty after lock', () => {
    const state = base({ remoteKind: 'image', binaryUntil: 0 });
    expect(shouldPushLocalText(state, 'world', 'auto', 9_000)).toBe('push');
  });

  it('skips lastText match unless pending flush of binary remote', () => {
    const state = base({ remoteKind: 'image', binaryUntil: 0, lastText: 'hello' });
    expect(shouldPushLocalText(state, 'hello', 'auto', 9_000)).toBe('skip');
    expect(shouldPushLocalText(state, 'hello', 'auto', 9_000, { pendingFlush: true })).toBe('push');
  });

  it('does not PUT empty or leftover during settle after pending 200', () => {
    const state = base({ remoteKind: 'text', lastText: 'hello', emptySettleUntil: 8_000 });
    expect(shouldPushLocalText(state, '', 'auto', 7_000)).toBe('skip');
    expect(shouldPushLocalText(state, 'leftover', 'auto', 7_000)).toBe('skip');
    expect(shouldPushLocalText(state, 'hello', 'auto', 7_000)).toBe('skip');
  });
});

describe('shouldApplyRemote', () => {
  it('ignores all auto GET text during lock', () => {
    const state = base({ binaryUntil: 5_000 });
    expect(shouldApplyRemote(state, { kind: 'text', text: '' }, 'auto', 1_000)).toBe('ignore-stale');
    expect(shouldApplyRemote(state, { kind: 'text', text: 'hello' }, 'auto', 1_000)).toBe('ignore-stale');
    expect(shouldApplyRemote(state, { kind: 'text', text: 'other' }, 'auto', 1_000)).toBe('ignore-stale');
  });

  it('applies manual pull text inside binaryUntil', () => {
    const state = base({ binaryUntil: 5_000, remoteKind: 'image' });
    expect(shouldApplyRemote(state, { kind: 'text', text: 'from-remote' }, 'manual', 1_000)).toBe(
      'apply-text',
    );
  });

  it('applies binary without needing lock window', () => {
    expect(shouldApplyRemote(base(), { kind: 'image' }, 'auto', 1_000)).toBe('apply-binary');
    expect(shouldApplyRemote(base(), { kind: 'files' }, 'manual', 1_000)).toBe('apply-binary');
  });

  it('applies new remote text after lock', () => {
    expect(shouldApplyRemote(base({ binaryUntil: 0 }), { kind: 'text', text: 'x' }, 'auto', 9_000)).toBe(
      'apply-text',
    );
  });
});

describe('BINARY_HOLD_MS', () => {
  it('is two seconds', () => {
    expect(BINARY_HOLD_MS).toBe(2000);
  });
});
