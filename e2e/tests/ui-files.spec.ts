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
  await expect(page.getByRole('menuitem', { name: '修改密码' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '管理' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '登出' })).toBeVisible();
  await page.getByRole('menuitem', { name: '修改密码' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: '修改密码' })).toBeVisible();
  await expect(page.getByLabel('当前密码')).toBeVisible();
  await expect(page.getByLabel('新密码', { exact: true })).toBeVisible();
  await expect(page.getByLabel('确认新密码')).toBeVisible();
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

test('files upload unique name and transfer lists', async () => {
  const admin = await asAdmin();
  const created = await admin.post('/api/sessions', { data: { name: `upl${Date.now()}` } });
  const id = (await created.json()).session.id;
  const payload = Buffer.from('hello-files');
  const first = await admin.post(`/api/sessions/${id}/files/upload?dir=.`, {
    multipart: {
      files: {
        name: 'note.txt',
        mimeType: 'text/plain',
        buffer: payload,
      },
    },
  });
  expect(first.ok()).toBeTruthy();
  const again = await admin.post(`/api/sessions/${id}/files/upload?dir=.`, {
    multipart: {
      files: {
        name: 'note.txt',
        mimeType: 'text/plain',
        buffer: payload,
      },
    },
  });
  const uploaded = await again.json();
  expect(uploaded.files[0].name).toBe('note (1).txt');
  const uploads = await admin.get(`/api/sessions/${id}/files/uploads`);
  const names = ((await uploads.json()).uploads as { name: string }[]).map((row) => row.name);
  expect(names).toContain('note.txt');
  expect(names).toContain('note (1).txt');
  const transfer = await admin.get(`/api/sessions/${id}/files/transfer`);
  expect(transfer.ok()).toBeTruthy();
  const body = await transfer.json();
  expect(Array.isArray(body.uploads)).toBeTruthy();
  expect(Array.isArray(body.downloads)).toBeTruthy();
  expect(body.chooser === null || typeof body.chooser.open === 'boolean').toBeTruthy();
  const clipFiles = await admin.post(`/api/sessions/${id}/clipboard/files`, {
    data: { paths: [uploaded.files[0].path] },
  });
  expect(clipFiles.status()).toBeGreaterThanOrEqual(400);
  await admin.delete(`/api/sessions/${id}`);
  await admin.dispose();
});

test('change password from more menu', async ({ page }) => {
  const admin = await asAdmin();
  const name = `pwu${Date.now()}`;
  const created = await admin.post('/api/users', {
    data: { username: name, password: 'pass1234', role: 'user' },
  });
  expect(created.status()).toBe(201);
  const userId = (await created.json()).user.id;
  await admin.dispose();

  await page.goto('/');
  await page.getByPlaceholder('用户名').fill(name);
  await page.getByPlaceholder('密码').fill('pass1234');
  await page.getByRole('button', { name: /进\s*入/ }).click();
  await page.locator('.brand').waitFor({ timeout: 15000 });
  await page.locator('.brand').hover();
  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('menuitem', { name: '修改密码' }).click();
  await page.getByLabel('当前密码').fill('pass1234');
  await page.getByLabel('新密码', { exact: true }).fill('pass5678');
  await page.getByLabel('确认新密码').fill('pass5678');
  await page.getByRole('button', { name: '保存' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.locator('.brand')).toBeVisible();

  await page.locator('.brand').hover();
  await page.getByRole('button', { name: '更多' }).click();
  await page.getByRole('menuitem', { name: '登出' }).click();
  await page.getByPlaceholder('用户名').fill(name);
  await page.getByPlaceholder('密码').fill('pass5678');
  await page.getByRole('button', { name: /进\s*入/ }).click();
  await page.locator('.brand').waitFor({ timeout: 15000 });

  const cleanup = await asAdmin();
  await cleanup.delete(`/api/users/${userId}`);
  await cleanup.dispose();
});
