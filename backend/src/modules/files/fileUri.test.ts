import { describe, expect, it } from 'vitest';
import { fileUri, uriList } from './fileUri.js';

describe('fileUri', () => {
  it('encodes spaces and keeps slashes', () => {
    expect(fileUri('/data/sessions/a/files/my file.png')).toBe(
      'file:///data/sessions/a/files/my%20file.png',
    );
  });

  it('builds a uri-list with CRLF', () => {
    expect(uriList(['/tmp/a.txt', '/tmp/b.txt'])).toBe('file:///tmp/a.txt\r\nfile:///tmp/b.txt\r\n');
  });
});
