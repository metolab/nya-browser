import { APIRequestContext, Page, request as pwRequest } from '@playwright/test';

export const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8080';
export const ADMIN_USER = process.env.INIT_ADMIN_USER || 'admin';
export const ADMIN_PASS = process.env.INIT_ADMIN_PASSWORD || process.env.AUTH_PASSWORD || 'testpass';

export async function loginApi(username: string, password: string) {
  const ctx = await pwRequest.newContext({ baseURL: BASE });
  const res = await ctx.post('/api/login', { data: { username, password } });
  return { ctx, res };
}

export async function asUser(username: string, password: string): Promise<APIRequestContext> {
  const { ctx, res } = await loginApi(username, password);
  if (!res.ok()) {
    throw new Error(`login failed ${res.status()} ${await res.text()}`);
  }
  return ctx;
}

export async function asAdmin() {
  return asUser(ADMIN_USER, ADMIN_PASS);
}

export async function loginDesk(page: Page) {
  await page.goto('/');
  await page.getByPlaceholder('用户名').fill(ADMIN_USER);
  await page.getByPlaceholder('密码').fill(ADMIN_PASS);
  await page.getByRole('button', { name: /进\s*入/ }).click();
  await page.locator('.brand').waitFor({ timeout: 15000 });
}

export async function openDeskSession(page: Page, sessionName: string) {
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: sessionName }).click();
  const sessionPage = await popupPromise;
  await sessionPage.waitForLoadState('domcontentloaded');
  return sessionPage;
}
