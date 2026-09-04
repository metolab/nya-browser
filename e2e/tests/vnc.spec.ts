import { CDPSession, expect, test } from '@playwright/test';
import { ADMIN_PASS, ADMIN_USER, asAdmin, loginDesk, openDeskSession } from '../helpers';

void ADMIN_USER;
void ADMIN_PASS;

type Paint = { ok: boolean; variance: number; width: number; height: number };

const NETWORKS = {
  lan: { latency: 5, downloadThroughput: -1, uploadThroughput: -1 },
  wan: {
    latency: 80,
    downloadThroughput: Math.round((2 * 1024 * 1024) / 8),
    uploadThroughput: Math.round((512 * 1024) / 8),
  },
  slow: {
    latency: 200,
    downloadThroughput: Math.round((400 * 1024) / 8),
    uploadThroughput: Math.round((100 * 1024) / 8),
  },
} as const;

async function probeChrome(admin: Awaited<ReturnType<typeof asAdmin>>, sessionId: string) {
  const win = await admin.post(`/api/sessions/${sessionId}/windows`, { data: {} });
  if (!win.ok()) {
    const err = await win.text();
    if (/Xauthority|Xvfb|CHROME|chrome/i.test(err)) {
      test.skip(true, 'browser runtime unavailable on this host');
    }
    throw new Error(`window create failed: ${err}`);
  }
  const windowId = (await win.json()).window?.id;
  if (windowId) {
    await admin.delete(`/api/sessions/${sessionId}/windows/${windowId}`).catch(() => undefined);
  }
}

async function samplePaint(page: import('@playwright/test').Page): Promise<Paint> {
  return page.evaluate(() => {
    const hold = document.querySelector('.vnc-host canvas.vnc-hold');
    const live = document.querySelector('.vnc-mount:not(.is-pending) canvas');
    const canvas = (hold instanceof HTMLCanvasElement && hold.width >= 8 ? hold : null)
      || (live instanceof HTMLCanvasElement ? live : null)
      || document.querySelector('.vnc-host canvas:not(.vnc-hold)');
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 8 || canvas.height < 8) {
      return { ok: false, variance: 0, width: 0, height: 0 };
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { ok: false, variance: 0, width: canvas.width, height: canvas.height };
    const w = Math.min(canvas.width, 96);
    const h = Math.min(canvas.height, 96);
    const { data } = ctx.getImageData(0, 0, w, h);
    let sum = 0;
    let sum2 = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 16) {
      const v = data[i] + data[i + 1] + data[i + 2];
      sum += v;
      sum2 += v * v;
      n += 1;
    }
    const mean = sum / n;
    const variance = sum2 / n - mean * mean;
    return { ok: variance > 40, variance, width: canvas.width, height: canvas.height };
  });
}

async function waitForPaint(page: import('@playwright/test').Page, timeoutMs = 90000) {
  await page.locator('.vnc-host canvas:not(.vnc-hold)').waitFor({ timeout: timeoutMs });
  const deadline = Date.now() + timeoutMs;
  let last: Paint = { ok: false, variance: 0, width: 0, height: 0 };
  while (Date.now() < deadline) {
    last = await samplePaint(page);
    if (last.ok) return last;
    await page.waitForTimeout(400);
  }
  throw new Error(`VNC canvas stayed blank: ${JSON.stringify(last)}`);
}

async function emulateNetwork(cdp: CDPSession, name: keyof typeof NETWORKS) {
  const profile = NETWORKS[name];
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    connectionType: name === 'lan' ? 'ethernet' : name === 'wan' ? 'wifi' : 'cellular3g',
    ...profile,
  });
}

