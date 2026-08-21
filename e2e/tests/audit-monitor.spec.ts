import { expect, test } from '@playwright/test';
import { asAdmin } from '../helpers';

test('audit records login and session create', async () => {
  const admin = await asAdmin();
  const name = `aud${Date.now()}`;
  await admin.post('/api/sessions', { data: { name } });
  const logs = await admin.get('/api/audit?limit=50');
  expect(logs.ok()).toBeTruthy();
  const items = (await logs.json()).logs;
  expect(items.some((l: { action: string }) => l.action === 'login')).toBeTruthy();
  expect(items.some((l: { action: string; detail?: { name?: string } }) => l.action === 'session.create')).toBeTruthy();
  await admin.dispose();
});

test('monitor snapshot and logs', async () => {
  const admin = await asAdmin();
  const mon = await admin.get('/api/monitor');
  expect(mon.ok()).toBeTruthy();
  const body = await mon.json();
  expect(body.monitor.host.memory.totalBytes).toBeGreaterThan(0);
  expect(Array.isArray(body.monitor.host.loadavg)).toBeTruthy();

  const live = await admin.get('/api/live');
  expect(live.ok()).toBeTruthy();

  const appLog = await admin.get('/api/monitor/logs/app?tail=20');
  expect(appLog.ok()).toBeTruthy();
  await admin.dispose();
});
