/**
 * RFB ClientCutText / ServerCutText is ISO-8859-1. x11vnc often ships UTF-8
 * bytes in that field, so CJK shows up as mojibake (已 → å·²). noVNC's
 * clipboardPasteFrom then replaces code points > 0xff with "?".
 */

export function decodeUtf8FromLatin1(text: string): string | null {
  if (!text) return null;
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) return null;
    bytes[i] = code;
  }
  if (!bytes.some((b) => b >= 0x80)) return null;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return decoded === text ? null : decoded;
  } catch {
    return null;
  }
}

export function replaceNonLatin1(text: string): string {
  return Array.from(text, (ch) => {
    const cp = ch.codePointAt(0) ?? 0;
    return cp > 0xff ? '?' : ch;
  }).join('');
}

export function isLatin1Replacement(original: string, candidate: string): boolean {
  if (!original || original === candidate) return false;
  return replaceNonLatin1(original) === candidate;
}

/** Return cleaned text, or null to keep the previous clipboard value. */
export function normalizeClipboardText(incoming: string, previous = ''): string | null {
  const raw = String(incoming ?? '');
  if (previous && isLatin1Replacement(previous, raw)) return null;
  const recovered = decodeUtf8FromLatin1(raw) ?? raw;
  if (previous && isLatin1Replacement(previous, recovered)) return null;
  return recovered;
}
