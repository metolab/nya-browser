import { describe, expect, it } from 'vitest';
import { fileUri, uriList } from './fileUri.js';

describe('fileUri', () => {
  it('encodes spaces and keeps slashes', () => {
    expect(fileUri('/data/sessions/a/files/my file.png')).toBe(
      'file:///data/sessions/a/files/my%20file.png',
    );
  });

  it('percent-encodes unicode path segments as utf-8', () => {
    expect(fileUri('/data/sessions/a/files/报告.pdf')).toBe(
      'file:///data/sessions/a/files/%E6%8A%A5%E5%91%8A.pdf',
    );
  });

  it('builds a uri-list with CRLF', () => {
    expect(uriList(['/tmp/a.txt', '/tmp/b.txt'])).toBe('file:///tmp/a.txt\r\nfile:///tmp/b.txt\r\n');
  });
});
