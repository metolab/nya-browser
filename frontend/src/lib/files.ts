export function formatBytes(value: number | null | undefined) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = n / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

export function hostOf(url: string) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export type PreviewKind = 'image' | 'pdf' | 'text' | 'none';

const TEXT_EXT = new Set(['txt', 'md', 'json', 'csv', 'log', 'xml', 'yml', 'yaml', 'ini', 'conf']);

export function previewKind(name: string): PreviewKind {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['html', 'htm', 'svg', 'xhtml'].includes(ext)) return 'none';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (TEXT_EXT.has(ext)) return 'text';
  return 'none';
}

export const TRANSFER_PAUSE_BYTES = 256 * 1024;
