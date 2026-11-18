import fs from 'fs';
import path from 'path';
import { windowsUiFont, type WindowsRelease } from '@nya/shared';
import { WIN11_ONLY_FONT_FILES, WINDOWS_FONT_PREFS, type WindowsGenericFonts } from './windowsFontPrefs.js';

export const WINDOWS_FONT_DIR = process.env.NYA_WINDOWS_FONT_DIR || '/opt/nya/winfonts';
export const WINDOWS_FONTCONFIG = process.env.NYA_WINDOWS_FONTCONFIG || '/etc/nya/fonts-windows.conf';
/** Linux fonts carrying Windows family names, for images without real Windows fonts. */
export const WINDOWS_ALIASED_FONTCONFIG =
  process.env.NYA_WINDOWS_ALIASED_FONTCONFIG || '/etc/nya/fonts-windows-aliased.conf';

let cachedHasFonts: boolean | null = null;

/** Real Windows fonts are optional: only images built with third_party/assets have them. */
export function hasWindowsFonts() {
  if (cachedHasFonts === null) {
    try {
      cachedHasFonts =
        fs.existsSync(WINDOWS_FONTCONFIG) &&
        fs.readdirSync(WINDOWS_FONT_DIR).some((f) => /\.(ttf|ttc|otf)$/i.test(f));
    } catch {
      cachedHasFonts = false;
    }
  }
  return cachedHasFonts;
}

function localeKey(language: string, keys: string[]) {
  const lang = language === 'zh-HK' || language === 'zh-MO' ? 'zh-TW' : language;
  if (keys.includes(lang)) return lang;
  const base = lang.split('-')[0];
  if (base === 'zh') return keys.includes('zh-CN') ? 'zh-CN' : null;
  return keys.find((k) => k.split('-')[0] === base) || null;
}

/** Chrome's Windows defaults for the UI locale: `webkit.webprefs.fonts.<generic>.<script>`. */
export function windowsFontPrefs(release: WindowsRelease, language: string) {
  const table = WINDOWS_FONT_PREFS[release];
  const key = localeKey(language, Object.keys(table.locales));
  const common: WindowsGenericFonts = { ...table.defaults, ...(key ? table.locales[key] : {}) };
  const out: Record<string, Record<string, string>> = {};
  const put = (generic: string, script: string, family?: string) => {
    if (!family) return;
    out[generic] ||= {};
    out[generic][script] = family;
  };
  for (const [generic, family] of Object.entries(common)) put(generic, 'Zyyy', family);
  for (const [script, row] of Object.entries(table.scripts)) {
    for (const [generic, family] of Object.entries(row)) put(generic, script, family);
  }
  return out;
}

function xmlEscape(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Per-session fontconfig: Windows fonts only, minus files the release does not ship. */
export function writeWindowsFontconfig(dir: string, release: WindowsRelease, language: string) {
  fs.mkdirSync(dir, { recursive: true });
  const reject =
    release === 'win10'
      ? `  <selectfont>\n    <rejectfont>\n${WIN11_ONLY_FONT_FILES.map(
          (f) => `      <glob>${xmlEscape(path.join(WINDOWS_FONT_DIR, f))}</glob>`,
        ).join('\n')}\n    </rejectfont>\n  </selectfont>\n`
      : '';
  const ui = xmlEscape(windowsUiFont(language));
  const file = path.join(dir, 'fonts-windows.conf');
  fs.writeFileSync(
    file,
    `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <include ignore_missing="no">${xmlEscape(WINDOWS_FONTCONFIG)}</include>
${reject}  <alias binding="strong">
    <family>Sans</family>
    <prefer><family>${ui}</family></prefer>
  </alias>
  <alias binding="strong">
    <family>system-ui</family>
    <prefer><family>${ui}</family></prefer>
  </alias>
</fontconfig>
`,
  );
  return file;
}

export function removeWindowsFontconfig(dir: string) {
  fs.rmSync(path.join(dir, 'fonts-windows.conf'), { force: true });
}
