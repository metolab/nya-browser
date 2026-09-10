export const DEFAULT_GPU_PROFILE = 'native';

export type GpuArchitecture = 'pascal' | 'turing' | 'ampere' | 'ada';

export type GpuProfile = {
  id: string;
  angleName: string;
  deviceId: string;
  architecture: GpuArchitecture | '';
  vendor: 'nvidia' | '';
  description: string;
  label: string;
  group: string;
};

function row(
  id: string,
  angleName: string,
  deviceId: string,
  architecture: GpuArchitecture,
  label: string,
  group: string,
): GpuProfile {
  return {
    id,
    angleName,
    deviceId,
    architecture,
    vendor: 'nvidia',
    description: `NVIDIA ${angleName}`,
    label,
    group,
  };
}

const ROWS: GpuProfile[] = [
  {
    id: 'native',
    angleName: '',
    deviceId: '',
    architecture: '',
    vendor: '',
    description: '',
    label: '真实显卡（不伪装）',
    group: '常用',
  },

  row('gtx-1050-ti', 'GeForce GTX 1050 Ti', '1C82', 'pascal', 'GTX 1050 Ti', 'GTX 10'),
  row('gtx-1060', 'GeForce GTX 1060', '1C03', 'pascal', 'GTX 1060', 'GTX 10'),
  row('gtx-1070', 'GeForce GTX 1070', '1B81', 'pascal', 'GTX 1070', 'GTX 10'),
  row('gtx-1070-ti', 'GeForce GTX 1070 Ti', '1B82', 'pascal', 'GTX 1070 Ti', 'GTX 10'),
  row('gtx-1080', 'GeForce GTX 1080', '1B80', 'pascal', 'GTX 1080', 'GTX 10'),
  row('gtx-1080-ti', 'GeForce GTX 1080 Ti', '1B06', 'pascal', 'GTX 1080 Ti', 'GTX 10'),

  row('gtx-1650', 'GeForce GTX 1650', '1F82', 'turing', 'GTX 1650', 'GTX 16'),
  row('gtx-1660', 'GeForce GTX 1660', '2184', 'turing', 'GTX 1660', 'GTX 16'),
  row('gtx-1660-super', 'GeForce GTX 1660 SUPER', '21C4', 'turing', 'GTX 1660 Super', 'GTX 16'),
  row('gtx-1660-ti', 'GeForce GTX 1660 Ti', '2182', 'turing', 'GTX 1660 Ti', 'GTX 16'),

  row('rtx-2060', 'GeForce RTX 2060', '1F08', 'turing', 'RTX 2060', 'RTX 20'),
  row('rtx-2060-super', 'GeForce RTX 2060 SUPER', '1F06', 'turing', 'RTX 2060 Super', 'RTX 20'),
  row('rtx-2070', 'GeForce RTX 2070', '1F02', 'turing', 'RTX 2070', 'RTX 20'),
  row('rtx-2070-super', 'GeForce RTX 2070 SUPER', '1E84', 'turing', 'RTX 2070 Super', 'RTX 20'),
  row('rtx-2080', 'GeForce RTX 2080', '1E87', 'turing', 'RTX 2080', 'RTX 20'),
  row('rtx-2080-super', 'GeForce RTX 2080 SUPER', '1E81', 'turing', 'RTX 2080 Super', 'RTX 20'),
  row('rtx-2080-ti', 'GeForce RTX 2080 Ti', '1E07', 'turing', 'RTX 2080 Ti', 'RTX 20'),

  row('rtx-3050', 'GeForce RTX 3050', '2507', 'ampere', 'RTX 3050', 'RTX 30'),
  row('rtx-3060', 'GeForce RTX 3060', '2503', 'ampere', 'RTX 3060', 'RTX 30'),
  row('rtx-3060-ti', 'GeForce RTX 3060 Ti', '2486', 'ampere', 'RTX 3060 Ti', 'RTX 30'),
  row('rtx-3070', 'GeForce RTX 3070', '2484', 'ampere', 'RTX 3070', 'RTX 30'),
  row('rtx-3070-ti', 'GeForce RTX 3070 Ti', '2482', 'ampere', 'RTX 3070 Ti', 'RTX 30'),
  row('rtx-3080', 'GeForce RTX 3080', '2206', 'ampere', 'RTX 3080', 'RTX 30'),
  row('rtx-3080-ti', 'GeForce RTX 3080 Ti', '2208', 'ampere', 'RTX 3080 Ti', 'RTX 30'),
  row('rtx-3090', 'GeForce RTX 3090', '2204', 'ampere', 'RTX 3090', 'RTX 30'),
  row('rtx-3090-ti', 'GeForce RTX 3090 Ti', '2203', 'ampere', 'RTX 3090 Ti', 'RTX 30'),

  row('rtx-4060', 'GeForce RTX 4060', '2882', 'ada', 'RTX 4060', 'RTX 40'),
  row('rtx-4060-ti', 'GeForce RTX 4060 Ti', '2803', 'ada', 'RTX 4060 Ti', 'RTX 40'),
  row('rtx-4070', 'GeForce RTX 4070', '2786', 'ada', 'RTX 4070', 'RTX 40'),
  row('rtx-4070-super', 'GeForce RTX 4070 SUPER', '2783', 'ada', 'RTX 4070 Super', 'RTX 40'),
  row('rtx-4070-ti', 'GeForce RTX 4070 Ti', '2782', 'ada', 'RTX 4070 Ti', 'RTX 40'),
  row('rtx-4070-ti-super', 'GeForce RTX 4070 Ti SUPER', '2705', 'ada', 'RTX 4070 Ti Super', 'RTX 40'),
  row('rtx-4080', 'GeForce RTX 4080', '2704', 'ada', 'RTX 4080', 'RTX 40'),
  row('rtx-4080-super', 'GeForce RTX 4080 SUPER', '2702', 'ada', 'RTX 4080 Super', 'RTX 40'),
  row('rtx-4090', 'GeForce RTX 4090', '2684', 'ada', 'RTX 4090', 'RTX 40'),
];

