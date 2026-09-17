import { PASTE_IMAGE_MAX_EDGE } from '@nya/shared';

export const WEBP_QUALITY = 0.92;

export function fitMaxEdge(width: number, height: number, maxEdge = PASTE_IMAGE_MAX_EDGE) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const edge = Math.max(w, h);
  if (edge <= maxEdge) return { width: w, height: h, scaled: false };
  const scale = maxEdge / edge;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scaled: true,
  };
}

export async function encodePasteImage(blob: Blob): Promise<{ blob: Blob; mime: string; compressed: boolean }> {
  try {
    const bitmap = await createImageBitmap(blob);
    const size = fitMaxEdge(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();
    const webp = await canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
    if (webp && webp.size > 0) return { blob: webp, mime: 'image/webp', compressed: true };
  } catch {
    /* fall through */
  }
  return { blob, mime: blob.type || 'application/octet-stream', compressed: false };
}
