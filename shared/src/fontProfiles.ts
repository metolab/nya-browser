export const FONT_PROFILES = ['native', 'win10', 'win11'] as const;

export type FontProfile = (typeof FONT_PROFILES)[number];

export const DEFAULT_FONT_PROFILE: FontProfile = 'native';

export const FONT_PROFILE_LABELS: Record<FontProfile, string> = {
  native: '真实字体（不伪装）',
  win10: 'Windows 10 字体库',
  win11: 'Windows 11 字体库',
};

/** Always-on Win10 desktop families from public enumerate dumps. */
export const WIN10_CORE_FONTS = [
  'Arial',
  'Arial Black',
  'Calibri',
  'Cambria',
  'Cambria Math',
  'Candara',
  'Comic Sans MS',
  'Consolas',
  'Constantia',
  'Corbel',
  'Courier New',
  'Ebrima',
  'Franklin Gothic Medium',
  'Gabriola',
  'Gadugi',
  'Georgia',
  'Impact',
  'Javanese Text',
  'Leelawadee UI',
  'Lucida Console',
  'Lucida Sans Unicode',
  'Malgun Gothic',
  'Microsoft Himalaya',
  'Microsoft JhengHei',
  'Microsoft JhengHei UI',
  'Microsoft New Tai Lue',
  'Microsoft PhagsPa',
  'Microsoft Sans Serif',
  'Microsoft Tai Le',
  'Microsoft YaHei',
  'Microsoft YaHei UI',
  'Microsoft Yi Baiti',
  'MingLiU-ExtB',
  'Mongolian Baiti',
  'MS Gothic',
  'MS PGothic',
  'MS UI Gothic',
  'MV Boli',
  'Myanmar Text',
  'Nirmala UI',
  'Palatino Linotype',
  'Segoe MDL2 Assets',
  'Segoe Print',
  'Segoe Script',
  'Segoe UI',
  'Segoe UI Emoji',
  'Segoe UI Historic',
  'Segoe UI Symbol',
  'SimSun',
  'NSimSun',
  'Sitka Banner',
  'Sitka Display',
  'Sitka Heading',
  'Sitka Small',
  'Sitka Subheading',
  'Sitka Text',
  'Sylfaen',
  'Symbol',
  'Tahoma',
  'Times',
  'Times New Roman',
  'Courier',
  'Trebuchet MS',
  'Verdana',
  'Webdings',
  'Wingdings',
  'Yu Gothic',
  'Yu Gothic UI',
] as const;

/** Seed-stable extras so two sessions are not identical. */
export const WIN10_OPTIONAL_FONTS = [
  'Arial Narrow',
  'Calibri Light',
  'Ink Free',
  'HoloLens MDL2 Assets',
  'Marlett',
  'SimSun-ExtB',
  'Microsoft Uighur',
  'Urdu Typesetting',
  'Segoe UI Light',
  'Segoe UI Semibold',
  'Yu Gothic Light',
  'Malgun Gothic Semilight',
] as const;

export const WIN11_EXTRA_FONTS = [
  'Aptos',
  'Aptos Display',
  'Aptos Narrow',
  'Cascadia Code',
  'Cascadia Mono',
  'Segoe Fluent Icons',
  'Segoe UI Variable',
] as const;

export function isFontProfile(value: unknown): value is FontProfile {
  return FONT_PROFILES.includes(value as FontProfile);
}

export function coerceFontProfile(input: unknown): FontProfile {
  const raw = String(input || '')
    .trim()
    .toLowerCase();
  return isFontProfile(raw) ? raw : DEFAULT_FONT_PROFILE;
}

function seedWord(seed: string, offset: number) {
  const hex = String(seed || '')
    .replace(/[^0-9a-f]/gi, '')
    .padEnd(offset + 8, '0');
  const n = Number.parseInt(hex.slice(offset, offset + 8), 16);
  return Number.isFinite(n) ? n : offset + 1;
}

function pickOptional(seed: string, extras: readonly string[]) {
  const mask = seedWord(seed, 24);
  return extras.filter((_, i) => ((mask >>> (i % 16)) & 1) === 1);
}

export function fontsFromProfile(profile: FontProfile, seed: string): string[] {
  if (profile === 'native') return [];
  const out = [...WIN10_CORE_FONTS, ...pickOptional(seed, WIN10_OPTIONAL_FONTS)];
  if (profile === 'win11') {
    out.push(...WIN11_EXTRA_FONTS);
  }
  return out;
}

export function fontSwitchValue(profile: FontProfile, seed: string) {
  return fontsFromProfile(profile, seed).join('|');
}
