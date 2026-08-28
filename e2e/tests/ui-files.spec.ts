import { expect, test } from '@playwright/test';
import { ADMIN_PASS, ADMIN_USER, asAdmin } from '../helpers';

test('desk login ui', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('用户名').fill(ADMIN_USER);
  await page.getByPlaceholder('密码').fill(ADMIN_PASS);
  await page.getByRole('button', { name: /进\s*入/ }).click();
  await page.locator('.brand').waitFor({ timeout: 15000 });
  await expect(page.locator('.brand')).toContainText('N');
  await page.locator('.brand').hover();
  await expect(page.getByRole('button', { name: '更多' })).toBeVisible();
  await expect(page.getByRole('button', { name: '结束会话' })).toBeVisible();
  await expect(page.getByRole('button', { name: '退出会话' })).toBeVisible();
  await page.getByRole('button', { name: '更多' }).click();
  await expect(page.getByRole('menuitem', { name: '管理' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '登出' })).toBeVisible();
  await expect(page.getByText('选择会话')).toBeVisible();
});

test('admin console pages render', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('用户名').fill(ADMIN_USER);
  await page.getByPlaceholder('密码').fill(ADMIN_PASS);
  await page.getByRole('button', { name: /进\s*入/ }).click();
  await page.locator('.brand').waitFor({ timeout: 15000 });
  await page.locator('.brand').hover();
  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('menuitem', { name: '管理' }).click();
  await expect(page.getByRole('heading', { name: '会话管理' })).toBeVisible();
  await page.getByRole('link', { name: '用户' }).click();
  await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible();
  await page.getByRole('link', { name: '代理' }).click();
  await expect(page.getByRole('heading', { name: '代理管理' })).toBeVisible();
  await page.getByRole('link', { name: '审计' }).click();
  await expect(page.getByRole('heading', { name: '审计日志' })).toBeVisible();
  await page.getByRole('link', { name: '监控' }).click();
  await expect(page.getByRole('heading', { name: '系统监控' })).toBeVisible();
  await page.getByRole('link', { name: '备份' }).click();
  await expect(page.getByRole('heading', { name: '备份与恢复' })).toBeVisible();
});

test('files mkdir roundtrip', async () => {
  const admin = await asAdmin();
  const created = await admin.post('/api/sessions', { data: { name: `files${Date.now()}` } });
  const id = (await created.json()).session.id;
  const mkdir = await admin.post(`/api/sessions/${id}/files/mkdir`, { data: { path: 'inbox' } });
  expect(mkdir.ok()).toBeTruthy();
  const listed = await admin.get(`/api/sessions/${id}/files?path=.`);
  const entries = (await listed.json()).entries;
  expect(entries.some((e: { name: string }) => e.name === 'inbox')).toBeTruthy();
  await admin.delete(`/api/sessions/${id}`);
  await admin.dispose();
});
