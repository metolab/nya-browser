export const OS_TYPES = ['linux', 'windows'] as const;
export type OsType = (typeof OS_TYPES)[number];
/** New sessions emulate Windows; stored records without an OS predate it and stay Linux. */
export const DEFAULT_OS: OsType = 'windows';
export const LEGACY_OS: OsType = 'linux';

export const WINDOWS_RELEASES = ['win10', 'win11'] as const;
export type WindowsRelease = (typeof WINDOWS_RELEASES)[number];
export const DEFAULT_WINDOWS_RELEASE: WindowsRelease = 'win11';

export const OS_LABELS: Record<OsType, string> = {
  linux: 'Linux（真实）',
  windows: 'Windows（伪装）',
};

export const WINDOWS_RELEASE_LABELS: Record<WindowsRelease, string> = {
  win10: 'Windows 10',
  win11: 'Windows 11',
};

export interface WindowsIdentity {
  uaPlatform: string;
  navigatorPlatform: string;
  chPlatform: string;
  /** Sec-CH-UA-Platform-Version, derived from the UniversalApiContract version. */
  chPlatformVersion: string;
  taskbarPx: number;
}

export const WINDOWS_IDENTITIES: Record<WindowsRelease, WindowsIdentity> = {
  win10: {
    uaPlatform: 'Windows NT 10.0; Win64; x64',
    navigatorPlatform: 'Win32',
    chPlatform: 'Windows',
    chPlatformVersion: '10.0.0',
    taskbarPx: 40,
  },
  win11: {
    uaPlatform: 'Windows NT 10.0; Win64; x64',
    navigatorPlatform: 'Win32',
    chPlatform: 'Windows',
    chPlatformVersion: '19.0.0',
    taskbarPx: 48,
  },
};

export function isOsType(value: unknown): value is OsType {
  return OS_TYPES.includes(value as OsType);
}

export function coerceOs(input: unknown): OsType {
  const raw = String(input || '')
    .trim()
    .toLowerCase();
  return isOsType(raw) ? raw : LEGACY_OS;
}

export function isWindowsRelease(value: unknown): value is WindowsRelease {
  return WINDOWS_RELEASES.includes(value as WindowsRelease);
}

export function coerceWindowsRelease(input: unknown): WindowsRelease {
  const raw = String(input || '')
    .trim()
    .toLowerCase();
  return isWindowsRelease(raw) ? raw : DEFAULT_WINDOWS_RELEASE;
}

export function windowsIdentity(os: OsType, release: WindowsRelease): WindowsIdentity | null {
  return os === 'windows' ? WINDOWS_IDENTITIES[release] : null;
}

/** Built-in OneCore voices of a Windows 10/11 install for the display language (speechSynthesis). */
const WINDOWS_VOICES: Record<string, Array<[name: string, lang: string]>> = {
  'zh-CN': [
    ['Microsoft Huihui - Chinese (Simplified, PRC)', 'zh-CN'],
    ['Microsoft Kangkang - Chinese (Simplified, PRC)', 'zh-CN'],
    ['Microsoft Yaoyao - Chinese (Simplified, PRC)', 'zh-CN'],
  ],
  'zh-TW': [
    ['Microsoft Hanhan - Chinese (Traditional, Taiwan)', 'zh-TW'],
    ['Microsoft Yating - Chinese (Traditional, Taiwan)', 'zh-TW'],
    ['Microsoft Zhiwei - Chinese (Traditional, Taiwan)', 'zh-TW'],
  ],
  'zh-HK': [
    ['Microsoft Danny - Chinese (Traditional, Hong Kong S.A.R.)', 'zh-HK'],
    ['Microsoft Tracy - Chinese (Traditional, Hong Kong S.A.R.)', 'zh-HK'],
  ],
  'en-US': [
    ['Microsoft David - English (United States)', 'en-US'],
    ['Microsoft Mark - English (United States)', 'en-US'],
    ['Microsoft Zira - English (United States)', 'en-US'],
  ],
  'en-GB': [
    ['Microsoft George - English (United Kingdom)', 'en-GB'],
    ['Microsoft Hazel - English (United Kingdom)', 'en-GB'],
    ['Microsoft Susan - English (United Kingdom)', 'en-GB'],
  ],
  'ja-JP': [
    ['Microsoft Ayumi - Japanese (Japan)', 'ja-JP'],
    ['Microsoft Haruka - Japanese (Japan)', 'ja-JP'],
    ['Microsoft Ichiro - Japanese (Japan)', 'ja-JP'],
    ['Microsoft Sayaka - Japanese (Japan)', 'ja-JP'],
  ],
  'ko-KR': [['Microsoft Heami - Korean (Korea)', 'ko-KR']],
  'de-DE': [
    ['Microsoft Hedda - German (Germany)', 'de-DE'],
    ['Microsoft Katja - German (Germany)', 'de-DE'],
    ['Microsoft Stefan - German (Germany)', 'de-DE'],
  ],
  'fr-FR': [
    ['Microsoft Hortense - French (France)', 'fr-FR'],
    ['Microsoft Julie - French (France)', 'fr-FR'],
    ['Microsoft Paul - French (France)', 'fr-FR'],
  ],
  'es-ES': [
    ['Microsoft Helena - Spanish (Spain)', 'es-ES'],
    ['Microsoft Laura - Spanish (Spain)', 'es-ES'],
    ['Microsoft Pablo - Spanish (Spain)', 'es-ES'],
  ],
  'ru-RU': [
    ['Microsoft Irina - Russian (Russia)', 'ru-RU'],
    ['Microsoft Pavel - Russian (Russia)', 'ru-RU'],
  ],
};

