import { describe, expect, it } from 'vitest';
import {
  classifyTransfer,
  contentFingerprint,
  isGenericImageFile,
  isScreenshotName,
  splitBySize,
} from './transferIngest';
import { fitMaxEdge } from './pasteImage';
import { shouldCloseForStall } from './vnc';

function file(name: string, type: string, size = 10, lastModified = Date.now()) {
  const buf = new Uint8Array(size);
  return new File([buf], name, { type, lastModified });
}

describe('classifyTransfer', () => {
  it('treats picker input as files even when the name looks generic', () => {
    const next = classifyTransfer({ source: 'picker', files: [file('image.png', 'image/png')] });
    expect(next.mode).toBe('files');
    expect(next.files).toHaveLength(1);
  });

  it('treats a fresh screenshot blob as an image', () => {
    const next = classifyTransfer({ source: 'clipboard', files: [file('image.png', 'image/png')] });
    expect(next.mode).toBe('image');
    expect(next.images).toHaveLength(1);
  });

  it('keeps explorer files as files', () => {
    const next = classifyTransfer({
      source: 'clipboard',
      files: [file('notes.pdf', 'application/pdf'), file('photo.jpg', 'image/jpeg', 100, Date.now() - 60_000)],
    });
    expect(next.mode).toBe('files');
    expect(next.files.map((item) => item.name)).toEqual(['notes.pdf', 'photo.jpg']);
  });

  it('drops OS companion image.png when mixed with a real file, but keeps named screenshots', () => {
    const now = Date.now();
    const withCompanion = classifyTransfer({
      source: 'clipboard',
      files: [file('doc.txt', 'text/plain', 10, now), file('image.png', 'image/png', 10, now)],
    });
    expect(withCompanion.mode).toBe('files');
    expect(withCompanion.files.map((item) => item.name)).toEqual(['doc.txt']);

    const withNamedScreenshot = classifyTransfer({
      source: 'clipboard',
      files: [
        file('doc.txt', 'text/plain', 10, now),
        file('Screenshot 2026-11-19.png', 'image/png', 10, now),
      ],
    });
    expect(withNamedScreenshot.mode).toBe('files');
    expect(withNamedScreenshot.files.map((item) => item.name)).toEqual([
      'doc.txt',
      'Screenshot 2026-11-19.png',
    ]);
  });

  it('falls back to text', () => {
    expect(classifyTransfer({ source: 'clipboard', files: [], text: ' hi ' }).mode).toBe('text');
  });
});

describe('isGenericImageFile', () => {
  it('rejects old or far-future image.png copies from the file manager', () => {
    expect(isGenericImageFile(file('image.png', 'image/png', 20, Date.now() - 60_000))).toBe(false);
    expect(isGenericImageFile(file('image.png', 'image/png', 20, Date.now() + 60_000))).toBe(false);
  });

  it('treats OS screenshot names as images when fresh', () => {
    const now = Date.now();
    for (const name of [
      'Screenshot 2026-09-21.png',
      'Screen Shot 2026-09-21 at 11.30.00 AM.png',
      'Screenshot from 2026-09-21 11-30-00.png',
      'Screenshot_20260921.png',
      '屏幕截图 2026-09-21.png',
      '截圖 2026-09-21.png',
      'image (2).png',
    ]) {
      expect(classifyTransfer({ source: 'clipboard', files: [file(name, 'image/png', 10, now)] }).mode).toBe(
        'image',
      );
    }
  });

  it('keeps camera and no-space duplicate names as files', () => {
    const now = Date.now();
    expect(isScreenshotName('IMG_1234.jpg')).toBe(false);
    expect(isGenericImageFile(file('IMG_1234.jpg', 'image/jpeg', 10, now))).toBe(false);
    expect(isGenericImageFile(file('image(2).png', 'image/png', 10, now))).toBe(false);
    expect(classifyTransfer({ source: 'picker', files: [file('image.png', 'image/png', 10, now)] }).mode).toBe(
      'files',
    );
  });
});

describe('splitBySize', () => {
  it('skips files over the cap', () => {
    const { kept, skipped } = splitBySize([file('ok.bin', 'application/octet-stream', 10), file('big.bin', 'application/octet-stream', 60)], 50);
    expect(kept).toHaveLength(1);
    expect(skipped[0].name).toBe('big.bin');
  });
});

describe('contentFingerprint', () => {
  it('matches the same bytes even when lastModified changes', async () => {
    const a = file('image.png', 'image/png', 32, 1);
    const b = file('image.png', 'image/png', 32, 99);
    expect(await contentFingerprint(a)).toBe(await contentFingerprint(b));
  });

  it('matches OS screenshot bytes when lastModified changes', async () => {
    const a = file('Screenshot 2026-01-01.png', 'image/png', 32, 1);
    const b = file('Screenshot 2026-01-01.png', 'image/png', 32, 99);
    expect(await contentFingerprint(a)).toBe(await contentFingerprint(b));
    const c = file('屏幕截图.png', 'image/png', 32, 1);
    const d = file('屏幕截图.png', 'image/png', 32, 99);
    expect(await contentFingerprint(c)).toBe(await contentFingerprint(d));
  });

  it('keeps camera filenames mtime-sensitive', async () => {
    const a = file('IMG_1234.jpg', 'image/jpeg', 32, 1);
    const b = file('IMG_1234.jpg', 'image/jpeg', 32, 99);
    expect(await contentFingerprint(a)).not.toBe(await contentFingerprint(b));
  });

  it('changes when the payload changes', async () => {
    const a = new File([new Uint8Array([1, 2, 3, 4])], 'notes.pdf', { type: 'application/pdf', lastModified: 1 });
    const b = new File([new Uint8Array([1, 2, 3, 5])], 'notes.pdf', { type: 'application/pdf', lastModified: 1 });
    expect(await contentFingerprint(a)).not.toBe(await contentFingerprint(b));
  });
});

describe('fitMaxEdge', () => {
  it('does not upscale', () => {
    expect(fitMaxEdge(800, 600, 2000)).toEqual({ width: 800, height: 600, scaled: false });
  });

  it('fits the long edge to 2000', () => {
    expect(fitMaxEdge(4000, 2000, 2000)).toEqual({ width: 2000, height: 1000, scaled: true });
  });
});

describe('shouldCloseForStall', () => {
  it('never disconnects an idle static screen when nothing is queued', () => {
    expect(
      shouldCloseForStall({ flipCount: 5, queued: false, idleMs: 60_000, unstickAt: 0, now: 70_000 }),
    ).toBe('none');
  });

  it('closes if no first frame arrives within timeout', () => {
    expect(
      shouldCloseForStall({ flipCount: 0, queued: false, idleMs: 13_000, unstickAt: 0, now: 13_000 }),
    ).toBe('close');
  });

  it('unsticks first when render queue stalls, then closes even after queue is drained if no flip arrives', () => {
    expect(
      shouldCloseForStall({ flipCount: 3, queued: true, idleMs: 1_500, unstickAt: 0, now: 5_000 }),
    ).toBe('unstick');
    expect(
      shouldCloseForStall({ flipCount: 3, queued: false, idleMs: 7_000, unstickAt: 5_000, now: 11_000 }),
    ).toBe('close');
  });
});
