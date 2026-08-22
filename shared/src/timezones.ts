export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

export const COMMON_TIMEZONES = [
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Taipei',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
] as const;

const TIMEZONE_LABELS: Record<string, string> = {
  UTC: '协调世界时',
  GMT: '格林尼治标准时间',
  'Etc/UTC': '协调世界时',
  'Etc/GMT': '格林尼治标准时间',
  'Africa/Abidjan': '阿比让',
  'Africa/Accra': '阿克拉',
  'Africa/Addis_Ababa': '亚的斯亚贝巴',
  'Africa/Algiers': '阿尔及尔',
  'Africa/Cairo': '开罗',
  'Africa/Casablanca': '卡萨布兰卡',
  'Africa/Johannesburg': '约翰内斯堡',
  'Africa/Khartoum': '喀土穆',
  'Africa/Lagos': '拉各斯',
  'Africa/Nairobi': '内罗毕',
  'Africa/Tunis': '突尼斯',
  'America/Anchorage': '安克雷奇',
  'America/Argentina/Buenos_Aires': '布宜诺斯艾利斯',
  'America/Asuncion': '亚松森',
  'America/Bogota': '波哥大',
  'America/Caracas': '加拉加斯',
  'America/Chicago': '芝加哥',
  'America/Denver': '丹佛',
  'America/Detroit': '底特律',
  'America/Edmonton': '埃德蒙顿',
  'America/Guatemala': '危地马拉',
  'America/Halifax': '哈利法克斯',
  'America/Havana': '哈瓦那',
  'America/Indiana/Indianapolis': '印第安纳波利斯',
  'America/Jamaica': '牙买加',
  'America/Lima': '利马',
  'America/Los_Angeles': '洛杉矶',
  'America/Manaus': '马瑙斯',
  'America/Mexico_City': '墨西哥城',
  'America/Montevideo': '蒙得维的亚',
  'America/New_York': '纽约',
  'America/Panama': '巴拿马',
  'America/Phoenix': '凤凰城',
  'America/Puerto_Rico': '波多黎各',
  'America/Santiago': '圣地亚哥',
  'America/Santo_Domingo': '圣多明各',
  'America/Sao_Paulo': '圣保罗',
  'America/St_Johns': '圣约翰斯',
  'America/Toronto': '多伦多',
  'America/Vancouver': '温哥华',
  'America/Winnipeg': '温尼伯',
  'Asia/Almaty': '阿拉木图',
  'Asia/Amman': '安曼',
  'Asia/Ashgabat': '阿什哈巴德',
  'Asia/Baghdad': '巴格达',
  'Asia/Baku': '巴库',
  'Asia/Bangkok': '曼谷',
  'Asia/Beirut': '贝鲁特',
  'Asia/Bishkek': '比什凯克',
  'Asia/Brunei': '文莱',
  'Asia/Chita': '赤塔',
  'Asia/Colombo': '科伦坡',
  'Asia/Damascus': '大马士革',
  'Asia/Dhaka': '达卡',
  'Asia/Dili': '帝力',
  'Asia/Dubai': '迪拜',
  'Asia/Dushanbe': '杜尚别',
  'Asia/Ho_Chi_Minh': '胡志明市',
  'Asia/Hong_Kong': '香港',
  'Asia/Hovd': '科布多',
  'Asia/Irkutsk': '伊尔库茨克',
  'Asia/Jakarta': '雅加达',
  'Asia/Jayapura': '查亚普拉',
  'Asia/Jerusalem': '耶路撒冷',
  'Asia/Kabul': '喀布尔',
  'Asia/Kamchatka': '堪察加',
  'Asia/Karachi': '卡拉奇',
  'Asia/Kathmandu': '加德满都',
  'Asia/Kolkata': '加尔各答',
  'Asia/Krasnoyarsk': '克拉斯诺亚尔斯克',
  'Asia/Kuala_Lumpur': '吉隆坡',
  'Asia/Kuwait': '科威特',
  'Asia/Macau': '澳门',
  'Asia/Magadan': '马加丹',
  'Asia/Makassar': '望加锡',
  'Asia/Manila': '马尼拉',
  'Asia/Muscat': '马斯喀特',
  'Asia/Nicosia': '尼科西亚',
  'Asia/Novosibirsk': '新西伯利亚',
  'Asia/Omsk': '鄂木斯克',
  'Asia/Phnom_Penh': '金边',
  'Asia/Pyongyang': '平壤',
  'Asia/Qatar': '卡塔尔',
  'Asia/Riyadh': '利雅得',
  'Asia/Sakhalin': '库页岛',
  'Asia/Samarkand': '撒马尔罕',
  'Asia/Seoul': '首尔',
  'Asia/Shanghai': '上海（中国）',
  'Asia/Singapore': '新加坡',
  'Asia/Taipei': '台北',
  'Asia/Tashkent': '塔什干',
  'Asia/Tbilisi': '第比利斯',
  'Asia/Tehran': '德黑兰',
  'Asia/Thimphu': '廷布',
  'Asia/Tokyo': '东京',
  'Asia/Tomsk': '托木斯克',
  'Asia/Ulaanbaatar': '乌兰巴托',
  'Asia/Urumqi': '乌鲁木齐',
  'Asia/Vladivostok': '符拉迪沃斯托克',
  'Asia/Yakutsk': '雅库茨克',
  'Asia/Yangon': '仰光',
  'Asia/Yekaterinburg': '叶卡捷琳堡',
  'Asia/Yerevan': '埃里温',
  'Atlantic/Azores': '亚速尔群岛',
  'Atlantic/Bermuda': '百慕大',
  'Atlantic/Canary': '加那利群岛',
  'Atlantic/Cape_Verde': '佛得角',
  'Atlantic/Reykjavik': '雷克雅未克',
  'Australia/Adelaide': '阿德莱德',
  'Australia/Brisbane': '布里斯班',
  'Australia/Darwin': '达尔文',
  'Australia/Hobart': '霍巴特',
  'Australia/Melbourne': '墨尔本',
  'Australia/Perth': '珀斯',
  'Australia/Sydney': '悉尼',
  'Europe/Amsterdam': '阿姆斯特丹',
  'Europe/Athens': '雅典',
  'Europe/Belgrade': '贝尔格莱德',
  'Europe/Berlin': '柏林',
  'Europe/Brussels': '布鲁塞尔',
  'Europe/Bucharest': '布加勒斯特',
  'Europe/Budapest': '布达佩斯',
  'Europe/Copenhagen': '哥本哈根',
  'Europe/Dublin': '都柏林',
  'Europe/Helsinki': '赫尔辛基',
  'Europe/Istanbul': '伊斯坦布尔',
  'Europe/Kiev': '基辅',
  'Europe/Kyiv': '基辅',
  'Europe/Lisbon': '里斯本',
  'Europe/London': '伦敦',
  'Europe/Luxembourg': '卢森堡',
  'Europe/Madrid': '马德里',
  'Europe/Malta': '马耳他',
  'Europe/Minsk': '明斯克',
  'Europe/Moscow': '莫斯科',
  'Europe/Oslo': '奥斯陆',
  'Europe/Paris': '巴黎',
  'Europe/Prague': '布拉格',
  'Europe/Riga': '里加',
  'Europe/Rome': '罗马',
  'Europe/Sofia': '索菲亚',
  'Europe/Stockholm': '斯德哥尔摩',
  'Europe/Tallinn': '塔林',
  'Europe/Vienna': '维也纳',
  'Europe/Vilnius': '维尔纽斯',
  'Europe/Warsaw': '华沙',
  'Europe/Zurich': '苏黎世',
  'Indian/Maldives': '马尔代夫',
  'Indian/Mauritius': '毛里求斯',
  'Pacific/Apia': '阿皮亚',
  'Pacific/Auckland': '奥克兰',
  'Pacific/Fiji': '斐济',
  'Pacific/Guam': '关岛',
  'Pacific/Honolulu': '檀香山',
  'Pacific/Noumea': '努美阿',
  'Pacific/Pago_Pago': '帕果帕果',
  'Pacific/Port_Moresby': '莫尔兹比港',
  'Pacific/Tahiti': '塔希提',
  'Pacific/Tongatapu': '汤加',
};

