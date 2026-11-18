import { DEFAULT_CHROME_LANGUAGE, isValidChromeLanguage } from './languages.js';
import { DEFAULT_TIMEZONE } from './timezones.js';

/** Timezone / Chrome language value that follows the proxy exit country at launch. */
export const AUTO_LOCALE = 'auto';

export function isAutoLocale(value: unknown) {
  return String(value ?? '').trim().toLowerCase() === AUTO_LOCALE;
}

/** ISO country → main timezone and the Chrome UI language most installs there use. */
const COUNTRIES: Record<string, [timezone: string, language: string]> = {
  AE: ['Asia/Dubai', 'ar'],
  AR: ['America/Argentina/Buenos_Aires', 'es-AR'],
  AT: ['Europe/Vienna', 'de-AT'],
  AU: ['Australia/Sydney', 'en-AU'],
  BD: ['Asia/Dhaka', 'bn'],
  BE: ['Europe/Brussels', 'nl-BE'],
  BG: ['Europe/Sofia', 'bg'],
  BR: ['America/Sao_Paulo', 'pt-BR'],
  CA: ['America/Toronto', 'en-CA'],
  CH: ['Europe/Zurich', 'de-CH'],
  CL: ['America/Santiago', 'es'],
  CN: ['Asia/Shanghai', 'zh-CN'],
  CO: ['America/Bogota', 'es'],
  CZ: ['Europe/Prague', 'cs'],
  DE: ['Europe/Berlin', 'de'],
  DK: ['Europe/Copenhagen', 'da'],
  EE: ['Europe/Tallinn', 'et'],
  EG: ['Africa/Cairo', 'ar'],
  ES: ['Europe/Madrid', 'es'],
  FI: ['Europe/Helsinki', 'fi'],
  FR: ['Europe/Paris', 'fr'],
  GB: ['Europe/London', 'en-GB'],
  GR: ['Europe/Athens', 'el'],
  HK: ['Asia/Hong_Kong', 'zh-HK'],
  HR: ['Europe/Zagreb', 'hr'],
  HU: ['Europe/Budapest', 'hu'],
  ID: ['Asia/Jakarta', 'id'],
  IE: ['Europe/Dublin', 'en-GB'],
  IL: ['Asia/Jerusalem', 'he'],
  IN: ['Asia/Kolkata', 'en-IN'],
  IT: ['Europe/Rome', 'it'],
  JP: ['Asia/Tokyo', 'ja'],
  KE: ['Africa/Nairobi', 'en-GB'],
  KH: ['Asia/Phnom_Penh', 'km'],
  KR: ['Asia/Seoul', 'ko'],
  KZ: ['Asia/Almaty', 'ru'],
  LT: ['Europe/Vilnius', 'lt'],
  LU: ['Europe/Luxembourg', 'fr'],
  LV: ['Europe/Riga', 'lv'],
  MO: ['Asia/Macau', 'zh-HK'],
  MX: ['America/Mexico_City', 'es-MX'],
  MY: ['Asia/Kuala_Lumpur', 'en-GB'],
  NG: ['Africa/Lagos', 'en-GB'],
  NL: ['Europe/Amsterdam', 'nl'],
  NO: ['Europe/Oslo', 'nb'],
  NZ: ['Pacific/Auckland', 'en-GB'],
  PE: ['America/Lima', 'es'],
  PH: ['Asia/Manila', 'en-US'],
  PK: ['Asia/Karachi', 'en-GB'],
  PL: ['Europe/Warsaw', 'pl'],
  PT: ['Europe/Lisbon', 'pt-PT'],
  RO: ['Europe/Bucharest', 'ro'],
  RS: ['Europe/Belgrade', 'sr'],
  RU: ['Europe/Moscow', 'ru'],
  SA: ['Asia/Riyadh', 'ar'],
  SE: ['Europe/Stockholm', 'sv'],
  SG: ['Asia/Singapore', 'en-GB'],
  SI: ['Europe/Ljubljana', 'sl'],
  SK: ['Europe/Bratislava', 'sk'],
  TH: ['Asia/Bangkok', 'th'],
  TR: ['Europe/Istanbul', 'tr'],
  TW: ['Asia/Taipei', 'zh-TW'],
  UA: ['Europe/Kyiv', 'uk'],
  US: ['America/New_York', 'en-US'],
  VN: ['Asia/Ho_Chi_Minh', 'vi'],
  ZA: ['Africa/Johannesburg', 'en-GB'],
};

