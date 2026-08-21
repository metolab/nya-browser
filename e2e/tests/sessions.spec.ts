import { expect, test } from '@playwright/test';
import { asAdmin } from '../helpers';

test('session crud description proxy homeUrl assignments', async () => {
  const admin = await asAdmin();
  const stamp = Date.now();
  const proxy = await admin.post('/api/proxies', {
    data: { name: `p${stamp}`, type: 'http', host: '127.0.0.1', port: 9 },
  });
  expect(proxy.status()).toBe(201);
  const proxyId = (await proxy.json()).proxy.id;

  const created = await admin.post('/api/sessions', {
    data: {
      name: `sess${stamp}`,
      description: 'hello',
      proxyId,
      timezone: 'UTC',
      homeUrl: 'https://example.com/',
      idleTimeoutMinutes: 5,
    },
  });
  expect(created.status()).toBe(201);
  const session = (await created.json()).session;
  expect(session.description).toBe('hello');
  expect(session.proxyId).toBe(proxyId);
  expect(session.homeUrl).toContain('example.com');
  expect(session.timezone).toBe('UTC');
  expect(session.idleTimeoutMinutes).toBe(5);

  const user = (
    await (
      await admin.post('/api/users', {
        data: { username: `as${stamp}`, password: 'pass1234', role: 'user' },
      })
    ).json()
  ).user;

  const assigned = await admin.put(`/api/sessions/${session.id}/grants`, {
    data: { userIds: [user.id] },
  });
  expect(assigned.ok()).toBeTruthy();
  const list = (await assigned.json()).grants;
  expect(list[0].userId).toBe(user.id);
  expect(list[0].kind).toBe('session');

  const patched = await admin.patch(`/api/sessions/${session.id}`, {
    data: { description: 'updated', proxyId: null, idleTimeoutMinutes: 0 },
  });
  const patchedSession = (await patched.json()).session;
  expect(patchedSession.proxy.type).toBe('none');
  expect(patchedSession.idleTimeoutMinutes).toBe(0);

  await admin.delete(`/api/sessions/${session.id}`);
  await admin.delete(`/api/users/${user.id}`);
  await admin.delete(`/api/proxies/${proxyId}`);
  await admin.dispose();
});

test('session groups tree crud and assignment', async () => {
  const admin = await asAdmin();
  const stamp = Date.now();
  const root = await admin.post('/api/groups', { data: { name: `客户${stamp}` } });
  expect(root.status()).toBe(201);
  const rootId = (await root.json()).group.id;

  const child = await admin.post('/api/groups', {
    data: { name: `日本${stamp}`, parentId: rootId },
  });
  expect(child.status()).toBe(201);
  const childId = (await child.json()).group.id;

  const listed = await admin.get('/api/groups');
  const groups = (await listed.json()).groups as { id: string; parentId: string | null }[];
  expect(groups.some((g) => g.id === rootId)).toBeTruthy();
  expect(groups.find((g) => g.id === childId)?.parentId).toBe(rootId);

  const created = await admin.post('/api/sessions', {
    data: { name: `gss${stamp}`, groupId: childId },
  });
  expect(created.status()).toBe(201);
  const session = (await created.json()).session;
  expect(session.groupId).toBe(childId);

  const moved = await admin.patch(`/api/sessions/${session.id}`, { data: { groupId: null } });
  expect((await moved.json()).session.groupId).toBeNull();

  await admin.patch(`/api/sessions/${session.id}`, { data: { groupId: rootId } });
  const renamed = await admin.patch(`/api/groups/${rootId}`, { data: { name: `客户改${stamp}` } });
  expect((await renamed.json()).group.name).toContain('客户改');

  await admin.delete(`/api/groups/${rootId}`);
  const after = await admin.get(`/api/sessions`);
  const row = (await after.json()).sessions.find((s: { id: string }) => s.id === session.id);
  expect(row.groupId).toBeNull();
  const leftover = (await (await admin.get('/api/groups')).json()).groups as { id: string; parentId: string | null }[];
  expect(leftover.some((g) => g.id === rootId)).toBeFalsy();
  expect(leftover.find((g) => g.id === childId)?.parentId).toBeNull();

  await admin.delete(`/api/sessions/${session.id}`);
  await admin.delete(`/api/groups/${childId}`);
  await admin.dispose();
});
