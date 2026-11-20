import fs from 'fs';
import path from 'path';
import { sessionDir } from '../../store.js';
import { clampDisplayGeom } from '@nya/shared';
import { runXtype, TYPE_TEXT_MAX } from '../xtype.js';
import { bottomInset, chromeFits, DEFAULT_TASKBAR_PX, displayInsets, maximizeChrome, readChromeWindowGeom, sessionTaskbarPx } from './desktopWindows.js';
import { gpuBackend } from './gpu.js';
import { runAsSession, runOnDisplay, sessionEnv } from './isolation.js';
import { childPidAlive, envOn, killTree, sleep } from './proc.js';
import { getSubOrThrow, runtimes, SCREEN_MAX } from './state.js';
import type { DisplayHolder, Geom, SessionRuntime, SubDesktop } from './types.js';

const TASKBAR_BIN = '/usr/bin/tint2';

export const DESKTOP_COLORS = ['#0f3d4c', '#3d1f4c', '#1f4c2e', '#4c2e1f', '#1f2e4c', '#4c1f2e'];

const openboxInsets = new Map<string, number>();

/** Keep openbox margins (_NET_WORKAREA -> screen.availHeight) and tint2 height in step with the session OS. */
export async function applyOsTaskbar(runtime: SessionRuntime) {
  const px = sessionTaskbarPx(runtime.id);
  const holders: DisplayHolder[] = [runtime, ...runtime.subs];
  for (const holder of holders) displayInsets.set(Number(holder.display), px);
  runtime.osTaskbarPx = px;
  const home = sessionDir(runtime.id);
  if (openboxInsets.get(home) === px) {
    for (const holder of holders) ensureTaskbar(runtime, holder);
    return;
  }
  writeDesktopConfig(home, px);
  for (const holder of holders) {
    try {
      await runOnDisplay(holder.display, 'openbox', ['--reconfigure'], 3000);
    } catch {
      /* openbox not up yet; it reads rc.xml on start */
    }
    restartTaskbar(runtime, holder);
  }
}

