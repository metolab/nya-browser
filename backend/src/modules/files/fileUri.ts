import path from 'path';

export function fileUri(absPath: string) {
  const resolved = path.resolve(absPath);
  const encoded = resolved
    .split('/')
    .map((part, index) => (index === 0 && part === '' ? '' : encodeURIComponent(part)))
    .join('/');
  return `file://${encoded}`;
}

export function uriList(absPaths: string[]) {
  return `${absPaths.map(fileUri).join('\r\n')}\r\n`;
}
