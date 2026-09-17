import { describe, expect, it, vi } from 'vitest';
import { hasUserActivation, randomId } from './files';

describe('randomId', () => {
  it('uses crypto.randomUUID when the context is secure', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '11111111-2222-4333-8444-555555555555' });
    expect(randomId()).toBe('11111111-2222-4333-8444-555555555555');
    vi.unstubAllGlobals();
  });

  it('falls back when randomUUID is missing (http://IP)', () => {
    const bytes = new Uint8Array(16).fill(0);
    vi.stubGlobal('crypto', {
      getRandomValues: (out: Uint8Array) => {
        out.set(bytes);
        return out;
      },
    });
    const id = randomId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    vi.unstubAllGlobals();
  });
});

describe('hasUserActivation', () => {
  it('is true when the browser does not expose userActivation', () => {
    vi.stubGlobal('navigator', {});
    expect(hasUserActivation()).toBe(true);
    vi.unstubAllGlobals();
  });

  it('follows navigator.userActivation.isActive', () => {
    vi.stubGlobal('navigator', { userActivation: { isActive: false } });
    expect(hasUserActivation()).toBe(false);
    vi.stubGlobal('navigator', { userActivation: { isActive: true } });
    expect(hasUserActivation()).toBe(true);
    vi.unstubAllGlobals();
  });
});
