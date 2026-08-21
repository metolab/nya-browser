import { expect, test } from '@playwright/test';
import { asAdmin, asUser } from '../helpers';

test('assigned user cannot stop a shared session', async () => {
  const admin = await asAdmin();
  const stamp = Date.now();
  const session = (
    await (await admin.post('/api/sessions', { data: { name: `live${stamp}` } })).json()
  ).session;
  const ua = (
    await (
      await admin.post('/api/users', {
        data: { username: `a${stamp}`, password: 'pass1234', role: 'user' },
      })
    ).json()
  ).user;
  await admin.put(`/api/sessions/${session.id}/grants`, {
    data: { userIds: [ua.id] },
  });
  const a = await asUser(ua.username, 'pass1234');
  try {
    expect((await a.post(`/api/sessions/${session.id}/stop`)).status()).toBe(403);
  } finally {
    await admin.delete(`/api/sessions/${session.id}`).catch(() => undefined);
    await admin.delete(`/api/users/${ua.id}`).catch(() => undefined);
    await a.dispose();
    await admin.dispose();
  }
});

test('two users can share a live session with separate windows', async () => {
  const admin = await asAdmin();
  const stamp = Date.now();
  const session = (
    await (await admin.post('/api/sessions', { data: { name: `share${stamp}` } })).json()
  ).session;
  const ua = (
    await (
      await admin.post('/api/users', {
        data: { username: `sa${stamp}`, password: 'pass1234', role: 'user' },
      })
    ).json()
  ).user;
  const ub = (
    await (
      await admin.post('/api/users', {
        data: { username: `sb${stamp}`, password: 'pass1234', role: 'user' },
      })
    ).json()
  ).user;
  await admin.put(`/api/sessions/${session.id}/grants`, {
    data: { userIds: [ua.id, ub.id] },
  });

  const a = await asUser(ua.username, 'pass1234');
  const b = await asUser(ub.username, 'pass1234');
  try {
    const wa = await a.post(`/api/sessions/${session.id}/windows`, { data: {} });
    if (!wa.ok()) {
      const body = await wa.json().catch(() => ({ error: '' }));
      const err = String((body as { error?: string }).error || '');
      if (/Xauthority|Xvfb|CHROME|chrome/i.test(err)) {
        test.skip(true, 'browser runtime unavailable on this host');
      }
      expect(wa.ok(), err).toBeTruthy();
    }
    const wb = await b.post(`/api/sessions/${session.id}/windows`, { data: {} });
    expect(wb.ok(), await wb.text()).toBeTruthy();

    const live = await admin.get('/api/live');
    expect(live.ok()).toBeTruthy();
    const rows = (await live.json()).sessions;
    const row = rows.find((r: { session: { id: string } }) => r.session.id === session.id);
    expect(row).toBeTruthy();
    expect(row.windows.length).toBeGreaterThanOrEqual(2);

    const otherWin = (await wb.json()).window;
    if (otherWin?.id && otherWin.id !== 'main') {
      expect((await a.delete(`/api/sessions/${session.id}/windows/${otherWin.id}`)).status()).toBe(403);
    }
  } finally {
    await admin.post(`/api/sessions/${session.id}/stop`).catch(() => undefined);
    await admin.delete(`/api/sessions/${session.id}`).catch(() => undefined);
    await admin.delete(`/api/users/${ua.id}`).catch(() => undefined);
    await admin.delete(`/api/users/${ub.id}`).catch(() => undefined);
    await a.dispose();
    await b.dispose();
    await admin.dispose();
  }
});
