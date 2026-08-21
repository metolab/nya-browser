import { expect, test } from '@playwright/test';
import { asAdmin } from '../helpers';
import fs from 'fs';
import os from 'os';
import path from 'path';

test('export and import session archive', async () => {
  const admin = await asAdmin();
  const created = await admin.post('/api/sessions', {
    data: {
      name: `bak${Date.now()}`,
      description: 'to-restore',
      timezone: 'Asia/Tokyo',
      homeUrl: 'https://example.org/',
    },
  });
  const session = (await created.json()).session;
  expect(session.fingerprint.seed).toBeTruthy();

  const exp = await admin.get(`/api/sessions/${session.id}/export`);
  expect(exp.ok()).toBeTruthy();
  const buf = Buffer.from(await exp.body());
  expect(buf.length).toBeGreaterThan(20);
  const tmp = path.join(os.tmpdir(), `nya-${Date.now()}.nya-session.tar.gz`);
  fs.writeFileSync(tmp, buf);

  const imp = await admin.post('/api/sessions/import', {
    multipart: {
      file: {
        name: path.basename(tmp),
        mimeType: 'application/gzip',
        buffer: buf,
      },
    },
  });
  expect(imp.status()).toBe(201);
  const imported = (await imp.json()).session;
  expect(imported.id).not.toBe(session.id);
  expect(imported.name).toBe(session.name);
  expect(imported.homeUrl).toContain('example.org');
  expect(imported.fingerprint.seed).toBe(session.fingerprint.seed);
  expect(imported.timezone).toBe('Asia/Tokyo');

  await admin.delete(`/api/sessions/${session.id}`);
  await admin.delete(`/api/sessions/${imported.id}`);
  fs.unlinkSync(tmp);
  await admin.dispose();
});
