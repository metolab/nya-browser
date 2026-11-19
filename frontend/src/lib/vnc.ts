export const FIRST_FRAME_TIMEOUT_MS = 12_000;
export const UNSTICK_STALL_MS = 1_000;
export const STUCK_AFTER_UNSTICK_MS = 5_000;

export function vncWindowExtra(windowId?: string | null) {
  return windowId && windowId !== 'main' ? windowId : null;
}

export function shouldCloseForStall(state: {
  flipCount: number;
  queued: boolean;
  idleMs: number;
  unstickAt: number;
  now: number;
}): 'none' | 'unstick' | 'close' {
  if (state.flipCount === 0 && state.idleMs > FIRST_FRAME_TIMEOUT_MS) return 'close';
  // Once unstickDisplay clears _renderQ, queued becomes false; if no flip arrives
  // within STUCK_AFTER_UNSTICK_MS, noteFlip never cleared unstickAt so we close.
  if (state.unstickAt > 0 && state.now - state.unstickAt > STUCK_AFTER_UNSTICK_MS) return 'close';
  if (!state.queued) return 'none';
  if (state.idleMs > UNSTICK_STALL_MS) return 'unstick';
  return 'none';
}
