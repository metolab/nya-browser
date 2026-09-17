import { describe, expect, it } from 'vitest';
import { chromeTimeToIso } from './history.js';

describe('chrome download timestamps', () => {
  it('converts Chrome epoch microseconds', () => {
    const chrome = (Date.UTC(2026, 0, 1) + 11644473600000) * 1000;
    expect(chromeTimeToIso(chrome).startsWith('2026-01-01')).toBe(true);
  });

  it('treats empty values as epoch', () => {
    expect(chromeTimeToIso(0)).toBe(new Date(0).toISOString());
  });
});
