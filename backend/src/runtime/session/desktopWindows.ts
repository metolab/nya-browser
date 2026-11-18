import { getSession } from '../../store.js';
import { coerceOs, coerceWindowsRelease, windowsIdentity } from '@nya/shared';
import { isFileDialogTitle } from '../../modules/files/names.js';
import { runOnDisplay } from './isolation.js';
import { getSubOrThrow, runtimes } from './state.js';
import type { Geom } from './types.js';

export type DesktopWindow = {
  id: string;
  cls: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type: WindowType;
  chrome: boolean;
  switchable: boolean;
  hidden: boolean;
};

type WindowType = 'normal' | 'dialog' | 'utility' | 'dock' | 'desktop' | 'popup';

const CHROME_WM_CLASSES = ['chromium', 'Chromium', 'chromium-browser', 'Chromium-browser'];

/** Bottom work-area inset per X display (Windows taskbar height for emulated sessions). */
export const displayInsets = new Map<number, number>();

export function bottomInset(display: number, panelH = 0) {
  return Math.max(Number(panelH) || 0, displayInsets.get(Number(display)) || 0);
}

export function sessionTaskbarPx(sessionId: string) {
  const fp = getSession(sessionId)?.fingerprint;
  const win = fp ? windowsIdentity(coerceOs(fp.os), coerceWindowsRelease(fp.windowsRelease)) : null;
  return win ? win.taskbarPx : 0;
}

async function xdotoolChromeIds(display: number, timeoutMs = 2500) {
  const ids: string[] = [];
  for (const cls of CHROME_WM_CLASSES) {
    try {
      const idsOut = await runOnDisplay(
        display,
        'xdotool',
        ['search', '--onlyvisible', '--class', cls],
        timeoutMs,
      );
      ids.push(...idsOut.trim().split(/\s+/).filter(Boolean));
      if (ids.length) break;
    } catch {
      /* class not present */
    }
  }
  return [...new Set(ids)];
}

export async function displayHasBrowserWindow(display: number, timeoutMs = 1500) {
  try {
    const wins = await listDesktopWindows(display, timeoutMs);
    return wins.some((w) => w.switchable && w.chrome && w.type === 'normal');
  } catch {
    return Boolean(await findMainChromeWindow(display, timeoutMs));
  }
}

async function restrictChromeWindowControls(display: number, id: string) {
  try {
    await runOnDisplay(display, 'xprop', [
      '-id',
      id,
      '-f',
      '_NET_WM_ALLOWED_ACTIONS',
      '32a',
      '-set',
      '_NET_WM_ALLOWED_ACTIONS',
      '_NET_WM_ACTION_MOVE,_NET_WM_ACTION_RESIZE,_NET_WM_ACTION_MINIMIZE,_NET_WM_ACTION_FULLSCREEN,_NET_WM_ACTION_CLOSE',
    ]);
  } catch {
    /* ignore */
  }
}

const BROWSER_TITLE_SUFFIX = /\s+[-–—]\s+(Google Chrome|Chromium|Chrome)\s*$/i;

function stripBrowserTitleSuffix(title: string) {
  return String(title || '').replace(BROWSER_TITLE_SUFFIX, '').trim();
}

export async function detectFileDialog(sessionId: string, subId: string | null = null) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) return { open: false, title: '' };
  let display = runtime.display;
  if (subId) {
    try {
      display = getSubOrThrow(runtime, subId).display;
    } catch {
      return { open: false, title: '' };
    }
  }
  let out = '';
  try {
    out = await runOnDisplay(display, 'wmctrl', ['-lx'], 800);
  } catch {
    return { open: false, title: '' };
  }
  for (const line of String(out).split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const cls = parts[2] || '';
    const title = parts.slice(4).join(' ');
    if (/portal|gtkfilechooser|xdg-desktop-portal/i.test(cls) || isFileDialogTitle(title)) {
      return { open: true, title: title || 'Open' };
    }
  }
  return { open: false, title: '' };
}

export async function getChromeTitle(sessionId: string, subId: string | null = null) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) return '';
  let display: number;
  try {
    display = subId ? getSubOrThrow(runtime, subId).display : runtime.display;
  } catch {
    return '';
  }
  const id = await findMainChromeWindow(display, 1200);
  if (!id) return '';
  try {
    const name = await runOnDisplay(display, 'xdotool', ['getwindowname', id], 1200);
    return stripBrowserTitleSuffix(name);
  } catch {
    return '';
  }
}

async function windowType(display: number, id: string, timeoutMs = 800): Promise<WindowType> {
  try {
    const out = await runOnDisplay(display, 'xprop', ['-id', id, '_NET_WM_WINDOW_TYPE'], timeoutMs);
    if (/DIALOG/i.test(out)) return 'dialog';
    if (/UTILITY/i.test(out)) return 'utility';
    if (/DOCK/i.test(out)) return 'dock';
    if (/DESKTOP/i.test(out)) return 'desktop';
    if (/MENU|TOOLTIP|NOTIFICATION|DROPDOWN|POPUP|COMBO|SPLASH/i.test(out)) return 'popup';
    return 'normal';
  } catch {
    return 'normal';
  }
}

export async function windowHidden(display: number, id: string, timeoutMs = 800) {
  try {
    const out = await runOnDisplay(display, 'xprop', ['-id', id, '_NET_WM_STATE', 'WM_STATE'], timeoutMs);
    if (/_NET_WM_STATE_HIDDEN/i.test(out)) return true;
    if (/window state:\s*Iconic/i.test(out)) return true;
    return false;
  } catch {
    return false;
  }
}

