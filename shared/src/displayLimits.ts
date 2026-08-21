export const DISPLAY_LIMITS = {
  minW: 400,
  maxW: 5760,
  minH: 300,
  maxH: 3240,
  scaleMin: 0.5,
  scaleMax: 1.5,
  scaleStep: 0.05,
  aspectMin: 9 / 16,
  aspectMax: 21 / 9,
};

export function snapEven(n: number): number {
  const v = Math.round(Number(n) || 0);
  const even = v % 2 === 0 ? v : v - 1;
  return Math.max(2, even);
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export function clampDisplayGeom(width: number, height: number) {
  const L = DISPLAY_LIMITS;
  let w = clamp(snapEven(width), L.minW, L.maxW);
  let h = clamp(snapEven(height), L.minH, L.maxH);
  const a = w / Math.max(1, h);
  if (a > L.aspectMax) {
    w = clamp(snapEven(h * L.aspectMax), L.minW, L.maxW);
  } else if (a < L.aspectMin) {
    h = clamp(snapEven(w / L.aspectMin), L.minH, L.maxH);
  }
  return { w, h };
}
