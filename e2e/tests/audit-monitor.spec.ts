import { expect, test } from '@playwright/test';
import { asAdmin } from '../helpers';

test('audit records login and session create', async () => {
  const admin = await asAdmin();
  const name = `aud${Date.now()}`;
  await admin.post('/api/sessions', { data: { name } });
  const logs = await admin.get('/api/audit?limit=50');
  expect(logs.ok()).toBeTruthy();
  const body = await logs.json();
  const items = body.logs;
  expect(body.total).toBeGreaterThan(0);
  expect(items.length).toBeLessThanOrEqual(50);
  expect(items.some((l: { action: string }) => l.action === 'login')).toBeTruthy();
  expect(items.some((l: { action: string; detail?: { name?: string } }) => l.action === 'session.create')).toBeTruthy();

  const page2 = await admin.get('/api/audit?limit=10&offset=10');
  expect(page2.ok()).toBeTruthy();
  const p2 = await page2.json();
  expect(p2.offset).toBe(10);
  expect(p2.limit).toBe(10);
  await admin.dispose();
});

test('monitor snapshot and logs', async () => {
  const admin = await asAdmin();
  const mon = await admin.get('/api/monitor');
  expect(mon.ok()).toBeTruthy();
  const body = await mon.json();
  expect(body.monitor.host.memory.totalBytes).toBeGreaterThan(0);
  expect(body.monitor.host.memory.usedBytes).toBeGreaterThan(0);
  expect(body.monitor.host.disk.usedBytes).toBeGreaterThanOrEqual(0);
  expect(Array.isArray(body.monitor.host.loadavg)).toBeTruthy();
  expect(Array.isArray(body.monitor.sessions)).toBeTruthy();
  for (const row of body.monitor.sessions) {
    expect(typeof row.running).toBe('boolean');
    expect(typeof row.cpuPercent).toBe('number');
    expect(typeof row.rssBytes).toBe('number');
    expect(typeof row.diskBytes).toBe('number');
    expect(row.gpu).toBeTruthy();
    if (!row.running) {
      expect(row.windows).toEqual([]);
    }
  }

  const live = await admin.get('/api/live');
  expect(live.ok()).toBeTruthy();

  const appLog = await admin.get('/api/monitor/logs/app?tail=20');
  expect(appLog.ok()).toBeTruthy();
  await admin.dispose();
});
