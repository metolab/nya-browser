import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { PASTE_IMAGE_PIXEL_MAX } from '@nya/shared';

const execFileAsync = promisify(execFile);

function isPng(buf: Buffer) {
  return buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

function isWebp(buf: Buffer) {
  return buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
}

function pngSize(buf: Buffer) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function assertPngBounds(buf: Buffer) {
  if (!isPng(buf)) throw new Error('Invalid PNG');
  const { width, height } = pngSize(buf);
  if (width < 1 || height < 1 || width > PASTE_IMAGE_PIXEL_MAX || height > PASTE_IMAGE_PIXEL_MAX) {
    throw new Error('Image too large');
  }
  return buf;
}

async function webpToPng(input: Buffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nya-webp-'));
  const src = path.join(dir, 'in.webp');
  const dest = path.join(dir, 'out.png');
  fs.writeFileSync(src, input);
  try {
    await execFileAsync('dwebp', [src, '-o', dest], { timeout: 20_000 });
    return assertPngBounds(fs.readFileSync(dest));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function toClipboardPng(input: Buffer) {
  if (isPng(input)) return assertPngBounds(input);
  if (isWebp(input)) return webpToPng(input);
  throw new Error('Unsupported image');
}