const PINNED = ['native', 'gtx-1080-ti', 'gtx-1070', 'rtx-2080', 'rtx-3070', 'rtx-4070'] as const;

const BY_ID = new Map(ROWS.map((row) => [row.id, row]));

export const GPU_PROFILES: GpuProfile[] = (() => {
  const seen = new Set<string>();
  const out: GpuProfile[] = [];
  for (const id of PINNED) {
    const row = BY_ID.get(id);
    if (row) {
      out.push({ ...row, group: '常用' });
      seen.add(id);
    }
  }
  for (const row of ROWS) {
    if (!seen.has(row.id)) out.push(row);
  }
  return out;
})();

export const GPU_PROFILE_IDS = GPU_PROFILES.map((row) => row.id) as [string, ...string[]];

export function gpuProfileById(id: string): GpuProfile | undefined {
  return BY_ID.get(id);
}

export function isValidGpuProfile(id: string) {
  return BY_ID.has(id);
}

export function gpuProfileLabel(id: string) {
  return BY_ID.get(id)?.label || id;
}

export function gpuProfileOptionLabel(id: string) {
  const row = BY_ID.get(id);
  if (!row) return id;
  if (!row.angleName) return row.label;
  return `${row.label} · ${row.angleName}`;
}

export function coerceGpuProfile(input: unknown): string {
  const raw = String(input || '')
    .trim()
    .toLowerCase();
  return isValidGpuProfile(raw) ? raw : DEFAULT_GPU_PROFILE;
}

export function normalizeGpuProfile(input: unknown): string {
  const raw = String(input || '')
    .trim()
    .toLowerCase();
  if (!raw) return DEFAULT_GPU_PROFILE;
  if (!isValidGpuProfile(raw)) throw new Error('Invalid GPU profile');
  return raw;
}