export function windowsVoices(language: string): Array<[name: string, lang: string]> {
  const lang = String(language || '').trim();
  if (WINDOWS_VOICES[lang]) return WINDOWS_VOICES[lang];
  if (lang === 'zh-MO') return WINDOWS_VOICES['zh-HK'];
  const base = lang.split('-')[0].toLowerCase();
  if (base === 'zh') return WINDOWS_VOICES['zh-CN'];
  const key = Object.keys(WINDOWS_VOICES).find((k) => k.split('-')[0] === base);
  return WINDOWS_VOICES[key || 'en-US'];
}

/** Chrome UI locale (resource pak) Chrome picks for a --lang value. */
function chromeUiLocale(language: string, available: Record<string, unknown>) {
  const lang = String(language || '').trim();
  if (available[lang]) return lang;
  const base = lang.split('-')[0].toLowerCase();
  if (base === 'zh') return lang === 'zh-HK' || lang === 'zh-MO' ? 'zh-HK' : lang === 'zh-TW' ? 'zh-TW' : 'zh-CN';
  if (base === 'he') return 'iw';
  if (base === 'nb' || base === 'nn') return 'no';
  if (base === 'pt') return 'pt-PT';
  if (base === 'es' && lang !== 'es-ES') return 'es-419';
  return available[base] ? base : '';
}

