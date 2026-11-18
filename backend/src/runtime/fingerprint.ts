import crypto from 'crypto';
import {
  coerceGpuProfile,
  coerceOs,
  coerceWindowsRelease,
  coerceWebrtcMode,
  COMMON_HARDWARE_PROFILES,
  DEFAULT_OS,
  DEFAULT_WEBRTC_MODE,
  isCpuCores,
  isDeviceMemory,
  normalizeGeo,
  type FingerprintConfig,
  type GeoConfig,
  type OsType,
  type WebrtcMode,
  type WindowsRelease,
} from '@nya/shared';

function seedToUint32(seed: string) {
  const buf = Buffer.from(String(seed || ''), 'hex');
  if (buf.length >= 4) return buf.readUInt32BE(0);
  return 0;
}

type FingerprintExtras = {
  gpuProfile?: unknown;
  webrtcMode?: unknown;
  geo?: unknown;
  os?: unknown;
  windowsRelease?: unknown;
  hardwareConcurrency?: unknown;
  deviceMemory?: unknown;
};

export function fingerprintFromSeed(seed: string, extras?: FingerprintExtras): FingerprintConfig {
  const n = seedToUint32(seed);
  const normalizedSeed = String(seed).toLowerCase();
  const hardware = COMMON_HARDWARE_PROFILES[n % COMMON_HARDWARE_PROFILES.length];
  return {
    seed: normalizedSeed,
    hardwareConcurrency: isCpuCores(extras?.hardwareConcurrency)
      ? extras.hardwareConcurrency
      : hardware.cores,
    deviceMemory: isDeviceMemory(extras?.deviceMemory) ? extras.deviceMemory : hardware.memory,
    gpuProfile: coerceGpuProfile(extras?.gpuProfile),
    webrtcMode: coerceWebrtcMode(extras?.webrtcMode),
    geo: normalizeGeo(extras?.geo),
    os: coerceOs(extras?.os),
    windowsRelease: coerceWindowsRelease(extras?.windowsRelease),
  };
}

function randomSeed() {
  return crypto.randomBytes(32).toString('hex');
}

/** A new session: fields the caller leaves out take the new-session defaults. */
export function createFingerprint(gpuProfile?: unknown, extras?: FingerprintExtras): FingerprintConfig {
  return fingerprintFromSeed(randomSeed(), {
    ...extras,
    gpuProfile: gpuProfile ?? extras?.gpuProfile,
    webrtcMode: extras?.webrtcMode ?? DEFAULT_WEBRTC_MODE,
    os: extras?.os ?? DEFAULT_OS,
  });
}

export function fingerprintsEqual(a: FingerprintConfig, b: FingerprintConfig) {
  return (
    a.seed === b.seed &&
    a.hardwareConcurrency === b.hardwareConcurrency &&
    a.deviceMemory === b.deviceMemory &&
    a.gpuProfile === b.gpuProfile &&
    a.webrtcMode === b.webrtcMode &&
    a.os === b.os &&
    a.windowsRelease === b.windowsRelease &&
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
    a.os !== b.os ||
    a.windowsRelease !== b.windowsRelease ||
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
  return fingerprintFromSeed(randomSeed(), obj);
}

export function mergeFingerprintPatch(
  current: FingerprintConfig,
  patch: {
    gpuProfile?: unknown;
    webrtcMode?: WebrtcMode;
    geo?: Partial<GeoConfig>;
    os?: OsType;
    windowsRelease?: WindowsRelease;
    hardwareConcurrency?: number;
    deviceMemory?: number;
  },
): FingerprintConfig {
  return normalizeFingerprint({
    ...current,
    gpuProfile: patch.gpuProfile ?? current.gpuProfile,
    webrtcMode: patch.webrtcMode ?? current.webrtcMode,
    geo: { ...current.geo, ...(patch.geo || {}) },
    os: patch.os ?? current.os,
    windowsRelease: patch.windowsRelease ?? current.windowsRelease,
    hardwareConcurrency: patch.hardwareConcurrency ?? current.hardwareConcurrency,
    deviceMemory: patch.deviceMemory ?? current.deviceMemory,
  });
}

export { DEFAULT_WEBRTC_MODE };
