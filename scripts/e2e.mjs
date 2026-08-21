import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import fs from 'fs';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:8080';
const PASSWORD = process.env.AUTH_PASSWORD || 'testpass';
const OUT = '/tmp/nya-e2e';

function dockerExec(args) {
  return execFileSync('docker', ['exec', 'nya-browser', 'bash', '-lc', args], {
    encoding: 'utf8',
    timeout: 20000,
  }).trim();
}

const WM_CLASSES = ['chromium-browser', 'Chromium-browser', 'chromium', 'Chromium'];

function xdotoolChrome(display, rest) {
  const body = WM_CLASSES.map(
    (cls) => `xdotool search --onlyvisible --class ${cls} ${rest} 2>/dev/null`,
  ).join('; ');
  return dockerExec(`DISPLAY=:${display} bash -lc ${JSON.stringify(`${body}; true`)}`);
}

function fail(msg, extra) {
  console.error('E2E FAIL:', msg);
  if (extra) console.error(extra);
  process.exit(1);
}

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
fs.mkdirSync(OUT, { recursive: true });

async function api(path, init = {}) {
  return page.evaluate(
    async ({ path, init }) => {
      const res = await fetch(path, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
        ...init,
      });
      return res.json();
    },
    { path, init },
  );
}

async function pickSession(name) {
  const select = page.locator('.session-select');
  await select.click();
  await select.locator('input').fill(name);
  const option = page.locator('.session-select-dropdown').getByRole('option', { name: new RegExp(name) });
  await option.waitFor();
  await option.click({ force: true });
}

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.getByPlaceholder('访问密码').fill(PASSWORD);
  await page.getByRole('button', { name: /进\s*入/ }).click();
  await page.getByRole('button', { name: /新\s*建/ }).waitFor({ timeout: 10000 });
  console.log('ok login with testpass');

  const stamp = Date.now();
  const nameA = `e2e-a-${stamp}`;
  const nameB = `e2e-b-${stamp}`;
  const none = { type: 'none', host: '', port: null, username: '', password: '' };
  const a = await api('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ name: nameA, proxy: none }),
  });
  const b = await api('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ name: nameB, proxy: none }),
  });
  await api(`/api/sessions/${a.session.id}/start`, { method: 'POST' });
  await api(`/api/sessions/${b.session.id}/start`, { method: 'POST' });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await pickSession(nameA);
  await page.locator('.vnc-root canvas').waitFor({ timeout: 45000 });
  await page.locator('.vnc-dot.on').waitFor({ timeout: 45000 });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${OUT}/connected.png` });
  console.log('ok vnc connected');

  const metrics = await page.evaluate(() => {
    const root = document.querySelector('.vnc-root');
    const canvas = document.querySelector('.vnc-root canvas');
    const stage = document.querySelector('.stage');
    const rail = document.querySelector('.rail');
    const rr = root.getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const lr = rail.getBoundingClientRect();
    return {
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      root: { w: rr.width, h: rr.height, x: rr.x, y: rr.y },
      canvas: { w: cr.width, h: cr.height, x: cr.x, y: cr.y },
      canvasAttr: { w: canvas.width, h: canvas.height },
      stageBottom: sr.bottom,
      railBottom: lr.bottom,
    };
  });
  console.log('metrics', JSON.stringify(metrics, null, 2));

  if (metrics.scrollW > metrics.innerW + 24) fail('page stretched horizontally', metrics);
  if (metrics.scrollH > metrics.innerH + 24) fail('page stretched vertically', metrics);

  const barX = Math.abs(metrics.root.w - metrics.canvas.w);
  const barY = Math.abs(metrics.root.h - metrics.canvas.h);
  if (barX > 2 || barY > 2) fail('black bars around VNC', { barX, barY, metrics });
  console.log('ok layout no stretch / no black bars', { barX, barY });

  if (Math.abs(metrics.stageBottom - metrics.railBottom) > 1) {
    fail('stage and rail bottoms are not aligned', metrics);
  }
  if (metrics.stageBottom > metrics.innerH + 1 || metrics.railBottom > metrics.innerH + 1) {
    fail('stage/rail overflow viewport bottom', metrics);
  }
  console.log('ok stage/rail aligned', {
    stageBottom: metrics.stageBottom,
    railBottom: metrics.railBottom,
  });

  const hudText = await page.locator('.vnc-hud').innerText();
  console.log('hud', hudText.replace(/\n/g, ' | '));
  for (const key of ['延迟', '分辨率', '码率', '丢包', '帧率']) {
    if (!hudText.includes(key)) fail(`HUD missing ${key}`, hudText);
  }
  if (!/\d+\s*ms/.test(hudText)) fail('HUD has no latency ms', hudText);
  if (!/\d+×\d+/.test(hudText)) fail('HUD has no resolution', hudText);
  console.log('ok vnc hud stats');

  const hudBox = await page.locator('.vnc-hud').evaluate((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { pe: cs.pointerEvents, w: r.width, h: r.height };
  });
  if (hudBox.pe !== 'none') fail('HUD still captures pointer events', hudBox);
  if (hudBox.w > 140) fail('HUD is too wide / not a single column', hudBox);
  console.log('ok hud overlay', hudBox);

  await page.getByLabel('更多').waitFor();
  await page.locator('.rail-card').waitFor();
  await page.locator('.file-panel').waitFor();
  console.log('ok rail clipboard/files');

  const canvas = page.locator('.vnc-root canvas');
  await page.keyboard.press('Control+l');
  await page.waitForTimeout(250);
  await page.keyboard.type('data:text/html,<title>WAIT-CLICK</title><h1>ok</h1>', { delay: 12 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);

  const listed0 = await api('/api/sessions');
  const display = listed0.sessions.find((s) => s.id === a.session.id)?.runtime?.display;
  const titleNow = () => xdotoolChrome(display, 'getwindowname %@');
  if (!titleNow().includes('WAIT-CLICK')) fail('did not open WAIT-CLICK via keyboard', titleNow());

  await page.keyboard.press('Control+t');
  await page.waitForTimeout(700);
  if (!titleNow().includes('新标签页') && !titleNow().toLowerCase().includes('tab')) {
    fail('did not open a new tab', titleNow());
  }

  await canvas.click({ position: { x: 72, y: 14 } });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/after-input.png` });
  const titles = titleNow();
  console.log('chrome titles:\n', titles);
  if (!titles.includes('WAIT-CLICK')) {
    fail('left click did not reach Chrome', { titles, display });
  }

  const winGeom = xdotoolChrome(display, 'getwindowgeometry %@');
  const xrandr = dockerExec(`DISPLAY=:${display} xrandr | head -2`);
  console.log('window', winGeom);
  console.log('xrandr', xrandr);
  const screen = xrandr.match(/current\s+(\d+)\s+x\s+(\d+)/);
  const pos = winGeom.match(/Position:\s+(\d+),(\d+)/);
  const size = winGeom.match(/Geometry:\s+(\d+)x(\d+)/);
  if (!screen || !pos || !size) fail('could not parse chrome geometry', { winGeom, xrandr });
  if (Number(pos[1]) > 2 || Number(pos[2]) > 2) fail('chrome not locked at 0,0', { winGeom });
  if (Math.abs(Number(size[1]) - Number(screen[1])) > 2 || Math.abs(Number(size[2]) - Number(screen[2])) > 2) {
    fail('chrome does not fill the screen', { winGeom, xrandr });
  }
  console.log('ok chrome fills screen and stays at origin');

  const wid = xdotoolChrome(display, '').trim().split(/\s+/).find(Boolean);
  const allowed = wid
    ? dockerExec(`DISPLAY=:${display} xprop -id ${wid} _NET_WM_ALLOWED_ACTIONS 2>/dev/null || true`)
    : '';
  console.log('wm actions', allowed);
  if (/ACTION_MINIMIZE|ACTION_MAXIMIZE|ACTION_CLOSE/.test(allowed)) {
    fail('Chrome window still allows minimize/maximize/close', allowed);
  }
  console.log('ok chrome window controls disabled');

  const tabB = page.getByRole('button', { name: /并\s*排/ });
  await tabB.click();
  await page.getByRole('menuitem', { name: new RegExp(`并排 · ${nameB}`) }).click();
  await page.waitForTimeout(1000);
  const afterSplit = await page.locator('.vnc-root').count();
  if (afterSplit !== 2) fail('split did not show two desktops', { afterSplit });

  await page.locator('.vnc-root').nth(1).click();
  await page.waitForTimeout(800);
  const afterFocus = await page.locator('.vnc-root').count();
  if (afterFocus !== 2) fail('split collapsed after focusing the other pane', { afterFocus });

  await pickSession(nameB);
  await page.waitForTimeout(500);
  const afterTab = await page.locator('.vnc-root').count();
  if (afterTab !== 2) fail('split collapsed after selecting the other session', { afterTab });

  await page.screenshot({ path: `${OUT}/split.png` });
  console.log('ok split stays at 2 panes');
  console.log('E2E PASS');
} catch (err) {
  try {
    await page.screenshot({ path: `${OUT}/error.png`, fullPage: true });
  } catch {
    /* ignore */
  }
  fail(err instanceof Error ? err.message : String(err));
} finally {
  await browser.close();
}
