/**
 * Per-window display policy.
 *
 * Follow: remote = clamp(pane / scale). Smaller scale → larger desktop → more content.
 * Fixed: remote is the configured WxH.
 * Aspect and absolute framebuffer bounds are hard limits (shared with backend).
 */

import {
  DISPLAY_LIMITS,
  clampDisplayGeom,
  snapEven,
} from '@nya/shared';

export type DisplayMode = 'fixed' | 'follow';

export type Size = { w: number; h: number };

export type DisplayPolicy = {
  mode: DisplayMode;
  /** 0.5 = more desktop pixels in the same pane; 1.5 = fewer, larger UI. */
  scale: number;
  width: number;
  height: number;
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
};

export const FB_LIMITS = {
  minW: DISPLAY_LIMITS.minW,
  maxW: DISPLAY_LIMITS.maxW,
  minH: DISPLAY_LIMITS.minH,
  maxH: DISPLAY_LIMITS.maxH,
} as const;

export const SCALE_LIMITS = {
  min: DISPLAY_LIMITS.scaleMin,
  max: DISPLAY_LIMITS.scaleMax,
  step: DISPLAY_LIMITS.scaleStep,
} as const;

export { DISPLAY_LIMITS, snapEven, clampDisplayGeom };

export const SIZE_PRESETS: { label: string; w: number; h: number }[] = [
  { label: '1280×720', w: 1280, h: 720 },
  { label: '1920×1080', w: 1920, h: 1080 },
  { label: '2560×1440', w: 2560, h: 1440 },
];

export function defaultDisplayPolicy(): DisplayPolicy {
  return {
    mode: 'follow',
    scale: 1,
    width: 1920,
    height: 1080,
    minWidth: 800,
    maxWidth: 2560,
    minHeight: 600,
    maxHeight: 1440,
  };
}

function num(v: unknown, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export function snapEvenSize(s: Size): Size {
  return { w: snapEven(s.w), h: snapEven(s.h) };
}

export function normalizeDisplayPolicy(input?: Partial<DisplayPolicy> | null): DisplayPolicy {
  const d = defaultDisplayPolicy();
  const mode: DisplayMode = input?.mode === 'fixed' ? 'fixed' : 'follow';
  let minW = clamp(Math.round(num(input?.minWidth, d.minWidth)), FB_LIMITS.minW, FB_LIMITS.maxW);
  let maxW = clamp(Math.round(num(input?.maxWidth, d.maxWidth)), FB_LIMITS.minW, FB_LIMITS.maxW);
  let minH = clamp(Math.round(num(input?.minHeight, d.minHeight)), FB_LIMITS.minH, FB_LIMITS.maxH);
  let maxH = clamp(Math.round(num(input?.maxHeight, d.maxHeight)), FB_LIMITS.minH, FB_LIMITS.maxH);
  if (minW > maxW) [minW, maxW] = [maxW, minW];
  if (minH > maxH) [minH, maxH] = [maxH, minH];

  const width = clamp(Math.round(num(input?.width, d.width)), FB_LIMITS.minW, FB_LIMITS.maxW);
  const height = clamp(Math.round(num(input?.height, d.height)), FB_LIMITS.minH, FB_LIMITS.maxH);
  const scale =
    Math.round(
      clamp(num(input?.scale, d.scale), SCALE_LIMITS.min, SCALE_LIMITS.max) / SCALE_LIMITS.step,
    ) * SCALE_LIMITS.step;

  return {
    mode,
    scale: Number(scale.toFixed(2)),
    width,
    height,
    minWidth: minW,
    maxWidth: maxW,
    minHeight: minH,
    maxHeight: maxH,
  };
}

function clampFollow(pane: Size, p: DisplayPolicy): Size {
  let w = Math.max(1, pane.w);
  let h = Math.max(1, pane.h);

  const aspect = w / h;
  if (aspect > DISPLAY_LIMITS.aspectMax) w = h * DISPLAY_LIMITS.aspectMax;
  else if (aspect < DISPLAY_LIMITS.aspectMin) h = w / DISPLAY_LIMITS.aspectMin;

  const down = Math.min(p.maxWidth / w, p.maxHeight / h, 1);
  w *= down;
  h *= down;

  const up = Math.max(p.minWidth / w, p.minHeight / h, 1);
  w *= up;
  h *= up;

  w = clamp(w, p.minWidth, p.maxWidth);
  h = clamp(h, p.minHeight, p.maxHeight);

  return clampDisplayGeom(w, h);
}

export function resolveRemoteSize(pane: Size, policy: DisplayPolicy): Size {
  const p = normalizeDisplayPolicy(policy);
  if (p.mode === 'fixed') {
    return clampDisplayGeom(p.width, p.height);
  }
  const scale = Math.max(SCALE_LIMITS.min, p.scale || 1);
  return clampFollow({ w: pane.w / scale, h: pane.h / scale }, p);
}

export function windowDisplay(display?: DisplayPolicy | null): DisplayPolicy {
  return normalizeDisplayPolicy(display);
}

export function formatSize(s: Size) {
  return `${s.w}×${s.h}`;
}

export function formatScale(scale: number) {
  return `${Number(scale.toFixed(2))}×`;
}