export async function listDesktopWindows(display: number, timeoutMs = 2000): Promise<DesktopWindow[]> {
  let geomOut = '';
  let classOut = '';
  try {
    [geomOut, classOut] = await Promise.all([
      runOnDisplay(display, 'wmctrl', ['-lG'], timeoutMs),
      runOnDisplay(display, 'wmctrl', ['-lx'], timeoutMs),
    ]);
  } catch {
    return [];
  }
  const byId = new Map<string, Omit<DesktopWindow, 'type' | 'chrome' | 'switchable' | 'hidden'>>();
  for (const line of String(classOut).split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const id = parts[0];
    const cls = parts[2] || '';
    const title = parts.slice(4).join(' ');
    byId.set(id, { id, cls, title, x: 0, y: 0, w: 0, h: 0 });
  }
  for (const line of String(geomOut).split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;
    const id = parts[0];
    const cur = byId.get(id) || { id, cls: '', title: parts.slice(6).join(' '), x: 0, y: 0, w: 0, h: 0 };
    cur.x = Number(parts[2]) || 0;
    cur.y = Number(parts[3]) || 0;
    cur.w = Number(parts[4]) || 0;
    cur.h = Number(parts[5]) || 0;
    byId.set(id, cur);
  }
  const wins: DesktopWindow[] = [];
  for (const win of byId.values()) {
    const cls = String(win.cls || '');
    const title = String(win.title || '');
    if (/tint2/i.test(cls) || /tint2/i.test(title)) continue;
    if (/openbox/i.test(cls)) continue;
    const hidden = await windowHidden(display, win.id, Math.min(800, timeoutMs));
    if (!hidden && win.w > 0 && win.h > 0 && win.w <= 32 && win.h <= 32) continue;
    const type = await windowType(display, win.id, Math.min(800, timeoutMs));
    if (type === 'dock' || type === 'desktop' || type === 'popup') continue;
    const chrome = /chromium|google-chrome|chrome/i.test(cls) || /chromium|chrome/i.test(title);
    const switchable = type === 'normal' || type === 'dialog' || type === 'utility';
    wins.push({ ...win, type, chrome, switchable, hidden });
  }
  return wins;
}

export async function findMainChromeWindow(display: number, timeoutMs = 2500) {
  try {
    const wins = await listDesktopWindows(display, timeoutMs);
    const normals = wins.filter((w) => w.chrome && w.type === 'normal');
    const visible = normals.filter((w) => !w.hidden);
    const pick = visible.length ? visible : normals;
    if (pick.length) {
      pick.sort((a, b) => b.w * b.h - a.w * a.h);
      return pick[0].id;
    }
  } catch {
    /* fall through */
  }
  try {
    const ids = await xdotoolChromeIds(display, timeoutMs);
    for (const id of ids) {
      try {
        const geom = await runOnDisplay(display, 'xdotool', ['getwindowgeometry', id], timeoutMs);
        const m = geom.match(/Geometry:\s+(\d+)x(\d+)/);
        if (m && Number(m[1]) <= 32 && Number(m[2]) <= 32) continue;
      } catch {
        /* keep candidate */
      }
      return id;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function readChromeWindowGeom(display: number): Promise<(Partial<Geom> & { id: string; x?: number; y?: number }) | null> {
  const id = await findMainChromeWindow(display);
  if (!id) return null;
  try {
    const geom = await runOnDisplay(display, 'xdotool', ['getwindowgeometry', id], 1500);
    const size = String(geom).match(/Geometry:\s+(\d+)x(\d+)/);
    const pos = String(geom).match(/Position:\s+(-?\d+),(-?\d+)/);
    if (!size) return { id };
    return {
      id,
      w: Number(size[1]),
      h: Number(size[2]),
      x: pos ? Number(pos[1]) : 0,
      y: pos ? Number(pos[2]) : 0,
    };
  } catch {
    return { id };
  }
}

export function chromeFits(geom: Partial<Geom> | null, w: number, h: number, panelH = 0) {
  if (!geom || !geom.w || !geom.h) return false;
  const targetH = Math.max(40, h - (Number(panelH) || 0));
  return Math.abs(geom.w - w) <= 8 && Math.abs(geom.h - targetH) <= 20;
}

async function extraDesktopWindows(display: number, mainId: string) {
  try {
    const wins = await listDesktopWindows(display);
    return wins.some((w) => w.switchable && w.id !== mainId);
  } catch {
    return false;
  }
}

export async function maximizeChrome(
  display: number,
  width: number,
  height: number,
  opts: { id?: string; panelH?: number; keepStack?: boolean } = {},
) {
  const id = opts.id || (await findMainChromeWindow(display));
  if (!id) return;
  if (await windowHidden(display, id)) return;
  const panelH = bottomInset(display, opts.panelH);
  const keepStack = Boolean(opts.keepStack) || (await extraDesktopWindows(display, id));
  const tryRun = async (file: string, args: string[]) => {
    try {
      await runOnDisplay(display, file, args, 2500);
    } catch {
      /* ignore */
    }
  };
  await restrictChromeWindowControls(display, id);
  await tryRun('wmctrl', ['-i', '-r', id, '-b', 'remove,above']);
  await tryRun('wmctrl', [
    '-i',
    '-r',
    id,
    '-b',
    'remove,maximized_vert,maximized_horz',
  ]);
  const fitH = Math.max(40, height - panelH);
  await tryRun('xdotool', ['windowmove', id, '0', '0']);
  await tryRun('xdotool', ['windowsize', id, String(width), String(fitH)]);
  await tryRun('wmctrl', ['-i', '-r', id, '-e', `0,0,0,${width},${fitH}`]);
  await tryRun('wmctrl', ['-i', '-r', id, '-b', 'add,maximized_vert,maximized_horz']);
  if (!keepStack) {
    await tryRun('xdotool', ['windowraise', id]);
    await tryRun('xdotool', ['windowactivate', id]);
  }
}
