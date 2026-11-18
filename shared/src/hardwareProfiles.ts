/** Logical processor counts seen on real desktops (navigator.hardwareConcurrency). */
export const CPU_CORE_OPTIONS = [2, 4, 6, 8, 10, 12, 16, 20, 24, 32] as const;

/**
 * Desktop Chromium rounds RAM to a power of two and clamps it to 2..32 GB
 * (navigator.deviceMemory and the Device-Memory client hint).
 */
export const DEVICE_MEMORY_OPTIONS = [2, 4, 8, 16, 32] as const;

export type CpuCores = (typeof CPU_CORE_OPTIONS)[number];
export type DeviceMemoryGb = (typeof DEVICE_MEMORY_OPTIONS)[number];

export type HardwareProfile = {
  id: string;
  cores: CpuCores;
  memory: DeviceMemoryGb;
  /** Picked at random for new fingerprints when the caller leaves hardware unset. */
  common: boolean;
};

function profile(cores: CpuCores, memory: DeviceMemoryGb, common = false): HardwareProfile {
  return { id: hardwareProfileId(cores, memory), cores, memory, common };
}

export const HARDWARE_PROFILES: readonly HardwareProfile[] = [
  profile(2, 2),
  profile(2, 4),
  profile(2, 8),
  profile(4, 4),
  profile(4, 8, true),
  profile(4, 16),
  profile(6, 8),
  profile(6, 16, true),
  profile(8, 8, true),
  profile(8, 16, true),
  profile(8, 32),
  profile(10, 16),
  profile(12, 16, true),
  profile(12, 32),
  profile(16, 16, true),
  profile(16, 32, true),
  profile(20, 32),
  profile(24, 32),
  profile(32, 32),
];

export const COMMON_HARDWARE_PROFILES = HARDWARE_PROFILES.filter((p) => p.common);

export function hardwareProfileId(cores: number, memory: number) {
  return `${cores}c${memory}g`;
}

export function hardwareProfileLabel(cores: number, memory: number) {
  return `${cores}C${memory}G · ${cores} 核 / ${memory} GB`;
}

/** Select options for HARDWARE_PROFILES, plus `currentId` when it is legal but not a preset. */
export function hardwareProfileOptions(currentId?: string) {
  const rows: Array<{ cores: number; memory: number }> = [...HARDWARE_PROFILES];
  const current = currentId ? parseHardwareProfileId(currentId) : null;
  if (current && !HARDWARE_PROFILES.some((p) => p.id === currentId)) rows.push(current);
  return rows
    .sort((a, b) => a.cores - b.cores || a.memory - b.memory)
    .map((p) => ({ value: hardwareProfileId(p.cores, p.memory), label: hardwareProfileLabel(p.cores, p.memory) }));
}

export function parseHardwareProfileId(id: string): { cores: CpuCores; memory: DeviceMemoryGb } | null {
  const m = /^(\d+)c(\d+)g$/.exec(String(id || ''));
  if (!m) return null;
  const cores = Number(m[1]);
  const memory = Number(m[2]);
  if (!isCpuCores(cores) || !isDeviceMemory(memory)) return null;
  return { cores, memory };
}

export function isCpuCores(value: unknown): value is CpuCores {
  return typeof value === 'number' && (CPU_CORE_OPTIONS as readonly number[]).includes(value);
}

export function isDeviceMemory(value: unknown): value is DeviceMemoryGb {
  return typeof value === 'number' && (DEVICE_MEMORY_OPTIONS as readonly number[]).includes(value);
}
