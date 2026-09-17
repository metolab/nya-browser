import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeOriginalName, isFileDialogTitle, uniqueName } from './names.js';

const tmpDirs: string[] = [];

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nya-files-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs.length = 0;
});

describe('file names', () => {
  it('decodes multer latin1 names', () => {
    const raw = Buffer.from('报告.pdf', 'utf8').toString('latin1');
    expect(decodeOriginalName(raw)).toBe('报告.pdf');
  });

  it('renames collisions to name (1).ext', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'report.pdf'), 'a');
    expect(uniqueName(dir, 'report.pdf')).toBe('report (1).pdf');
    fs.writeFileSync(path.join(dir, 'report (1).pdf'), 'b');
    expect(uniqueName(dir, 'report.pdf')).toBe('report (2).pdf');
  });
});

describe('file dialog titles', () => {
  it('matches open/save dialogs and ignores page titles', () => {
    expect(isFileDialogTitle('Open File')).toBe(true);
    expect(isFileDialogTitle('打开')).toBe(true);
    expect(isFileDialogTitle('另存为')).toBe(true);
    expect(isFileDialogTitle('OpenAI')).toBe(false);
    expect(isFileDialogTitle('Save the Children')).toBe(false);
    expect(isFileDialogTitle('Save')).toBe(true);
  });
});