/** IDS_DEFAULT_AUDIO_DEVICE_NAME / IDS_COMMUNICATIONS_AUDIO_DEVICE_NAME per Chrome UI locale. */
const CHROME_AUDIO_DEVICE_PREFIXES: Record<string, [string, string]> = {
  'af': ["Verstek", "Kommunikasies"],
  'am': ["እንደወረደ", "ተግባቦት"],
  'ar': ["التلقائي", "الاتصالات"],
  'as': ["ডিফ’ল্ট", "যোগাযোগ"],
  'az': ["Defolt", "Əlaqələr"],
  'be': ["Стандартна", "Размовы"],
  'bg': ["По подразбиране", "Комуникации"],
  'bn': ["ডিফল্ট", "যোগাযোগগুলি"],
  'bs': ["Zadano", "Komunikacije"],
  'ca': ["Predeterminat", "Comunicacions"],
  'cs': ["Výchozí", "Komunikační příslušenství"],
  'cy': ["Diofyn", "Cyfathrebiadau"],
  'da': ["Standard", "Kommunikation"],
  'de': ["Standard", "Kommunikation"],
  'el': ["Προεπιλογή", "Επικοινωνίες"],
  'en-GB': ["Default", "Communications"],
  'es-419': ["Predeterminado", "Comunicaciones"],
  'es': ["Predeterminado", "Comunicaciones"],
  'et': ["Vaikimisi", "Vestlusteenused"],
  'eu': ["Lehenetsia", "Komunikazioak"],
  'fa': ["پیش‌فرض", "ارتباطات"],
  'fi': ["Oletus", "Äänilaitteet"],
  'fil': ["Default", "Komunikasyon"],
  'fr-CA': ["Par défaut", "Communications"],
  'fr': ["Par défaut", "Communications"],
  'gl': ["Predeterminado", "Comunicacións"],
  'gu': ["ડિફૉલ્ટ", "સંચાર"],
  'hi': ["डिफ़ॉल्ट", "संचार"],
  'hr': ["Zadano", "Komunikacije"],
  'hu': ["Alapértelmezett", "Kommunikáció"],
  'hy': ["Կանխադրված", "Հաղորդակցում"],
  'id': ["Default", "Komunikasi"],
  'is': ["Sjálfgefið", "Samskipti"],
  'it': ["Predefinito", "Comunicazioni"],
  'iw': ["ברירת מחדל", "תקשורת"],
  'ja': ["既定", "通信"],
  'ka': ["ნაგულისხმევი", "კომუნიკაციები"],
  'kk': ["Әдепкі", "Байланыстар"],
  'km': ["លំនាំដើម", "ការប្រាស្រ័យទាក់ទង"],
  'kn': ["ಡಿಫಾಲ್ಟ್", "ಸಂವಹನಗಳು"],
  'ko': ["기본값", "커뮤니케이션"],
  'ky': ["Демейки", "Байланыштар"],
  'lo': ["ຄ່າ​ມາດຕະຖານ", "ການ​ສື່​ສານ"],
  'lt': ["Numatytasis", "Ryšiai"],
  'lv': ["Noklusējums", "Saziņa"],
  'mk': ["Стандардно", "Комуникации"],
  'ml': ["ഡിഫോൾട്ട്", "കമ്മ്യൂണിക്കേഷനുകൾ"],
  'mn': ["Гэрээ үл биелүүлэх", "Харилцаа холбоо"],
  'mr': ["डीफॉल्ट", "संप्रेषणे"],
  'ms': ["Lalai", "Komunikasi"],
  'my': ["ပုံသေ", "ဆက်သွယ်မှုများ"],
  'ne': ["डिफल्ट", "सञ्चारहरू"],
  'nl': ["Standaard", "Communicatie"],
  'no': ["Standard", "Kommunikasjon"],
  'or': ["ଡିଫଲ୍ଟ", "ଯୋଗାଯୋଗ"],
  'pa': ["ਪੂਰਵ-ਨਿਰਧਾਰਤ", "ਸੰਚਾਰ"],
  'pl': ["Domyślny", "Komunikacja"],
  'pt-BR': ["Padrão", "Comunicações"],
  'pt-PT': ["Predefinição", "Comunicações"],
  'ro': ["Prestabilit", "Comunicații"],
  'ru': ["По умолчанию", "Оборудование"],
  'si': ["පෙරනිමි", "සන්නිවේදන"],
  'sk': ["Predvolené", "Komunikácia"],
  'sl': ["Privzeto", "Komunikacije"],
  'sq': ["I parazgjedhur", "Komunikimet"],
  'sr-Latn': ["Podrazumevano", "Komunikacije"],
  'sr': ["Подразумевано", "Комуникације"],
  'sv': ["Standard", "Kommunikation"],
  'sw': ["Chaguomsingi", "Mawasiliano"],
  'ta': ["இயல்புநிலை", "தகவல்தொடர்புகள்"],
  'te': ["డిఫాల్ట్", "కమ్యూనికేషన్‌లు"],
  'th': ["ค่าเริ่มต้น", "การสื่อสาร"],
  'tr': ["Varsayılan", "İletişim"],
  'uk': ["За умовчанням", "Зв’язок"],
  'ur': ["ڈیفالٹ", "مواصلات"],
  'uz': ["Standart", "Uskunalar"],
  'vi': ["Mặc định", "Truyền thông"],
  'zh-CN': ["默认", "通讯"],
  'zh-HK': ["預設", "通訊工具"],
  'zh-TW': ["預設", "通訊"],
  'zu': ["Okuzenzakalelayo", "Ezokuxhumana"],
};