test.describe('VNC across networks', () => {
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  let sessionId = '';
  let sessionName = '';

  test.beforeAll(async () => {
    const admin = await asAdmin();
    sessionName = `vnc${Date.now()}`;
    const created = await admin.post('/api/sessions', {
      data: { name: sessionName, homeUrl: 'about:blank' },
    });
    if (!created.ok()) {
      await admin.dispose();
      throw new Error(`create session failed: ${created.status()} ${await created.text()}`);
    }
    sessionId = (await created.json()).session.id;
    try {
      await probeChrome(admin, sessionId);
    } finally {
      await admin.dispose();
    }
  });

  test.afterAll(async () => {
    if (!sessionId) return;
    const admin = await asAdmin();
    await admin.post(`/api/sessions/${sessionId}/stop`).catch(() => undefined);
    await admin.delete(`/api/sessions/${sessionId}`).catch(() => undefined);
    await admin.dispose();
  });

  test('LAN first frame is painted and not black', async ({ page }) => {
    await loginDesk(page);
    const sessionPage = await openDeskSession(page, sessionName);
    const cdp = await sessionPage.context().newCDPSession(sessionPage);
    await emulateNetwork(cdp, 'lan');
    const paint = await waitForPaint(sessionPage);
    expect(paint.width).toBeGreaterThan(8);
    expect(paint.height).toBeGreaterThan(8);
    expect(paint.ok).toBeTruthy();
  });

  test('WAN delay keeps a painted frame after scroll', async ({ page }) => {
    await loginDesk(page);
    const sessionPage = await openDeskSession(page, sessionName);
    const cdp = await sessionPage.context().newCDPSession(sessionPage);
    await emulateNetwork(cdp, 'wan');
    await waitForPaint(sessionPage);
    const host = sessionPage.locator('.vnc-host');
    await host.hover();
    await sessionPage.mouse.wheel(0, 600);
    await sessionPage.waitForTimeout(1500);
    const paint = await samplePaint(sessionPage);
    expect(paint.ok, JSON.stringify(paint)).toBeTruthy();
  });

  test('slow link stays connected without a black canvas', async ({ page }) => {
    await loginDesk(page);
    const sessionPage = await openDeskSession(page, sessionName);
    const cdp = await sessionPage.context().newCDPSession(sessionPage);
    await emulateNetwork(cdp, 'slow');
    await waitForPaint(sessionPage, 120000);
    await sessionPage.waitForTimeout(2500);
    expect(sessionPage.getByText('画面连接中断')).toHaveCount(0);
    const paint = await samplePaint(sessionPage);
    expect(paint.ok, JSON.stringify(paint)).toBeTruthy();
  });

  test('same-size resize stays painted', async ({ page }) => {
    await loginDesk(page);
    const sessionPage = await openDeskSession(page, sessionName);
    const paint = await waitForPaint(sessionPage);
    const admin = await asAdmin();
    try {
      const res = await admin.post(`/api/sessions/${sessionId}/display`, {
        data: { width: paint.width, height: paint.height },
      });
      expect(res.ok(), await res.text()).toBeTruthy();
    } finally {
      await admin.dispose();
    }
    await sessionPage.waitForTimeout(800);
    const after = await samplePaint(sessionPage);
    expect(after.ok, JSON.stringify(after)).toBeTruthy();
  });

  test('reconnect keeps a painted frame', async ({ page }) => {
    await loginDesk(page);
    const sessionPage = await openDeskSession(page, sessionName);
    await waitForPaint(sessionPage);
    await sessionPage.evaluate(() => {
      const bag = window as Window & { __nyaVncSockets?: WebSocket[] };
      for (const ws of bag.__nyaVncSockets || []) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    });
    const deadline = Date.now() + 2500;
    let blank = false;
    while (Date.now() < deadline) {
      const snap = await samplePaint(sessionPage);
      if (!snap.ok) blank = true;
      await sessionPage.waitForTimeout(120);
    }
    expect(blank, 'visible surface went fully blank during reconnect').toBeFalsy();
    const paint = await waitForPaint(sessionPage, 60000);
    expect(paint.ok).toBeTruthy();
  });
});
