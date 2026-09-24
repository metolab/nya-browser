import { execFileSync } from 'child_process';

export const FALLBACK_LOCALE = 'C.UTF-8';

export function localeKey(name: string) {
  const [base, codeset = ''] = String(name || '').split('.');
  const cs = codeset.toLowerCase().replace(/[^a-z0-9]/g, '');
  return cs ? `${base}.${cs}` : base;
}

export function parseLocaleList(output: string) {
  return new Set(
    String(output || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map(localeKey),
  );
}

/** glibc drops to ASCII "C" when LC_ALL names a missing locale; non-ASCII paths then crash Chrome on paste. */
export function pickLocale(posix: string, installed: Set<string> | null) {
  if (!installed) return posix;
  return installed.has(localeKey(posix)) ? posix : FALLBACK_LOCALE;
}

let cached: Set<string> | null | undefined;

export function installedLocales() {
  if (cached !== undefined) return cached;
  try {
    cached = parseLocaleList(execFileSync('locale', ['-a'], { encoding: 'utf8', timeout: 5000 }));
  } catch {
    cached = null;
  }
  return cached;
}

export function sessionLocale(posix: string) {
  return pickLocale(posix, installedLocales());
}
