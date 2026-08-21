export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

export const TIMEZONES = [
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Taipei',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Bangkok',
  'Asia/Kolkata',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'UTC',
] as const;

export const TIMEZONE_LIST = TIMEZONES as unknown as [string, ...string[]];

export type Timezone = (typeof TIMEZONES)[number];

const ALLOWED = new Set<string>(TIMEZONES);

export function normalizeTimezone(input: unknown): string {
  const raw = String(input || '').trim();
  if (!raw) return DEFAULT_TIMEZONE;
  if (!ALLOWED.has(raw)) {
    throw new Error('Invalid timezone');
  }
  return raw;
}
