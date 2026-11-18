import crypto from 'crypto';
import {
  coerceGpuProfile,
  coerceOs,
  coerceWindowsRelease,
  coerceWebrtcMode,
  DEFAULT_OS,
  DEFAULT_WEBRTC_MODE,
  isCpuCores,
  isDeviceMemory,
  isValidGpuProfile,
  normalizeGeo,
  pickDeviceProfile,
  type FingerprintConfig,
  type GeoConfig,
  type OsType,
  type WebrtcMode,
  type WindowsRelease,
} from '@nya/shared';

/** A stable number in [0, 1) from the fingerprint seed. */
function seedRoll(seed: string) {
  const buf = Buffer.from(String(seed || ''), 'hex');
  if (buf.length >= 4) return buf.readUInt32BE(0) / 2 ** 32;
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

/** GPU profile, CPU threads and memory; unset ones get a weighted realistic pick from the seed. */
function seedDevice(seed: string, extras: FingerprintExtras | undefined, randomGpu: boolean) {
  const gpu = String(extras?.gpuProfile ?? '').trim().toLowerCase();
  return pickDeviceProfile(
    {
      gpuProfile: isValidGpuProfile(gpu) ? gpu : randomGpu ? undefined : coerceGpuProfile(gpu),
      cores: isCpuCores(extras?.hardwareConcurrency) ? extras.hardwareConcurrency : undefined,
      memory: isDeviceMemory(extras?.deviceMemory) ? extras.deviceMemory : undefined,
    },
    seedRoll(seed),
  );
}

function buildFingerprint(seed: string, extras: FingerprintExtras | undefined, randomGpu: boolean): FingerprintConfig {
  const device = seedDevice(seed, extras, randomGpu);
  return {
    seed: String(seed).toLowerCase(),
    hardwareConcurrency: device.cores,
    deviceMemory: device.memory,
    gpuProfile: device.gpuProfile,
    webrtcMode: coerceWebrtcMode(extras?.webrtcMode),
    geo: normalizeGeo(extras?.geo),
    os: coerceOs(extras?.os),
    windowsRelease: coerceWindowsRelease(extras?.windowsRelease),
  };
}

/** A stored fingerprint: a missing or unknown GPU profile reads as the real GPU. */
export function fingerprintFromSeed(seed: string, extras?: FingerprintExtras): FingerprintConfig {
  return buildFingerprint(seed, extras, false);
}

function randomSeed() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * A new session: fields the caller leaves out take the new-session defaults;
 * an unset GPU profile, CPU and memory are picked together as a common combo.
 */
export function createFingerprint(gpuProfile?: unknown, extras?: FingerprintExtras): FingerprintConfig {
  return buildFingerprint(
    randomSeed(),
    {
      ...extras,
      gpuProfile: gpuProfile ?? extras?.gpuProfile,
      webrtcMode: extras?.webrtcMode ?? DEFAULT_WEBRTC_MODE,
      os: extras?.os ?? DEFAULT_OS,
    },
    true,
  );
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
