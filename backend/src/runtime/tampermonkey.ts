import fs from 'fs';
import path from 'path';

export const TAMPERMONKEY_ID = 'dhdgffkkebhmkfjojejmpbldmpobfkfo';
export const TAMPERMONKEY_DIR =
  process.env.NYA_TAMPERMONKEY_DIR || '/opt/nya-extensions/tampermonkey';

export function resolveTampermonkeyDir() {
  const dir = String(TAMPERMONKEY_DIR || '').trim();
  if (!dir) return null;
  try {
    if (fs.statSync(path.join(dir, 'manifest.json')).isFile()) return dir;
  } catch {
    /* missing */
  }
  return null;
}

export function isTampermonkeyIntroUrl(url?: string | null) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host !== 'tampermonkey.net') return false;
    return parsed.pathname === '/installed.php' || parsed.pathname.startsWith('/installed.php');
  } catch {
    return false;
  }
}
