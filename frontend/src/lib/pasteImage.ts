import { PASTE_IMAGE_MAX_EDGE } from '@nya/shared';

export const WEBP_QUALITY = 0.92;
export const PASTE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;

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

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch {
      resolve(null);
    }
  });
}

function isSupportedClipboardMime(mime: string) {
  return mime === 'image/webp' || mime === 'image/png';
}

export async function encodePasteImage(
  blob: Blob,
): Promise<{ blob: Blob; mime: string; compressed: boolean }> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
    const size = fitMaxEdge(bitmap.width, bitmap.height);

    // Prefer OffscreenCanvas WebP for small payloads.
    if (typeof OffscreenCanvas !== 'undefined') {
      try {
        const canvas = new OffscreenCanvas(size.width, size.height);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0, size.width, size.height);
          const webp = await canvas.convertToBlob({ type: 'image/webp', quality: WEBP_QUALITY });
          if (webp && webp.size > 0 && isSupportedClipboardMime(webp.type)) {
            return { blob: webp, mime: webp.type, compressed: webp.type === 'image/webp' };
          }
        }
      } catch {
        /* fall through to HTMLCanvasElement */
      }
    }

    // Fallback to standard HTMLCanvasElement (WebP then PNG) so JPEG/BMP/oversized images still work.
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0, size.width, size.height);
        const webp = await canvasToBlob(canvas, 'image/webp', WEBP_QUALITY);
        if (webp && webp.size > 0 && webp.type === 'image/webp') {
          return { blob: webp, mime: 'image/webp', compressed: true };
        }
        const png = await canvasToBlob(canvas, 'image/png');
        if (png && png.size > 0) {
          return { blob: png, mime: 'image/png', compressed: false };
        }
      }
    }
  } catch {
    /* fall through to raw blob */
  } finally {
    bitmap?.close();
  }
  return { blob, mime: blob.type || 'application/octet-stream', compressed: false };
}
