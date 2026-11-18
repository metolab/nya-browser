import { DISPLAY_LIMITS } from '@nya/shared';
import type { DisplayHolder, SessionRuntime, SubDesktop } from './types.js';

export const DISPLAY_BASE = Number(process.env.DISPLAY_BASE || 100);
export const SUB_DISPLAY_BASE = Number(process.env.SUB_DISPLAY_BASE || 2000);
export const MAX_SUBS = Number(process.env.MAX_SUBS || 8);
export const LOCAL_PROXY_BASE = Number(process.env.LOCAL_PROXY_BASE || 18000);
export const SLOT_UID_BASE = Number(process.env.SLOT_UID_BASE || 12000);

// Xvfb RANDR cannot grow past the initial -screen size. Start large so pane
// resizes can both shrink and grow. SCREEN_SIZE is only the boot geometry.
export const SCREEN_MAX = process.env.SCREEN_MAX || `${DISPLAY_LIMITS.maxW}x${DISPLAY_LIMITS.maxH}x24`;

export const SCREEN_INIT = process.env.SCREEN_SIZE || '1920x1080x24';

export const NYA_CDP_BASE = (() => {
  const raw = process.env.NYA_CDP_BASE;
  if (raw === '0' || raw === 'off' || raw === 'false') return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 19200;
})();

export const runtimes = new Map<string, SessionRuntime>();

export function getSubOrThrow(runtime: SessionRuntime, subId: string): SubDesktop {
  const sub = runtime.subs.find((s) => s.id === subId);
  if (!sub) throw new Error('Sub-desktop not found');
  return sub;
}

export function assertSessionRuntime(sessionId: string, subId: string | null = null) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) throw new Error('Session is not running');
  if (subId) getSubOrThrow(runtime, subId);
  return runtime;
}

export function getDisplayHolder(sessionId: string, subId: string | null = null) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) throw new Error('Session is not running');
  const holder: DisplayHolder = subId ? getSubOrThrow(runtime, subId) : runtime;
  return { runtime, holder };
}

export function getSubRuntime(sessionId: string, subId: string) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) return null;
  const sub = runtime.subs.find((s) => s.id === subId);
  if (!sub) return null;
  return { runtime, sub };
}

export function getRuntime(sessionId: string) {
  return runtimes.get(sessionId) || null;
}

export function listRunningIds() {
  return [...runtimes.keys()];
}
