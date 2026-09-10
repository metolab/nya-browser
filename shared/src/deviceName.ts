const ALPHANUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function deviceNameFromSeed(seed: string) {
  const hex = String(seed || '')
    .replace(/[^0-9a-f]/gi, '')
    .padEnd(16, '0');
  let out = '';
  for (let i = 0; i < 7; i += 1) {
    const n = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16) || i;
    out += ALPHANUM[n % ALPHANUM.length];
  }
  return `DESKTOP-${out}`;
}

export function normalizeDeviceName(input: unknown, seed: string) {
  const raw = String(input || '')
    .trim()
    .replace(/[^\w.-]/g, '')
    .slice(0, 32);
  if (raw.toLowerCase() === 'native') return '';
  return raw || deviceNameFromSeed(seed);
}
