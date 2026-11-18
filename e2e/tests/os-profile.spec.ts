import { expect, test } from '@playwright/test';
import { asAdmin, loginDesk } from '../helpers';

test('session form picks Windows emulation and release', async ({ page }) => {
  const admin = await asAdmin();
  const name = `os-ui-${Date.now()}`;

  await loginDesk(page);
  await page.goto('/admin/sessions');
  await page.getByRole('button', { name: '会话', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: '新建会话' })).toBeVisible();
  await dialog.getByLabel('名称').fill(name);

  await expect(dialog.getByLabel('操作系统')).toHaveCount(0);
  await dialog.getByRole('button', { name: /^高级/ }).click();
  await expect(dialog.getByLabel('操作系统')).toContainText('Windows（伪装）');
  await expect(dialog.getByLabel('Windows 版本')).toContainText('Windows 11');
  await dialog.getByLabel('操作系统').click();
  await page.getByRole('option', { name: 'Linux（真实）' }).click();
  await expect(dialog.getByLabel('Windows 版本')).toHaveCount(0);
  await dialog.getByLabel('操作系统').click();
  await page.getByRole('option', { name: 'Windows（伪装）' }).click();
  await expect(dialog.getByLabel('Windows 版本')).toBeVisible();
  await expect(dialog.getByLabel('字体库')).toHaveCount(0);

  await dialog.getByLabel('Windows 版本').click();
  await page.getByRole('option', { name: 'Windows 10' }).click();

  await dialog.getByRole('button', { name: '创建' }).click();
  await expect(dialog).toHaveCount(0);

  const list = await (await admin.get('/api/sessions')).json();
  const session = (list.sessions || list).find((s: { name: string }) => s.name === name);
  expect(session).toBeTruthy();
  expect(session.fingerprint.os).toBe('windows');
  expect(session.fingerprint.windowsRelease).toBe('win10');

  const toLinux = await admin.patch(`/api/sessions/${session.id}`, { data: { os: 'linux' } });
  expect(toLinux.ok()).toBeTruthy();
  expect((await toLinux.json()).session.fingerprint.os).toBe('linux');

  expect((await admin.delete(`/api/sessions/${session.id}`)).ok()).toBeTruthy();
});