/** Cloudflare colos (IATA codes) away from the main timezone of a country that spans several. */
const COLO_TIMEZONES: Record<string, Record<string, string>> = {
  US: {
    ANC: 'America/Anchorage',
    HNL: 'Pacific/Honolulu',
    ...Object.fromEntries(
      ['LAX', 'SJC', 'SFO', 'SEA', 'PDX', 'LAS', 'SMF', 'SAN'].map((c) => [c, 'America/Los_Angeles']),
    ),
    PHX: 'America/Phoenix',
    ...Object.fromEntries(['DEN', 'SLC', 'ABQ'].map((c) => [c, 'America/Denver'])),
    ...Object.fromEntries(
      ['ORD', 'DFW', 'IAH', 'AUS', 'SAT', 'MSP', 'MCI', 'STL', 'MEM', 'OMA', 'BNA'].map((c) => [
        c,
        'America/Chicago',
      ]),
    ),
  },
  CA: {
    YVR: 'America/Vancouver',
    YYC: 'America/Edmonton',
    YEG: 'America/Edmonton',
    YWG: 'America/Winnipeg',
    YXE: 'America/Regina',
    YHZ: 'America/Halifax',
  },
  AU: {
    PER: 'Australia/Perth',
    ADL: 'Australia/Adelaide',
    BNE: 'Australia/Brisbane',
    MEL: 'Australia/Melbourne',
  },
  BR: {
    MAO: 'America/Manaus',
    FOR: 'America/Fortaleza',
    REC: 'America/Recife',
    BEL: 'America/Belem',
  },
  RU: {
    SVX: 'Asia/Yekaterinburg',
    OVB: 'Asia/Novosibirsk',
    KJA: 'Asia/Krasnoyarsk',
    VVO: 'Asia/Vladivostok',
    KHV: 'Asia/Vladivostok',
  },
  MX: { TIJ: 'America/Tijuana' },
  ID: { DPS: 'Asia/Makassar' },
};

/**
 * Timezone and Chrome language for a proxy exit (Cloudflare trace `loc` and
 * `colo`), or null for a country without an entry.
 */
export function countryLocale(
  loc: string | null | undefined,
  colo?: string | null,
): { timezone: string; language: string } | null {
  const country = String(loc || '').trim().toUpperCase();
  const row = COUNTRIES[country];
  if (!row) return null;
  const [timezone, language] = row;
  return {
    timezone: COLO_TIMEZONES[country]?.[String(colo || '').trim().toUpperCase()] || timezone,
    language: isValidChromeLanguage(language) ? language : DEFAULT_CHROME_LANGUAGE,
  };
}

/**
 * The timezone and language a session runs with: explicit values as set, `auto`
 * from the proxy exit when it has been tested, else the defaults.
 */
export function resolveSessionLocale(
  session: { timezone?: string | null; chromeLanguage?: string | null },
  exit?: { ok?: boolean; loc?: string | null; colo?: string | null } | null,
): { timezone: string; language: string } {
  const derived = exit?.ok ? countryLocale(exit.loc, exit.colo) : null;
  const tz = String(session.timezone || '').trim();
  const lang = String(session.chromeLanguage || '').trim();
  return {
    timezone: !tz || isAutoLocale(tz) ? derived?.timezone || DEFAULT_TIMEZONE : tz,
    language: !lang || isAutoLocale(lang) ? derived?.language || DEFAULT_CHROME_LANGUAGE : lang,
  };
}