/** Chrome's labels for the "default" / "communications" audio entries (Windows prefixes them to the endpoint). */
export function chromeAudioDevicePrefixes(language: string): [string, string] {
  return CHROME_AUDIO_DEVICE_PREFIXES[chromeUiLocale(language, CHROME_AUDIO_DEVICE_PREFIXES)] || ['Default', 'Communications'];
}

/** IDS_ACCEPT_LANGUAGES: the first-run intl.accept_languages of each Chrome UI locale. */
const CHROME_DEFAULT_ACCEPT_LANGUAGES: Record<string, string> = {
  'en-US': 'en-US,en',
  'am': "am,en-GB,en",
  'ar': "ar,en-US,en",
  'bg': "bg-BG,bg",
  'bn': "bn-IN,bn,en-US,en",
  'ca': "ca-ES,ca",
  'cs': "cs-CZ,cs",
  'da': "da-DK,da,en-US,en",
  'de': "de-DE,de,en-US,en",
  'el': "el-GR,el",
  'en-GB': "en-GB,en-US,en",
  'es-419': "es-419,es",
  'es': "es-ES,es",
  'et': "et-EE,et,en-US,en",
  'fa': "fa,en-US,en",
  'fi': "fi-FI,fi,en-US,en",
  'fil': "fil,fil-PH,tl,en-US,en",
  'fr': "fr-FR,fr,en-US,en",
  'gu': "gu-IN,gu,hi-IN,hi,en-US,en",
  'he': "he-IL,he,en-US,en",
  'hi': "hi-IN,hi,en-US,en",
  'hr': "hr-HR,hr,en-US,en",
  'hu': "hu-HU,hu,en-US,en",
  'id': "id-ID,id,en-US,en",
  'it': "it-IT,it,en-US,en",
  'ja': "ja,en-US,en",
  'kn': "kn-IN,kn,en-US,en",
  'ko': "ko-KR,ko,en-US,en",
  'lt': "lt,en-US,en,ru,pl",
  'lv': "lv-LV,lv,en-US,en",
  'ml': "ml-IN,ml,en-US,en",
  'mr': "mr-IN,mr,hi-IN,hi,en-US,en",
  'nb': "nb-NO,nb,no,nn,en-US,en",
  'nl': "nl-NL,nl,en-US,en",
  'pl': "pl-PL,pl,en-US,en",
  'pt-BR': "pt-BR,pt,en-US,en",
  'pt-PT': "pt-PT,pt,en-US,en",
  'ro': "ro-RO,ro,en-US,en",
  'ru': "ru-RU,ru,en-US,en",
  'sk': "sk-SK,sk,cs,en-US,en",
  'sl': "sl-SI,sl,en-GB,en",
  'sr': "sr-RS,sr,en-US,en",
  'sv': "sv-SE,sv,en-US,en",
  'sw': "sw,en-GB,en",
  'ta': "ta-IN,ta,en-US,en",
  'te': "te-IN,te,hi-IN,hi,en-US,en",
  'th': "th-TH,th",
  'tr': "tr-TR,tr,en-US,en",
  'uk': "uk-UA,uk,en-US,en",
  'vi': "vi-VN,vi,fr-FR,fr,en-US,en",
  'zh-CN': "zh-CN,zh",
  'zh-TW': "zh-TW,zh,en-US,en",
};

/** First-run Accept-Language of Chrome for this UI language; null when Chrome has no default. */
export function chromeDefaultAcceptLanguages(language: string): string | null {
  const lang = String(language || '').trim();
  if (CHROME_DEFAULT_ACCEPT_LANGUAGES[lang]) return CHROME_DEFAULT_ACCEPT_LANGUAGES[lang];
  return null;
}

/** NONCLIENTMETRICS menu / caption / status font of a Windows display language. */
export function windowsUiFont(language: string): string {
  const lang = String(language || '').trim();
  const base = lang.split('-')[0].toLowerCase();
  if (base === 'zh') return lang === 'zh-TW' || lang === 'zh-HK' || lang === 'zh-MO' ? 'Microsoft JhengHei UI' : 'Microsoft YaHei UI';
  if (base === 'ja') return 'Yu Gothic UI';
  if (base === 'ko') return 'Malgun Gothic';
  if (base === 'th') return 'Leelawadee UI';
  if (['hi', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'pa', 'or', 'ne', 'si', 'as'].includes(base)) return 'Nirmala UI';
  return 'Segoe UI';
}

