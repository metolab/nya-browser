import crypto from 'crypto';
import type { FingerprintConfig } from '@nya/shared';

const CPU_COUNTS = [2, 4, 8, 12];
const DEVICE_MEMORY = [4, 8];

function seedToUint32(seed: string) {
  const buf = Buffer.from(String(seed || ''), 'hex');
  if (buf.length >= 4) return buf.readUInt32BE(0);
  return 0;
}

export function fingerprintFromSeed(seed: string): FingerprintConfig {
  const n = seedToUint32(seed);
  return {
    seed: String(seed).toLowerCase(),
    hardwareConcurrency: CPU_COUNTS[n % CPU_COUNTS.length],
    deviceMemory: DEVICE_MEMORY[(n >>> 8) % DEVICE_MEMORY.length],
  };
}

export function createFingerprint(): FingerprintConfig {
  return fingerprintFromSeed(crypto.randomBytes(32).toString('hex'));
}

export function normalizeFingerprint(input: unknown): FingerprintConfig {
  const seed = input && typeof input === 'object' ? (input as { seed?: string }).seed : null;
  if (typeof seed === 'string' && /^[0-9a-f]{64}$/i.test(seed)) {
    return fingerprintFromSeed(seed);
  }
  return createFingerprint();
}
