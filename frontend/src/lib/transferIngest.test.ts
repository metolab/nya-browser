import { describe, expect, it } from 'vitest';
import { classifyTransfer, contentFingerprint, isGenericImageFile, splitBySize } from './transferIngest';
import { fitMaxEdge } from './pasteImage';

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

  it('prefers files when a real file is mixed with a bitmap', () => {
    const next = classifyTransfer({
      source: 'clipboard',
      files: [file('doc.txt', 'text/plain'), file('image.png', 'image/png')],
    });
    expect(next.mode).toBe('files');
    expect(next.files.map((item) => item.name)).toEqual(['doc.txt']);
  });

  it('falls back to text', () => {
    expect(classifyTransfer({ source: 'clipboard', files: [], text: ' hi ' }).mode).toBe('text');
  });
});

describe('isGenericImageFile', () => {
  it('rejects old image.png copies from the file manager', () => {
    expect(isGenericImageFile(file('image.png', 'image/png', 20, Date.now() - 60_000))).toBe(false);
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
