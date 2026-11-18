import { gpuProfileById } from './gpuProfiles.js';

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
};

function profile(cores: CpuCores, memory: DeviceMemoryGb): HardwareProfile {
  return { id: hardwareProfileId(cores, memory), cores, memory };
}

export const HARDWARE_PROFILES: readonly HardwareProfile[] = [
  profile(2, 2),
  profile(2, 4),
  profile(2, 8),
  profile(4, 4),
  profile(4, 8),
  profile(4, 16),
  profile(6, 8),
  profile(6, 16),
  profile(8, 8),
  profile(8, 16),
  profile(8, 32),
  profile(10, 16),
  profile(12, 16),
  profile(12, 32),
  profile(16, 16),
  profile(16, 32),
  profile(20, 32),
  profile(24, 32),
  profile(32, 32),
];

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

type Tier = 'entry' | 'mid' | 'upper' | 'high' | 'top';

/** CPU threads / RAM that ship next to each GPU class, weighted by how often they do. */
const TIER_HARDWARE: Record<Tier, Array<[CpuCores, DeviceMemoryGb, number]>> = {
  entry: [
    [4, 8, 20],
    [4, 16, 10],
    [6, 8, 15],
    [6, 16, 25],
    [8, 16, 15],
    [12, 16, 15],
  ],
  mid: [
    [6, 16, 25],
    [8, 16, 15],
    [12, 16, 30],
    [12, 32, 10],
    [16, 16, 10],
    [16, 32, 10],
  ],
  upper: [
    [8, 16, 10],
    [12, 16, 25],
    [12, 32, 15],
    [16, 16, 15],
    [16, 32, 25],
    [20, 32, 10],
  ],
  high: [
    [12, 32, 15],
    [16, 16, 5],
    [16, 32, 35],
    [20, 32, 20],
    [24, 32, 20],
    [32, 32, 5],
  ],
  top: [
    [16, 32, 25],
    [20, 32, 20],
    [24, 32, 35],
    [32, 32, 20],
  ],
};

/** Spoofable GPUs: class and rough share among desktop Chrome users. */
const GPU_WEIGHTS: Record<string, [Tier, number]> = {
  'gtx-1050-ti': ['entry', 15],
  'gtx-1060': ['entry', 25],
  'gtx-1070': ['mid', 10],
  'gtx-1070-ti': ['mid', 3],
  'gtx-1080': ['upper', 6],
  'gtx-1080-ti': ['upper', 5],
  'gtx-1650': ['entry', 35],
  'gtx-1660': ['mid', 10],
  'gtx-1660-super': ['mid', 15],
  'gtx-1660-ti': ['mid', 8],
  'rtx-2060': ['mid', 30],
  'rtx-2060-super': ['mid', 10],
  'rtx-2070': ['upper', 8],
  'rtx-2070-super': ['upper', 10],
  'rtx-2080': ['upper', 4],
  'rtx-2080-super': ['upper', 4],
  'rtx-2080-ti': ['high', 4],
  'rtx-3050': ['entry', 20],
  'rtx-3060': ['mid', 50],
  'rtx-3060-ti': ['upper', 30],
  'rtx-3070': ['upper', 25],
  'rtx-3070-ti': ['upper', 12],
  'rtx-3080': ['high', 15],
  'rtx-3080-ti': ['high', 6],
  'rtx-3090': ['high', 4],
  'rtx-3090-ti': ['high', 1],
  'rtx-4060': ['upper', 40],
  'rtx-4060-ti': ['upper', 25],
  'rtx-4070': ['high', 22],
  'rtx-4070-super': ['high', 15],
  'rtx-4070-ti': ['high', 8],
  'rtx-4070-ti-super': ['high', 8],
  'rtx-4080': ['top', 5],
  'rtx-4080-super': ['top', 6],
  'rtx-4090': ['top', 6],
};

type DeviceCombo = { gpuProfile: string; cores: CpuCores; memory: DeviceMemoryGb; weight: number };

const DEVICE_COMBOS: DeviceCombo[] = Object.entries(GPU_WEIGHTS).flatMap(([gpuProfile, [tier, gpuWeight]]) => {
  const rows = TIER_HARDWARE[tier];
  const total = rows.reduce((sum, [, , w]) => sum + w, 0);
  return rows.map(([cores, memory, w]) => ({ gpuProfile, cores, memory, weight: (gpuWeight * w) / total }));
});

function comboDistance(combo: DeviceCombo, cores?: number, memory?: number) {
  let d = 0;
  if (cores) d += Math.abs(Math.log2(combo.cores) - Math.log2(cores));
  if (memory) d += Math.abs(Math.log2(combo.memory) - Math.log2(memory));
  return d;
}

/**
 * Fill in the GPU profile, CPU threads and device memory a caller left unset
 * with a weighted pick of realistic desktop combos, consistent with the fields
 * that are set. `roll` is a number in [0, 1).
 */
export function pickDeviceProfile(
  fixed: { gpuProfile?: string; cores?: CpuCores; memory?: DeviceMemoryGb },
  roll: number,
): { gpuProfile: string; cores: CpuCores; memory: DeviceMemoryGb } {
  const spoofed = fixed.gpuProfile && GPU_WEIGHTS[fixed.gpuProfile] ? fixed.gpuProfile : '';
  let pool = DEVICE_COMBOS;
  if (spoofed) {
    pool = pool.filter((c) => c.gpuProfile === spoofed);
  }
  if (fixed.cores || fixed.memory) {
    const best = Math.min(...pool.map((c) => comboDistance(c, fixed.cores, fixed.memory)));
    pool = pool.filter((c) => comboDistance(c, fixed.cores, fixed.memory) === best);
  }
  const total = pool.reduce((sum, c) => sum + c.weight, 0);
  let left = Math.min(Math.max(roll, 0), 0.999999) * total;
  let picked = pool[pool.length - 1];
  for (const combo of pool) {
    left -= combo.weight;
    if (left < 0) {
      picked = combo;
      break;
    }
  }
  return {
    gpuProfile: fixed.gpuProfile && gpuProfileById(fixed.gpuProfile) ? fixed.gpuProfile : picked.gpuProfile,
    cores: fixed.cores ?? picked.cores,
    memory: fixed.memory ?? picked.memory,
  };
}
