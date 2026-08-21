import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE || 'http://127.0.0.1:8080';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL,
    extraHTTPHeaders: {},
  },
  reporter: [['list']],
});
