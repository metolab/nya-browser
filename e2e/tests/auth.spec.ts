import { expect, test } from '@playwright/test';
import { ADMIN_PASS, ADMIN_USER, asAdmin, asUser, loginApi } from '../helpers';

test('health', async ({ request }) => {
  const res = await request.get('/api/health');
  expect(res.ok()).toBeTruthy();
});

test('rejects bad password', async () => {
  const { res, ctx } = await loginApi(ADMIN_USER, 'wrong-pass');
  expect(res.status()).toBe(401);
  await ctx.dispose();
});

test('login admin and me', async () => {
  const api = await asAdmin();
  const me = await api.get('/api/me');
  expect(me.ok()).toBeTruthy();
  const body = await me.json();
  expect(body.user.username).toBe(ADMIN_USER);
  expect(body.user.role).toBe('admin');
  await api.dispose();
});

test('unauthenticated api is 401', async ({ request }) => {
  const res = await request.get('/api/sessions');
  expect(res.status()).toBe(401);
});

test('logout', async () => {
  const api = await asAdmin();
  const out = await api.post('/api/logout');
  expect(out.ok()).toBeTruthy();
  const me = await api.get('/api/me');
  expect(me.status()).toBe(401);
  await api.dispose();
});

test('change own password', async () => {
  const admin = await asAdmin();
  const name = `pw${Date.now()}`;
  const created = await admin.post('/api/users', {
    data: { username: name, password: 'pass1234', role: 'user' },
  });
  expect(created.status()).toBe(201);
  const userId = (await created.json()).user.id;
  const member = await asUser(name, 'pass1234');
  expect((await member.post('/api/me/password', { data: { currentPassword: 'wrong', newPassword: 'pass5678' } })).status()).toBe(
    401,
  );
  expect((await member.post('/api/me/password', { data: { currentPassword: 'pass1234', newPassword: 'pass1234' } })).status()).toBe(
    400,
  );
  const changed = await member.post('/api/me/password', {
    data: { currentPassword: 'pass1234', newPassword: 'pass5678' },
  });
  expect(changed.ok()).toBeTruthy();
  expect((await member.get('/api/me')).ok()).toBeTruthy();
  const stale = await loginApi(name, 'pass1234');
  expect(stale.res.status()).toBe(401);
  await stale.ctx.dispose();
  const next = await asUser(name, 'pass5678');
  expect((await next.get('/api/me')).ok()).toBeTruthy();
  await next.dispose();
  await member.dispose();
  expect((await admin.delete(`/api/users/${userId}`)).ok()).toBeTruthy();
  await admin.dispose();
});

void ADMIN_PASS;
