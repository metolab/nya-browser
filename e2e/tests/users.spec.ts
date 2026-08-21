import { expect, test } from '@playwright/test';
import { asAdmin } from '../helpers';

test('user crud and disable', async () => {
  const admin = await asAdmin();
  const name = `usr${Date.now()}`;
  const created = await admin.post('/api/users', {
    data: { username: name, password: 'pass1234', role: 'user' },
  });
  expect(created.status()).toBe(201);
  const user = (await created.json()).user;
  expect(user.username).toBe(name);

  const patched = await admin.patch(`/api/users/${user.id}`, { data: { disabled: true } });
  expect(patched.ok()).toBeTruthy();

  const { loginApi, asUser } = await import('../helpers');
  const { res, ctx } = await loginApi(name, 'pass1234');
  expect(res.status()).toBe(401);
  await ctx.dispose();

  await admin.patch(`/api/users/${user.id}`, { data: { disabled: false, password: 'pass5678' } });
  const member = await asUser(name, 'pass5678');
  expect((await member.get('/api/me')).ok()).toBeTruthy();
  await member.dispose();

  expect((await admin.delete(`/api/users/${user.id}`)).ok()).toBeTruthy();
  await admin.dispose();
});
