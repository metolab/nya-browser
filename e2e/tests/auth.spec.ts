import { expect, test } from '@playwright/test';
import { ADMIN_PASS, ADMIN_USER, asAdmin, loginApi } from '../helpers';

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

void ADMIN_PASS;
