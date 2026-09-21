import { FILE_UPLOAD_MAX_BYTES } from '@nya/shared';

export const GENERIC_IMAGE_NAME = /^(image|untitled|picture|screenshot|img)(?: \(\d+\))?(\.[a-z0-9]+)?$/i;
export const OS_SCREENSHOT_NAME =
  /^(Screenshot \d|Screen Shot |Screenshot from |Screenshot_|屏幕截图|截圖)/i;

export function isScreenshotName(name: string) {
  const value = name || 'image.png';
  return GENERIC_IMAGE_NAME.test(value) || OS_SCREENSHOT_NAME.test(value);
}
const FRESH_IMAGE_MS = 5000;

export type TransferSource = 'clipboard' | 'picker';
export type TransferMode = 'files' | 'image' | 'text' | 'empty';

export type ClassifiedTransfer = {
  mode: TransferMode;
  files: File[];
  images: File[];
  text: string;
};

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function dedupeFiles(files: File[]) {
  const seen = new Set<string>();
  const out: File[] = [];
  for (const file of files) {
    const key = fileKey(file);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(file);
  }
  return out;
}

/** Fresh named screenshots only. OS screenshots older than 5s stay files. */
export function isGenericImageFile(file: File) {
  if (!file.type.startsWith('image/')) return false;
  if (!isScreenshotName(file.name || 'image.png')) return false;
  return Date.now() - file.lastModified < FRESH_IMAGE_MS;
}

export function filesFromClipboard(data: DataTransfer | null | undefined) {
  if (!data) return [];
  const fromFiles = Array.from(data.files || []);
  const fromItems: File[] = [];
  for (const item of Array.from(data.items || [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) fromItems.push(file);
  }
  return dedupeFiles([...fromFiles, ...fromItems]);
}

export function classifyTransfer(opts: {
  source: TransferSource;
  files: File[];
  text?: string;
}): ClassifiedTransfer {
  const files = dedupeFiles(opts.files || []);
  const text = String(opts.text || '');
  if (opts.source === 'picker') {
    if (!files.length) return { mode: text.trim() ? 'text' : 'empty', files: [], images: [], text };
    return { mode: 'files', files, images: [], text: '' };
  }
  const real = files.filter((file) => !isGenericImageFile(file));
  const images = files.filter((file) => isGenericImageFile(file));
  if (real.length) return { mode: 'files', files: real, images: [], text: '' };
  if (images.length) return { mode: 'image', files: [], images, text: '' };
  if (text.trim()) return { mode: 'text', files: [], images: [], text };
  return { mode: 'empty', files: [], images: [], text: '' };
}

function fnv1a(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export async function contentFingerprint(file: File) {
  const size = file.size;
  const headLen = Math.min(65536, size);
  const tailStart = size > 65536 ? size - Math.min(65536, size - headLen) : 0;
  const [head, tail] = await Promise.all([
    file.slice(0, headLen).arrayBuffer(),
    tailStart ? file.slice(tailStart).arrayBuffer() : Promise.resolve(new ArrayBuffer(0)),
  ]);
  const generic = isScreenshotName(file.name || 'image.png');
  const label = generic ? `img:${size}:${file.type}` : `${file.name}:${size}:${file.lastModified}`;
  return `${label}:${fnv1a(head)}:${fnv1a(tail)}`;
}

export function splitBySize(files: File[], maxBytes = FILE_UPLOAD_MAX_BYTES) {
  const kept: File[] = [];
  const skipped: File[] = [];
  for (const file of files) {
    if (file.size > maxBytes) skipped.push(file);
    else kept.push(file);
  }
  return { kept, skipped };
}
