import crypto from 'crypto';
import {
  coerceFontProfile,
  coerceGpuProfile,
  coerceWebrtcMode,
  DEFAULT_WEBRTC_MODE,
  normalizeDeviceName,
  normalizeGeo,
  normalizeMediaDevices,
  type FingerprintConfig,
  type FontProfile,
  type GeoConfig,
  type MediaDevicePreset,
  type WebrtcMode,
} from '@nya/shared';

const CPU_COUNTS = [2, 4, 8, 12];
const DEVICE_MEMORY = [4, 8];

function seedToUint32(seed: string) {
  const buf = Buffer.from(String(seed || ''), 'hex');
  if (buf.length >= 4) return buf.readUInt32BE(0);
  return 0;
}

type FingerprintExtras = {
  gpuProfile?: unknown;
  webrtcMode?: unknown;
  deviceName?: unknown;
  mediaDevices?: unknown;
  geo?: unknown;
  fontProfile?: unknown;
  hardwareConcurrency?: unknown;
  deviceMemory?: unknown;
};

export function fingerprintFromSeed(seed: string, extras?: FingerprintExtras): FingerprintConfig {
  const n = seedToUint32(seed);
  const normalizedSeed = String(seed).toLowerCase();
  return {
    seed: normalizedSeed,
    hardwareConcurrency:
      typeof extras?.hardwareConcurrency === 'number' && extras.hardwareConcurrency > 0
        ? extras.hardwareConcurrency
        : CPU_COUNTS[n % CPU_COUNTS.length],
    deviceMemory:
      typeof extras?.deviceMemory === 'number' && extras.deviceMemory > 0
        ? extras.deviceMemory
        : DEVICE_MEMORY[(n >>> 8) % DEVICE_MEMORY.length],
    gpuProfile: coerceGpuProfile(extras?.gpuProfile),
    webrtcMode: coerceWebrtcMode(extras?.webrtcMode),
    deviceName: normalizeDeviceName(extras?.deviceName, normalizedSeed),
    mediaDevices: normalizeMediaDevices(extras?.mediaDevices, normalizedSeed),
    geo: normalizeGeo(extras?.geo),
    fontProfile: coerceFontProfile(extras?.fontProfile),
  };
}

export function createFingerprint(gpuProfile?: unknown, extras?: FingerprintExtras): FingerprintConfig {
  return fingerprintFromSeed(crypto.randomBytes(32).toString('hex'), {
    ...extras,
    gpuProfile: gpuProfile ?? extras?.gpuProfile,
  });
}

export function fingerprintsEqual(a: FingerprintConfig, b: FingerprintConfig) {
  return (
    a.seed === b.seed &&
    a.hardwareConcurrency === b.hardwareConcurrency &&
    a.deviceMemory === b.deviceMemory &&
    a.gpuProfile === b.gpuProfile &&
    a.webrtcMode === b.webrtcMode &&
    a.deviceName === b.deviceName &&
    a.fontProfile === b.fontProfile &&
    a.mediaDevices.audioInput === b.mediaDevices.audioInput &&
    a.mediaDevices.audioOutput === b.mediaDevices.audioOutput &&
    a.mediaDevices.videoInput === b.mediaDevices.videoInput &&
    a.geo.permission === b.geo.permission &&
    a.geo.latitude === b.geo.latitude &&
    a.geo.longitude === b.geo.longitude &&
    a.geo.accuracy === b.geo.accuracy
  );
}

export function fingerprintLaunchChanged(a: FingerprintConfig, b: FingerprintConfig) {
  return (
    a.seed !== b.seed ||
    a.hardwareConcurrency !== b.hardwareConcurrency ||
    a.deviceMemory !== b.deviceMemory ||
    a.gpuProfile !== b.gpuProfile ||
    a.webrtcMode !== b.webrtcMode ||
    a.deviceName !== b.deviceName ||
    a.fontProfile !== b.fontProfile ||
    a.mediaDevices.audioInput !== b.mediaDevices.audioInput ||
    a.mediaDevices.audioOutput !== b.mediaDevices.audioOutput ||
    a.mediaDevices.videoInput !== b.mediaDevices.videoInput ||
    a.geo.permission !== b.geo.permission ||
    a.geo.latitude !== b.geo.latitude ||
    a.geo.longitude !== b.geo.longitude ||
    a.geo.accuracy !== b.geo.accuracy
  );
}

export function normalizeFingerprint(input: unknown): FingerprintConfig {
  const obj =
    input && typeof input === 'object'
      ? (input as FingerprintExtras & { seed?: string })
      : {};
  if (typeof obj.seed === 'string' && /^[0-9a-f]{64}$/i.test(obj.seed)) {
    return fingerprintFromSeed(obj.seed, obj);
  }
  return createFingerprint(obj.gpuProfile, obj);
}

export function mergeFingerprintPatch(
  current: FingerprintConfig,
  patch: {
    gpuProfile?: unknown;
    webrtcMode?: WebrtcMode;
    deviceName?: string;
    mediaDevices?: Partial<MediaDevicePreset>;
    geo?: Partial<GeoConfig>;
    fontProfile?: FontProfile;
  },
): FingerprintConfig {
  return normalizeFingerprint({
    ...current,
    gpuProfile: patch.gpuProfile ?? current.gpuProfile,
    webrtcMode: patch.webrtcMode ?? current.webrtcMode,
    deviceName: patch.deviceName ?? current.deviceName,
    mediaDevices: { ...current.mediaDevices, ...(patch.mediaDevices || {}) },
    geo: { ...current.geo, ...(patch.geo || {}) },
    fontProfile: patch.fontProfile ?? current.fontProfile,
  });
}

export { DEFAULT_WEBRTC_MODE };
