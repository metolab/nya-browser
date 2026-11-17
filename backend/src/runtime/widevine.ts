import fs from 'fs';
import path from 'path';

export const WIDEVINE_DIR = process.env.NYA_WIDEVINE_DIR || '/opt/nya-widevine';

const WIDEVINE_LIB = path.join('_platform_specific', 'linux_x64', 'libwidevinecdm.so');

export function resolveWidevineDir() {
  const dir = String(WIDEVINE_DIR || '').trim();
  if (!dir) return null;
  try {
    if (fs.statSync(path.join(dir, 'manifest.json')).isFile() && fs.statSync(path.join(dir, WIDEVINE_LIB)).isFile()) {
      return dir;
    }
  } catch {
    /* missing */
  }
  return null;
}

// Chromium on Linux registers the CDM named by this hint at startup, even with
// --disable-component-update.
export function writeWidevineHint(profileDir: string) {
  const hintDir = path.join(profileDir, 'WidevineCdm');
  const hintFile = path.join(hintDir, 'latest-component-updated-widevine-cdm');
  const dir = resolveWidevineDir();
  if (!dir) {
    fs.rmSync(hintFile, { force: true });
    return;
  }
  fs.mkdirSync(hintDir, { recursive: true });
  fs.writeFileSync(hintFile, JSON.stringify({ Path: dir }));
}
