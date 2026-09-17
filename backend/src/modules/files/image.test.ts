import { describe, expect, it } from 'vitest';
import { toClipboardPng } from './image.js';

describe('toClipboardPng', () => {
  it('rejects unsupported bytes', async () => {
    await expect(toClipboardPng(Buffer.from('not-an-image'))).rejects.toThrow(/Unsupported|Invalid/);
  });

  it('passes a small PNG through', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const out = await toClipboardPng(png);
    expect(out.equals(png)).toBe(true);
  });
});