function writeOpenboxConfig(home: string, bottomMargin = 0) {
  openboxInsets.set(home, bottomMargin);
  const dir = path.join(home, '.config', 'openbox');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'rc.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <margins>
    <top>0</top>
    <bottom>${bottomMargin}</bottom>
    <left>0</left>
    <right>0</right>
  </margins>
  <resistance>
    <strength>10</strength>
    <screen_edge_strength>0</screen_edge_strength>
  </resistance>
  <focus>
    <focusNew>yes</focusNew>
    <followMouse>no</followMouse>
    <raiseOnFocus>yes</raiseOnFocus>
  </focus>
  <theme>
    <name>Clearlooks</name>
    <titleLayout>C</titleLayout>
    <keepBorder>no</keepBorder>
  </theme>
  <desktops>
    <number>1</number>
  </desktops>
  <resize>
    <drawContents>yes</drawContents>
  </resize>
  <keyboard>
    <chainQuit>yes</chainQuit>
    <keybind key="A-Tab">
      <action name="NextWindow">
        <dialog>no</dialog>
        <bar>no</bar>
        <raise>yes</raise>
        <linear>yes</linear>
      </action>
    </keybind>
    <keybind key="A-S-Tab">
      <action name="PreviousWindow">
        <dialog>no</dialog>
        <bar>no</bar>
        <raise>yes</raise>
        <linear>yes</linear>
      </action>
    </keybind>
  </keyboard>
  <mouse>
    <dragThreshold>8192</dragThreshold>
    <!-- Keep Chrome clicks; titlebar bindings stay on decorated windows. -->
    <context name="Titlebar">
      <mousebind button="Left" action="Press"><action name="Focus"/><action name="Raise"/></mousebind>
      <mousebind button="Left" action="Drag"><action name="Move"/></mousebind>
      <mousebind button="Left" action="DoubleClick"><action name="ToggleMaximize"/></mousebind>
    </context>
    <context name="Frame">
      <mousebind button="A-Left" action="Press"><action name="Focus"/><action name="Raise"/></mousebind>
      <mousebind button="A-Left" action="Drag"><action name="Move"/></mousebind>
    </context>
  </mouse>
  <applications>
    <application class="*">
      <decor>no</decor>
      <maximized>no</maximized>
      <layer>normal</layer>
    </application>
    <application class="*hromium*" type="dialog">
      <decor>no</decor>
      <maximized>no</maximized>
      <layer>above</layer>
    </application>
    <application class="*hromium*" type="utility">
      <decor>no</decor>
      <maximized>no</maximized>
      <layer>above</layer>
    </application>
    <application class="tint2">
      <decor>no</decor>
      <layer>above</layer>
      <skip_taskbar>yes</skip_taskbar>
    </application>
  </applications>
</openbox_config>
`,
  );
}

function tint2ConfigPath(home: string) {
  return path.join(home, '.config', 'tint2', 'tint2rc');
}

function taskbarAvailable() {
  try {
    fs.accessSync(TASKBAR_BIN, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function writeTint2Config(home: string, height = DEFAULT_TASKBAR_PX) {
  const dest = tint2ConfigPath(home);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const vPad = height >= 48 ? 6 : height >= 40 ? 5 : 4;
  const taskH = Math.max(24, height - vPad * 2);
  fs.writeFileSync(
    dest,
    `# nya taskbar
rounded = 0
border_width = 0
background_color = #1f2937 100
border_color = #111827 100

rounded = 1
border_width = 0
background_color = #3b82f6 100

rounded = 1
border_width = 0
background_color = #334155 100

panel_items = T
panel_size = 100% ${height}
panel_margin = 0 0
panel_padding = 6 ${vPad} 6
panel_background_id = 1
panel_position = bottom center horizontal
panel_layer = top
panel_dock = 0
strut_policy = none
autohide = 0
wm_menu = 0
panel_window_name = tint2

taskbar_mode = single_desktop
taskbar_padding = 0 0 4
taskbar_name = 0
taskbar_hide_inactive_tasks = 0
taskbar_hide_different_monitor = 0

task_align = left
task_text = 1
task_icon = 1
task_centered = 0
task_maximum_size = 220 ${taskH}
task_padding = 8 3 6
task_font = Noto Sans CJK SC 9
task_font_color = #f8fafc 100
task_active_font_color = #ffffff 100
task_background_id = 3
task_active_background_id = 2
task_mouse_left = toggle
task_mouse_middle = close
task_tooltip = 1

systray_padding = 0
clock_size_font = 0
`,
  );
}

export function writeDesktopConfig(home: string, bottomMargin = DEFAULT_TASKBAR_PX) {
  writeOpenboxConfig(home, bottomMargin);
  writeTint2Config(home, bottomMargin);
}

export function spawnXvfb(runtime: SessionRuntime, display: number, logFile: string) {
  return runAsSession(
    runtime,
    'Xvfb',
    [
      `:${display}`,
      '-screen',
      '0',
      SCREEN_MAX,
      '-nolisten',
      'tcp',
      '-auth',
      runtime.authFile,
      '+extension',
      'RANDR',
      '+extension',
      'XTEST',
      '-s',
      'off',
    ],
    { logFile, env: { DISPLAY: `:${display}` } },
  );
}

export function spawnX11vnc(
  runtime: SessionRuntime,
  home: string,
  opts: { display?: number; vncSock?: string; desktopName?: string; logFile?: string } = {},
) {
  // Unix socket only: other session UIDs cannot attach to this desktop.
  // Do not use -threads: framebuffer resizes and pointer/key injection become unstable.
  // wait/defer coalesce Chrome's clear-then-draw and Tight fill+JPEG into one FBU.
  const display = opts.display ?? runtime.display;
  const sock = opts.vncSock || runtime.vncSock || path.join(home, 'vnc.sock');
  const desktop = opts.desktopName || `nya-${runtime.id}`;
  const logFile = opts.logFile || path.join(home, 'x11vnc.log');
  const gpu = gpuBackend() !== 'swiftshader';
  const waitMs = Number.isFinite(Number(process.env.NYA_VNC_WAIT))
    ? String(Math.max(0, Math.round(Number(process.env.NYA_VNC_WAIT))))
    : gpu ? '5' : '8';
  const deferMs = Number.isFinite(Number(process.env.NYA_VNC_DEFER))
    ? String(Math.max(0, Math.round(Number(process.env.NYA_VNC_DEFER))))
    : gpu ? '6' : '8';
  const args = [
    '-display',
    `:${display}`,
    '-unixsock',
    sock,
    '-rfbport',
    '0',
    '-alwaysshared',
    '-forever',
    '-shared',
    '-repeat',
    '-wait',
    waitMs,
    '-defer',
    deferMs,
    '-ncache',
    '0',
    '-nonap',
    '-nowireframe',
    '-nowirecopyrect',
    '-always_inject',
    '-cursor',
    'arrow',
    '-xkb',
    '-nopw',
    '-xrandr',
    'resize',
    '-desktop',
    desktop,
    '-o',
    logFile,
  ];
  // Xvfb does not emit XDamage for EGL-readback PutImage, so x11vnc keeps
  // serving the last frame until it gives up (~90s). Bookmark bubbles make
  // that look like a freeze. Poll instead on the GPU present path.
  if (gpu || envOn('NYA_VNC_NOXDAMAGE')) {
    args.splice(args.indexOf('-repeat'), 0, '-noxdamage');
  }
  return runAsSession(runtime, 'x11vnc', args, { env: { DISPLAY: `:${display}` } });
}

export async function disableDisplaySleep(display: number) {
  const cmds = [
    ['s', 'off'],
    ['s', 'noblank'],
    ['-dpms'],
    ['s', '0', '0'],
  ];
  for (const args of cmds) {
    try {
      await runOnDisplay(display, 'xset', args, 1500);
    } catch {
      /* Xvfb ignores some xset queries */
    }
  }
}

function logVncResize(payload: Record<string, unknown>) {
  console.log(`[vnc.resize] ${JSON.stringify(payload)}`);
}

export function ensureTaskbar(runtime: SessionRuntime, holder: DisplayHolder) {
  if (runtime.stopping || !taskbarAvailable()) return false;
  if (holder.tint2 && childPidAlive(holder.tint2)) return true;
  const home = sessionDir(runtime.id);
  const height = runtime.osTaskbarPx ?? sessionTaskbarPx(runtime.id);
  writeTint2Config(home, height);
  const logName = holder === runtime ? 'tint2.log' : `tint2-sub-${(holder as SubDesktop).id}.log`;
  holder.tint2 = runAsSession(runtime, TASKBAR_BIN, ['-c', tint2ConfigPath(home)], {
    env: { DISPLAY: `:${holder.display}` },
    logFile: path.join(home, logName),
  });
  return true;
}

function restartTaskbar(runtime: SessionRuntime, holder: DisplayHolder) {
  if (holder.tint2) {
    killTree(holder.tint2, 'SIGTERM');
    holder.tint2 = null;
  }
  ensureTaskbar(runtime, holder);
}

export function syncSessionDesktops(runtime: SessionRuntime) {
  if (runtime.stopping) return;
  ensureTaskbar(runtime, runtime);
  for (const sub of runtime.subs) {
    if (runtime.stopping) return;
    ensureTaskbar(runtime, sub);
  }
}

function parseXrandr(xr: string) {
  const current = String(xr).match(/current\s+(\d+)\s+x\s+(\d+)/i);
  const maximum = String(xr).match(/maximum\s+(\d+)\s+x\s+(\d+)/i);
  let output = '';
  for (const line of String(xr).split('\n')) {
    if (/\bconnected\b/.test(line) && !/\bdisconnected\b/.test(line)) {
      output = line.trim().split(/\s+/)[0];
      break;
    }
  }
  if (!output) {
    for (const line of String(xr).split('\n')) {
      const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s+/);
      if (m && m[1] !== 'Screen') {
        output = m[1];
        break;
      }
    }
  }
  return {
    w: current ? Number(current[1]) : 0,
    h: current ? Number(current[2]) : 0,
    maxW: maximum ? Number(maximum[1]) : 5760,
    maxH: maximum ? Number(maximum[2]) : 3240,
    output: output || 'default',
  };
}

async function readFramebuffer(display: number) {
  const xr = await runOnDisplay(display, 'xrandr', [], 4000);
  return parseXrandr(xr);
}

export async function waitForX(display: number, timeoutMs = 5000) {
  const start = Date.now();
  let lastErr: unknown = null;
  while (Date.now() - start < timeoutMs) {
    try {
      await runOnDisplay(display, 'xrandr', [], 1500);
      return;
    } catch (err) {
      lastErr = err;
      await sleep(150);
    }
  }
  throw lastErr || new Error('X display did not become ready');
}

async function ensureMode(display: number, output: string, modeName: string, ew: number, eh: number, xrText: string) {
  if (new RegExp(`\\b${modeName}\\b`).test(xrText)) return;
  const add = async (args: string[]) => {
    try {
      await runOnDisplay(display, 'xrandr', ['--newmode', modeName, ...args], 4000);
    } catch {
      /* already exists */
    }
    try {
      await runOnDisplay(display, 'xrandr', ['--addmode', output, modeName], 4000);
    } catch {
      /* already added */
    }
  };
  // Xvfb's native mode is 0.00Hz; 0-clock timings are accepted immediately.
  await add(['0', String(ew), '0', '0', '0', String(eh), '0', '0', '0']);
  const check = await runOnDisplay(display, 'xrandr', [], 4000);
  if (new RegExp(`\\b${modeName}\\b`).test(check)) return;
  try {
    const cvtOut = await runOnDisplay(
      display,
      'cvt',
      [String(ew), String(eh), '60'],
      4000,
    );
    const modeline = cvtOut
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.startsWith('Modeline'));
    const m = modeline && modeline.match(/^Modeline\s+"[^"]+"\s+(.+)$/);
    if (m) await add(m[1].trim().split(/\s+/));
  } catch {
    /* keep dummy mode */
  }
}

export async function setFramebuffer(display: number, ew: number, eh: number) {
  const info = await readFramebuffer(display);
  if (info.w === ew && info.h === eh) {
    await disableDisplaySleep(display);
    return info;
  }

  const modeName = `${ew}x${eh}`;
  const xr = await runOnDisplay(display, 'xrandr', [], 4000);
  await ensureMode(display, info.output, modeName, ew, eh, xr);

  const growing = ew > info.w || eh > info.h;
  const tryMode = () =>
    runOnDisplay(
      display,
      'xrandr',
      ['--output', info.output, '--mode', modeName],
      4000,
    );
  const tryFb = () =>
    runOnDisplay(display, 'xrandr', ['--fb', `${ew}x${eh}`], 4000);

  let lastErr: unknown = null;
  if (growing) {
    try {
      await tryFb();
    } catch (err) {
      lastErr = err;
    }
    try {
      await tryMode();
      lastErr = null;
    } catch (err) {
      lastErr = err;
    }
  } else {
    try {
      await tryMode();
      lastErr = null;
    } catch (err) {
      lastErr = err;
      try {
        await tryFb();
        lastErr = null;
      } catch (fbErr) {
        lastErr = fbErr;
      }
    }
  }

  let actual = { w: 0, h: 0 };
  for (let i = 0; i < 12; i += 1) {
    await sleep(50);
    const now = await readFramebuffer(display);
    actual = { w: now.w, h: now.h };
    if (actual.w === ew && actual.h === eh) {
      await disableDisplaySleep(display);
      return now;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error(`display is ${actual.w}x${actual.h}, wanted ${ew}x${eh}`);
}

async function applyDesiredGeom(holder: DisplayHolder): Promise<Geom | undefined> {
  const display = holder.display;
  const want = holder.desiredGeom;
  if (!want) return holder.lastGeom;
  holder.desiredGeom = null;
  const actual = await readFramebuffer(display);
  const chrome = await readChromeWindowGeom(display);
  const fbMatch = actual.w === want.w && actual.h === want.h;
  const panelH = bottomInset(display);
  if (fbMatch && chromeFits(chrome, want.w, want.h, panelH)) {
    holder.lastGeom = { w: want.w, h: want.h };
    logVncResize({
      result: 'noop',
      display,
      want,
      fb: { w: actual.w, h: actual.h },
      chrome,
    });
    if (holder.desiredGeom) return applyDesiredGeom(holder);
    return holder.lastGeom;
  }
  if (fbMatch) {
    await maximizeChrome(display, want.w, want.h, { panelH });
    holder.lastGeom = { w: want.w, h: want.h };
    logVncResize({
      result: 'maximize',
      display,
      want,
      fb: { w: actual.w, h: actual.h },
      chrome,
    });
  } else {
    await setFramebuffer(display, want.w, want.h);
    await maximizeChrome(display, want.w, want.h, { panelH });
    holder.lastGeom = { w: want.w, h: want.h };
    logVncResize({
      result: 'fb',
      display,
      want,
      fb: { w: actual.w, h: actual.h },
      chrome,
    });
  }
  if (holder.desiredGeom) return applyDesiredGeom(holder);
  return holder.lastGeom;
}

function withResizeLock<T>(holder: DisplayHolder, fn: () => Promise<T>) {
  const prev = holder.resizeTail || Promise.resolve();
  const next = prev.then(fn, fn);
  holder.resizeTail = next.catch(() => {});
  return next;
}

/**
 * Resize the X desktop to the viewer pane, then maximize Chrome to fill it.
 * Concurrent calls are serialized and coalesced to the latest size.
 */
export async function resizeDisplay(
  sessionId: string,
  width: number,
  height: number,
  runtimeHint: SessionRuntime | null = null,
  subId: string | null = null,
): Promise<Geom> {
  const runtime = runtimeHint || runtimes.get(sessionId);
  if (!runtime) throw new Error('Session is not running');
  const { w: ew, h: eh } = clampDisplayGeom(width, height);
  const holder: DisplayHolder = subId ? getSubOrThrow(runtime, subId) : runtime;
  holder.desiredGeom = { w: ew, h: eh };
  const geom = await withResizeLock(holder, () => applyDesiredGeom(holder));
  return geom || { w: ew, h: eh };
}

const typeLocks = new Map<number, Promise<unknown>>();

function withTypeLock<T>(display: number, fn: () => Promise<T>) {
  const prev = typeLocks.get(display) || Promise.resolve();
  const next = prev.then(fn, fn);
  typeLocks.set(display, next.catch(() => {}));
  return next;
}

export async function typeText(sessionId: string, text: unknown, subId: string | null = null) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) throw new Error('Session is not running');
  const holder: DisplayHolder = subId ? getSubOrThrow(runtime, subId) : runtime;
  const value = String(text ?? '');
  if (!value) return { ok: true };
  if (value.length > TYPE_TEXT_MAX) throw new Error('Text too long');
  const display = holder.display;
  await withTypeLock(display, () =>
    runXtype(sessionEnv(runtime, { DISPLAY: `:${display}` }), value),
  );
  return { ok: true };
}
