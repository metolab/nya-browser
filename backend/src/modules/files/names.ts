import fs from 'fs';
import path from 'path';

export const UPLOAD_LOG_NAME = 'upload-log.json';
export const HIDDEN_FILE_NAMES = new Set(['.keep.html', UPLOAD_LOG_NAME]);

const FILE_DIALOG_TITLE =
  /^(open|open file|open files|save|save as|save file|打开|打开文件|保存|另存为|选择文件|選擇檔案)$/i;

export function isHiddenFileName(name: string) {
  return !name || name.startsWith('.') || HIDDEN_FILE_NAMES.has(name);
}

export function decodeOriginalName(raw: string) {
  const value = String(raw || '').trim() || 'file';
  let decoded = value;
  try {
    decoded = Buffer.from(value, 'latin1').toString('utf8') || value;
  } catch {
    decoded = value;
  }
  const base = path.basename(decoded).replace(/[\u0000-\u001f]/g, '') || 'file';
  if (base === '.' || base === '..') return 'file';
  return base;
}

export function uniqueName(dir: string, original: string) {
  const base = decodeOriginalName(original);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  const exists = (name: string) => fs.existsSync(path.join(dir, name));
  if (!exists(base)) return base;
  for (let i = 1; i < 1000; i += 1) {
    const name = `${stem} (${i})${ext}`;
    if (!exists(name)) return name;
  }
  return `${stem}-${Date.now()}${ext}`;
}

export function isFileDialogTitle(title: string) {
  const text = String(title || '').trim();
  if (!text) return false;
  const first = text.split(/\s+[-–—|·]/)[0]?.trim() || text;
  return FILE_DIALOG_TITLE.test(first) || FILE_DIALOG_TITLE.test(text);
}

export function isCrdownload(name: string) {
  return name.toLowerCase().endsWith('.crdownload');
}

export function stripCrdownload(name: string) {
  return name.replace(/\.crdownload$/i, '');
}
