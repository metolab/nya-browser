import { describe, expect, it } from 'vitest';
import {
  applyTargetsReady,
  beginHold,
  binaryTargetsMatch,
  CLIP_LOCK_MS,
  failHoldIfCurrent,
  rememberedClipboard,
  shouldFailHoldOnExit,
  shouldRememberGet,
  shouldSkipTextHold,
  type ClipboardHolder,
} from './clipboardLock.js';

function holder(partial: Partial<ClipboardHolder> = {}): ClipboardHolder {
  return {
    clipboardKind: 'text',
    clipboardText: 'hello',
    clipboardFiles: [],
    clipboardHolder: null,
    clipboardLockUntil: 0,
    holdGen: 0,
    ...partial,
  };
}

describe('clipboard lock helpers', () => {
  it('sets lockUntil in the future at spawn before TARGETS', () => {
    const h = holder();
    const child = { pid: 1 };
    const spawnAt = 1_000_000;
    beginHold(h, { kind: 'image', child, spawnAt });
    expect(h.clipboardKind).toBe('image');
    expect(h.clipboardLockUntil).toBe(spawnAt + CLIP_LOCK_MS);
    expect(h.clipboardLockUntil).toBeGreaterThan(spawnAt);
    expect(shouldSkipTextHold(h, spawnAt + 10)).toBe(true);
    expect(shouldRememberGet(h, spawnAt + 10)).toBe(true);
  });

  it('does not treat leftover STRING as image-ready', () => {
    expect(binaryTargetsMatch('image', 'TIMESTAMP\nTARGETS\nSTRING\nUTF8_STRING')).toBe(false);
    expect(binaryTargetsMatch('image', 'TARGETS\nimage/png')).toBe(true);
    expect(binaryTargetsMatch('files', 'UTF8_STRING')).toBe(false);
    expect(binaryTargetsMatch('files', 'text/uri-list')).toBe(true);
  });

  it('skips text set while image lock is live', () => {
    const h = holder({ clipboardKind: 'image', clipboardLockUntil: 5_000, clipboardHolder: { pid: 9 } });
    expect(shouldSkipTextHold(h, 4_000)).toBe(true);
    expect(shouldSkipTextHold(h, 6_000)).toBe(false);
  });

  it('GET during lock returns remembered image even if TARGETS would be text', () => {
    const h = holder({
      clipboardKind: 'image',
      clipboardText: '',
      clipboardLockUntil: 9_000,
    });
    expect(shouldRememberGet(h, 8_000)).toBe(true);
    expect(rememberedClipboard(h)).toEqual({ kind: 'image', text: '', files: [] });
  });

  it('does not replace holder when a late ready callback is superseded', () => {
    const first = { pid: 1 };
    const second = { pid: 2 };
    const h = holder();
    const a = beginHold(h, { kind: 'image', child: first, spawnAt: 100 });
    const b = beginHold(h, { kind: 'image', child: second, spawnAt: 200 });
    expect(applyTargetsReady(h, { gen: a.gen, child: first, readyAt: 220 })).toBe(false);
    expect(h.clipboardHolder).toBe(second);
    expect(applyTargetsReady(h, { gen: b.gen, child: second, readyAt: 240 })).toBe(true);
    expect(h.clipboardLockUntil).toBe(240 + 250);
  });

  it('does not treat xclip parent daemonize as a failed hold', () => {
    expect(shouldFailHoldOnExit(0, null)).toBe(false);
    expect(shouldFailHoldOnExit(null, null)).toBe(false);
    expect(shouldFailHoldOnExit(1, null)).toBe(true);
    expect(shouldFailHoldOnExit(null, 'SIGKILL')).toBe(true);
  });

  it('fail-restore only for the current unresolved hold', () => {
    const child = { pid: 3 };
    const h = holder({ clipboardText: 'keep' });
    const { gen, prev } = beginHold(h, { kind: 'image', child, spawnAt: 10 });
    expect(failHoldIfCurrent(h, { gen, child, prev, resolved: true })).toBe(false);
    expect(h.clipboardKind).toBe('image');
    expect(failHoldIfCurrent(h, { gen, child, prev, resolved: false })).toBe(true);
    expect(h.clipboardKind).toBe('text');
    expect(h.clipboardText).toBe('keep');
    expect(h.clipboardLockUntil).toBe(0);
    expect(h.clipboardHolder).toBeNull();
  });
});