function ianaCity(tz: string) {
  return tz.split('/').pop()?.replace(/_/g, ' ') || tz;
}

export function timezoneLabel(tz: string) {
  return TIMEZONE_LABELS[tz] || ianaCity(tz);
}

export function timezoneOptionLabel(tz: string) {
  return `${timezoneLabel(tz)} · ${tz}`;
}

export function isValidTimezone(input: string) {
  const tz = String(input || '').trim();
  if (!tz) return false;
  if (tz === 'UTC' || tz === 'GMT') return true;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function systemTimezones() {
  try {
    if (typeof Intl !== 'undefined' && 'supportedValuesOf' in Intl) {
      return Intl.supportedValuesOf('timeZone');
    }
  } catch {
    /* older runtimes */
  }
  return Object.keys(TIMEZONE_LABELS);
}

export function listTimezones() {
  const common = COMMON_TIMEZONES.filter((tz) => isValidTimezone(tz) || tz === 'UTC');
  const seen = new Set<string>(common);
  const rest = systemTimezones()
    .filter((tz) => {
      if (seen.has(tz)) return false;
      seen.add(tz);
      return true;
    })
    .sort((a, b) => timezoneLabel(a).localeCompare(timezoneLabel(b), 'zh'));
  return [...common, ...rest];
}

export const TIMEZONES = listTimezones();

export const TIMEZONE_LIST = TIMEZONES as unknown as [string, ...string[]];

export type Timezone = string;

const ALLOWED = new Set<string>(TIMEZONES);

export function normalizeTimezone(input: unknown): string {
  const raw = String(input || '').trim();
  if (!raw) return DEFAULT_TIMEZONE;
  if (ALLOWED.has(raw) || isValidTimezone(raw)) return raw;
  throw new Error('Invalid timezone');
}
