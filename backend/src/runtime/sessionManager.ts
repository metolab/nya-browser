import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AUDIT_ACTIONS, coerceOs, coerceWebrtcMode, webrtcNeedsPublicIp, type ProxyConfig } from '@nya/shared';
import { writeAudit } from '../modules/audit/service.js';
import { ensureSessionDirs, ensureSessionFingerprint, getSession, listSessions, sessionDir } from '../store.js';
import { logChromeCrash } from './chromeCrashLog.js';
import { hasChromeLifecycle, startChromeLifecycle, stopChromeLifecycle } from './chromeLifecycle.js';
import { snapshotSessionPasswords } from './sessionPasswords.js';
import { startSingboxSidecar, stopSingboxSidecar } from './singbox.js';
import {
  CHROME_BIN,
  chromeArgs,
  chromeFontEnv,
  clearChromeLocks,
  sessionHomeUrl,
  writeChromePolicies,
  writeChromePreferences,
} from './session/chromeConfig.js';
import {
  chromeControlSock,
  chromePidAlive,
  createChromeWindowOnDisplay,
  killChromeProfile,
  waitChromeControl,
} from './session/chromeControl.js';
import {
  applyOsTaskbar,
  DESKTOP_COLORS,
  disableDisplaySleep,
  setFramebuffer,
  spawnX11vnc,
  spawnXvfb,
  syncSessionDesktops,
  waitForX,
  writeDesktopConfig,
} from './session/desktop.js';
import { displayHasBrowserWindow, displayInsets, maximizeChrome, sessionTaskbarPx } from './session/desktopWindows.js';
import { gpuBackend } from './session/gpu.js';
import {
  addXauthDisplay,
  allocateSlot,
  allocateSubDisplay,
  applySessionNetFilter,
  chownSessionFiles,
  displayCreds,
  ensureSlotUser,
  ensureX11UnixDir,
  GTK_DISPLAY_SO,
  hardenSessionDirs,
  releaseSlot,
  removeSessionNetFilter,
  runAsSession,
  setDisplayCreds,
  usedSubDisplays,
  writeActiveDisplay,
  writeXauth,
} from './session/isolation.js';
import { childPidAlive, errMsg, killTree, parseWh, sleep, waitUnixSocket } from './session/proc.js';
import {
  DISPLAY_BASE,
  getSubOrThrow,
  LOCAL_PROXY_BASE,
  MAX_SUBS,
  NYA_CDP_BASE,
  runtimes,
  SCREEN_INIT,
} from './session/state.js';
import type { DisplayHolder, Geom, SessionRuntime, SubDesktop } from './session/types.js';
import {
  cdpClientCount,
  getWindow,
  kickVncConnections,
  listWindows,
  newOccupancy,
  onConnectionsChanged,
  ownedWindows,
  releaseMainWindow,
  totalVncConnections,
  withOccupancy,
} from './session/windows.js';

const WINDOW_ENSURE_COOLDOWN_MS = 8000;

async function startLocalProxy(runtime: SessionRuntime, proxy: ProxyConfig) {
  const started = await startSingboxSidecar({
    id: runtime.id,
    proxy,
    listenPort: LOCAL_PROXY_BASE + runtime.slot,
  });
  runtime.singbox = started.handle;
  runtime.localProxyPort = started.port;
}

async function restartLocalProxy(runtime: SessionRuntime, proxy: ProxyConfig) {
  await stopSingboxSidecar(runtime.singbox);
  runtime.singbox = null;
  runtime.localProxyPort = null;
  await startLocalProxy(runtime, proxy);
}

/** Kill a desktop's processes (taskbar, clipboard holder, x11vnc, openbox, Xvfb). */
async function killDesktop(holder: DisplayHolder, graceMs: number, extra: SessionRuntime['chrome'][] = []) {
  if (holder.clipboardHolder) {
    killTree(holder.clipboardHolder, 'SIGKILL');
    holder.clipboardHolder = null;
  }
  holder.clipboardLockUntil = 0;
  if (holder.tint2) {
    killTree(holder.tint2, 'SIGKILL');
    holder.tint2 = null;
  }
  holder.taskbarOn = false;
  holder.taskbarFitted = false;
  const kids = [...extra, holder.x11vnc, holder.openbox, holder.xvfb];
  for (const child of kids) killTree(child, 'SIGTERM');
  await sleep(graceMs);
  for (const child of kids) killTree(child, 'SIGKILL');
  holder.x11vnc = null;
  holder.openbox = null;
  holder.xvfb = null;
}

function unlinkQuiet(file: string) {
  try {
    fs.unlinkSync(file);
  } catch {
    /* ignore */
  }
}

async function ensureChromeWindow(
  runtime: SessionRuntime,
  display: number,
  geom: Geom | undefined,
  opts: { force?: boolean; url?: string } = {},
) {
  if (await displayHasBrowserWindow(display)) return true;
  runtime.windowEnsureAt = runtime.windowEnsureAt || {};
  const key = String(display);
  const now = Date.now();
  if (!opts.force && now - (runtime.windowEnsureAt[key] || 0) < WINDOW_ENSURE_COOLDOWN_MS) {
    return false;
  }
  runtime.windowEnsureAt[key] = now;
  console.log(`[chrome-watch] session=${runtime.id} display=:${display} recreating window`);
  try {
    await createChromeWindowOnDisplay(runtime, display, opts.url);
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (await displayHasBrowserWindow(display)) break;
      await sleep(250);
    }
    const g = geom || runtime.lastGeom || parseWh(SCREEN_INIT);
    await maximizeChrome(display, g.w, g.h);
    return await displayHasBrowserWindow(display);
  } catch (err) {
    console.warn(`[chrome-watch] session=${runtime.id} display=:${display} recreate failed:`, errMsg(err));
    return false;
  }
}

async function restoreSessionWindows(runtime: SessionRuntime, { force = false } = {}) {
  const geom = runtime.lastGeom || parseWh(SCREEN_INIT);
  if (force) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && !(await displayHasBrowserWindow(runtime.display))) {
      await sleep(300);
    }
    await maximizeChrome(runtime.display, geom.w, geom.h);
  }
  await ensureChromeWindow(runtime, runtime.display, geom, { force });
  for (const sub of [...runtime.subs]) {
    if (runtime.stopping || !runtimes.has(runtime.id)) return;
    await ensureChromeWindow(runtime, sub.display, sub.lastGeom || geom, { force });
  }
}

async function startChrome(runtime: SessionRuntime) {
  const session = getSession(runtime.id);
  if (!session) throw new Error('Session not found');
  const fingerprint = ensureSessionFingerprint(runtime.id);
  if (!fingerprint) throw new Error('Failed to persist session fingerprint');
  const startUrl = runtime.launchUrl || sessionHomeUrl(runtime.id);
  runtime.launchUrl = startUrl;
  writeChromePreferences(runtime.id, startUrl);
  await applyOsTaskbar(runtime);
  const chromeEnv = chromeFontEnv(runtime.id, fingerprint);
  chownSessionFiles(runtime.id, runtime);
  const cdpPort = runtime.cdpPort || (NYA_CDP_BASE > 0 ? NYA_CDP_BASE + runtime.slot : null);
  runtime.cdpPort = cdpPort;
  const args = chromeArgs(
    runtime.id,
    runtime.localProxyPort,
    runtime.lastGeom || parseWh(SCREEN_INIT),
    cdpPort,
    fingerprint,
    startUrl,
  );
  const logFile = path.join(sessionDir(runtime.id), 'chrome.log');
  runtime.allowRecover = true;
  runtime.chromeStartedAt = Date.now();
  console.log(`[chrome ${runtime.id}] gpu backend=${gpuBackend()}`);
  const preload = [fs.existsSync(GTK_DISPLAY_SO) ? GTK_DISPLAY_SO : '', process.env.LD_PRELOAD || '']
    .filter(Boolean)
    .join(':');
  runtime.chrome = runAsSession(runtime, CHROME_BIN, args, {
    logFile,
    env: { ...chromeEnv, ...(preload ? { LD_PRELOAD: preload } : {}) },
    onExit: (code, signal) => {
      console.log(`[chrome ${runtime.id}] exited code=${code} signal=${signal}`);
      if (runtime.allowRecover) {
        try {
          logChromeCrash(runtime, code, signal);
        } catch (err) {
          console.error(`[chrome-crash] session=${runtime.id} summary failed:`, errMsg(err));
        }
      }
      runtime.chrome = null;
      stopChromeLifecycle(runtime.id);
      if (runtime.allowRecover && runtimes.has(runtime.id)) {
        scheduleChromeRecover(runtime, signal ? `exit-${signal}` : `exit-${code}`);
      }
    },
  });
  void startChromeLifecycle(runtime.id, cdpPort).catch((err) => {
    console.warn(`[chrome-lifecycle] session=${runtime.id} attach failed:`, errMsg(err));
  });
  if (coerceOs(fingerprint.os) === 'windows') {
    // Windows Chrome runs maximized: no resize borders, inner == outer width.
    // openbox ignores --start-maximized, so maximize once the window maps.
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && runtime.chrome && !(await displayHasBrowserWindow(runtime.display))) {
      await sleep(250);
    }
    const geom = runtime.lastGeom || parseWh(SCREEN_INIT);
    await maximizeChrome(runtime.display, geom.w, geom.h).catch(() => undefined);
  }
}

async function stopChrome(runtime: SessionRuntime) {
  runtime.allowRecover = false;
  stopChromeLifecycle(runtime.id);
  const child = runtime.chrome;
  runtime.chrome = null;
  if (child) {
    killTree(child, 'SIGTERM');
    await sleep(400);
    killTree(child, 'SIGKILL');
  }
  await killChromeProfile(runtime.id);
  await sleep(200);
  clearChromeLocks(runtime.id);
  try {
    snapshotSessionPasswords(runtime.id);
  } catch {
    /* Login Data may be absent on a fresh profile */
  }
}

async function recoverChrome(runtime: SessionRuntime, reason: string) {
  if (!runtimes.has(runtime.id) || runtime.stopping) return;
  console.log(`[chrome-watch] session=${runtime.id} reason=${reason} restarting`);
  try {
    await restartBrowser(runtime.id);
  } catch (err) {
    console.error(`[chrome-watch] session=${runtime.id} restart failed:`, errMsg(err));
  }
}

function scheduleChromeRecover(runtime: SessionRuntime, reason: string) {
  if (runtime.stopping || runtime.recovering) return;
  if (!runtimes.has(runtime.id)) return;
  const now = Date.now();
  if (now - (runtime.lastRecoverAt || 0) < 5000) return;
  runtime.lastRecoverAt = now;
  runtime.recovering = true;
  void recoverChrome(runtime, reason).finally(() => {
    runtime.recovering = false;
  });
}

async function watchChrome(runtime: SessionRuntime) {
  if (runtime.stopping || runtime.recovering || runtime.watchBusy || !runtime.allowRecover) return;
  if (Date.now() - (runtime.chromeStartedAt || 0) < 8000) return;
  runtime.watchBusy = true;
  try {
    if (!chromePidAlive(runtime)) {
      if (runtime.chrome) scheduleChromeRecover(runtime, 'watchdog');
      return;
    }
    if (totalVncConnections(runtime.id) > 0 && !hasChromeLifecycle(runtime.id)) {
      void startChromeLifecycle(runtime.id, runtime.cdpPort).catch(() => {});
    }
    await ensureAllChromeWindows(runtime);
    await syncSessionDesktops(runtime);
  } catch (err) {
    console.warn(`[chrome-watch] session=${runtime.id}`, errMsg(err));
  } finally {
    runtime.watchBusy = false;
  }
}

async function ensureAllChromeWindows(runtime: SessionRuntime) {
  if (!childPidAlive(runtime.xvfb)) {
    console.warn(`[chrome-watch] session=${runtime.id} primary Xvfb is down`);
    return;
  }
  await ensureChromeWindow(runtime, runtime.display, runtime.lastGeom);
  for (const sub of [...runtime.subs]) {
    if (runtime.stopping || runtime.recovering || !runtimes.has(runtime.id)) return;
    if (!childPidAlive(sub.xvfb) || !childPidAlive(sub.openbox) || !childPidAlive(sub.x11vnc)) {
      const now = Date.now();
      if (now - (sub.lastRespawnAt || 0) < WINDOW_ENSURE_COOLDOWN_MS) continue;
      sub.lastRespawnAt = now;
      try {
        await respawnSubDesktop(runtime, sub);
      } catch (err) {
        console.warn(`[chrome-watch] session=${runtime.id} sub=${sub.id} desktop respawn failed:`, errMsg(err));
        continue;
      }
    }
    await ensureChromeWindow(runtime, sub.display, sub.lastGeom);
  }
}

let watchTimer: ReturnType<typeof setInterval> | null = null;

function startChromeWatchdog() {
  if (watchTimer) return;
  watchTimer = setInterval(() => {
    for (const runtime of runtimes.values()) {
      void watchChrome(runtime);
    }
  }, 5000);
  watchTimer.unref();
}

let desktopWatchTimer: ReturnType<typeof setInterval> | null = null;

function startDesktopWatch() {
  if (desktopWatchTimer) return;
  desktopWatchTimer = setInterval(() => {
    for (const runtime of runtimes.values()) {
      if (runtime.stopping) continue;
      void syncSessionDesktops(runtime).catch(() => {});
    }
  }, 1500);
  desktopWatchTimer.unref();
}

/**
 * Start the full desktop stack for a session: slot user, Xvfb, openbox,
 * local proxy and network filter, x11vnc, then Chrome.
 */
export async function startSession(
  sessionId: string,
  { url, ownerUserId }: { url?: string | null; ownerUserId?: string | null } = {},
) {
  const existing = runtimes.get(sessionId);
  if (existing) {
    if (ownerUserId && !existing.mainOwnerUserId) {
      existing.mainOwnerUserId = ownerUserId;
    }
    return getRuntimePublic(sessionId);
  }
  const session = getSession(sessionId);
  if (!session) throw new Error('Session not found');
  const launchUrl = sessionHomeUrl(sessionId, url);

  const slot = allocateSlot();
  const display = DISPLAY_BASE + slot;
  const home = sessionDir(sessionId);
  let runtime: SessionRuntime | null = null;
  try {
    const user = ensureSlotUser(slot);
    ensureSessionDirs(sessionId);
    ensureSessionFingerprint(sessionId);
    writeChromePreferences(sessionId, launchUrl);
    writeDesktopConfig(home, sessionTaskbarPx(sessionId));
    hardenSessionDirs(sessionId, user);
    const authFile = writeXauth(home, display, user.uid, user.gid);
    const vncSock = path.join(home, 'vnc.sock');
    unlinkQuiet(vncSock);
    ensureX11UnixDir();

    const rt: SessionRuntime = {
      id: sessionId,
      slot,
      display,
      vncSock,
      uid: user.uid,
      gid: user.gid,
      userName: user.name,
      authFile,
      localProxyPort: null,
      singbox: null,
      xvfb: null,
      openbox: null,
      chrome: null,
      x11vnc: null,
      tint2: null,
      taskbarOn: false,
      taskbarFitted: false,
      clipboardText: undefined,
      clipboardKind: 'text',
      clipboardFiles: [],
      clipboardHolder: null,
      clipboardLockUntil: 0,
      holdGen: 0,
      cdpPort: NYA_CDP_BASE > 0 ? NYA_CDP_BASE + slot : null,
      startedAt: new Date().toISOString(),
      launchUrl,
      subs: [],
      mainOwnerUserId: ownerUserId || null,
      occupancyId: ownerUserId ? newOccupancy() : null,
    };
    runtime = rt;
    setDisplayCreds(rt);
    rt.xvfb = spawnXvfb(rt, display, path.join(home, 'xvfb.log'));
    await sleep(500);
    await waitForX(display).catch((err) => {
      console.warn(`[display ${sessionId}] X not ready:`, errMsg(err));
    });

    rt.openbox = runAsSession(rt, 'openbox', ['--sm-disable'], {
      logFile: path.join(home, 'openbox.log'),
    });
    await sleep(300);

    const boot = parseWh(SCREEN_INIT);
    try {
      let lastBootErr: unknown = null;
      for (let i = 0; i < 8; i += 1) {
        try {
          await setFramebuffer(display, boot.w, boot.h);
          lastBootErr = null;
          break;
        } catch (err) {
          lastBootErr = err;
          await sleep(250);
        }
      }
      if (lastBootErr) throw lastBootErr;
      rt.lastGeom = { w: boot.w, h: boot.h };
      await disableDisplaySleep(display);
    } catch (err) {
      console.warn(`[display ${sessionId}] boot framebuffer failed:`, errMsg(err));
    }

    await startLocalProxy(rt, session.proxy);
    applySessionNetFilter(rt);

    // Start VNC before Chrome so the session is reachable even while Chrome boots.
    rt.x11vnc = spawnX11vnc(rt, home);
    await waitUnixSocket(vncSock);
    try {
      fs.chmodSync(vncSock, 0o600);
    } catch {
      /* ignore */
    }

    // Distinct root color helps confirm desktops are truly separate.
    runAsSession(rt, 'xsetroot', ['-solid', DESKTOP_COLORS[slot % DESKTOP_COLORS.length]]);

    writeActiveDisplay(rt, display);
    await startChrome(rt);
    await sleep(1000);

    runtimes.set(sessionId, rt);
    syncIdleWatch(sessionId);
    return getRuntimePublic(sessionId);
  } catch (err) {
    if (runtime) {
      await forceCleanupRuntime(runtime);
    }
    releaseSlot(slot);
    throw err;
  }
}

async function forceCleanupRuntime(runtime: SessionRuntime) {
  stopChromeLifecycle(runtime.id);
  removeSessionNetFilter(runtime);
  displayCreds.delete(runtime.display);
  await stopAllSubs(runtime);
  const chrome = runtime.chrome;
  runtime.chrome = null;
  await killDesktop(runtime, 400, [chrome]);
  await killChromeProfile(runtime.id);
  if (runtime.vncSock) unlinkQuiet(runtime.vncSock);
  unlinkQuiet(chromeControlSock(runtime.id));
  if (runtime.singbox) {
    try {
      await stopSingboxSidecar(runtime.singbox);
    } catch {
      /* ignore */
    }
    runtime.singbox = null;
  }
}

export async function stopSession(sessionId: string) {
  clearIdleWatch(sessionId);
  const runtime = runtimes.get(sessionId);
  if (!runtime) return false;
  runtime.stopping = true;
  runtime.allowRecover = false;
  runtimes.delete(sessionId);
  await forceCleanupRuntime(runtime);
  releaseSlot(runtime.slot);
  return true;
}

export async function restartBrowser(sessionId: string, { url }: { url?: string | null } = {}) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) throw new Error('Session is not running');
  const session = getSession(sessionId);
  if (!session) throw new Error('Session not found');
  if (url) runtime.launchUrl = sessionHomeUrl(sessionId, url);

  runtime.recovering = true;
  runtime.allowRecover = false;
  try {
    await stopChrome(runtime);
    await startChrome(runtime);
    await waitChromeControl(sessionId);
    await restoreSessionWindows(runtime, { force: true });
    return getRuntimePublic(sessionId);
  } finally {
    runtime.recovering = false;
  }
}

/** Restart running sessions whose WebRTC mode embeds the exit IP of `proxyId`. */
export async function restartSessionsForProxyExitIp(proxyId: string) {
  if (!proxyId) return;
  for (const session of listSessions()) {
    if (session.proxyId !== proxyId) continue;
    if (!webrtcNeedsPublicIp(coerceWebrtcMode(session.fingerprint?.webrtcMode))) continue;
    if (!runtimes.has(session.id)) continue;
    await restartBrowser(session.id).catch(() => undefined);
  }
}

export async function applyProxy(sessionId: string, proxyInput?: ProxyConfig | null) {
  const session = getSession(sessionId);
  if (!session) throw new Error('Session not found');
  const runtime = runtimes.get(sessionId);
  if (runtime) {
    await restartLocalProxy(runtime, proxyInput || session.proxy);
    applySessionNetFilter(runtime);
    await restartBrowser(sessionId);
  }
  return getSession(sessionId);
}

async function stopSubInternal(runtime: SessionRuntime, sub: SubDesktop) {
  await killDesktop(sub, 250);
  if (sub.vncSock) unlinkQuiet(sub.vncSock);
  displayCreds.delete(sub.display);
  usedSubDisplays.delete(sub.display);
  if (runtime.activeDisplay === sub.display) writeActiveDisplay(runtime, runtime.display);
  runtime.subs = runtime.subs.filter((s) => s.id !== sub.id);
}

async function stopAllSubs(runtime: SessionRuntime) {
  for (const sub of [...runtime.subs]) {
    await stopSubInternal(runtime, sub);
  }
  runtime.subs = [];
}

async function spawnSubDesktop(runtime: SessionRuntime, sub: SubDesktop) {
  const home = sessionDir(runtime.id);
  const display = sub.display;
  setDisplayCreds(runtime, display);
  ensureX11UnixDir();
  if (sub.vncSock) unlinkQuiet(sub.vncSock);

  sub.xvfb = spawnXvfb(runtime, display, path.join(home, `xvfb-sub-${sub.id}.log`));
  await sleep(400);
  await waitForX(display).catch((err) => {
    console.warn(`[sub ${runtime.id}/${sub.id}] X not ready:`, errMsg(err));
  });

  displayInsets.set(display, runtime.osTaskbarPx || 0);
  sub.openbox = runAsSession(runtime, 'openbox', ['--sm-disable'], {
    logFile: path.join(home, `openbox-sub-${sub.id}.log`),
    env: { DISPLAY: `:${display}` },
  });
  await sleep(250);

  const boot = sub.lastGeom || parseWh(SCREEN_INIT);
  try {
    await setFramebuffer(display, boot.w, boot.h);
    sub.lastGeom = { w: boot.w, h: boot.h };
  } catch (err) {
    console.warn(`[sub ${runtime.id}/${sub.id}] boot framebuffer failed:`, errMsg(err));
  }

  sub.x11vnc = spawnX11vnc(runtime, home, {
    display,
    vncSock: sub.vncSock,
    desktopName: `nya-${runtime.id}-${sub.id}`,
    logFile: path.join(home, `x11vnc-sub-${sub.id}.log`),
  });
  await waitUnixSocket(sub.vncSock);
  try {
    fs.chmodSync(sub.vncSock, 0o600);
  } catch {
    /* ignore */
  }

  runAsSession(runtime, 'xsetroot', ['-solid', DESKTOP_COLORS[(runtime.slot + 1) % DESKTOP_COLORS.length]], {
    env: { DISPLAY: `:${display}` },
  });
}

async function respawnSubDesktop(runtime: SessionRuntime, sub: SubDesktop) {
  console.log(`[chrome-watch] session=${runtime.id} sub=${sub.id} respawning desktop :${sub.display}`);
  await killDesktop(sub, 250);
  await spawnSubDesktop(runtime, sub);
}

/** Open an extra desktop with its own browser window. */
export async function createSub(
  sessionId: string,
  url?: string | null,
  { ownerUserId }: { ownerUserId?: string | null } = {},
) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) throw new Error('Session is not running');
  if (runtime.subs.length >= MAX_SUBS) {
    throw new Error(`At most ${MAX_SUBS} extra desktops per session`);
  }

  const home = sessionDir(sessionId);
  const subId = crypto.randomBytes(4).toString('hex');
  const display = allocateSubDisplay();
  addXauthDisplay(runtime.authFile, display, runtime.uid, runtime.gid, home);
  ensureX11UnixDir();

  const geom = parseWh(SCREEN_INIT);
  const sub: SubDesktop = {
    id: subId,
    display,
    vncSock: path.join(home, `vnc-sub-${subId}.sock`),
    xvfb: null,
    openbox: null,
    x11vnc: null,
    lastGeom: geom,
    clipboardText: undefined,
    clipboardKind: 'text',
    clipboardFiles: [],
    clipboardHolder: null,
    clipboardLockUntil: 0,
    holdGen: 0,
    tint2: null,
    taskbarOn: false,
    taskbarFitted: false,
    ownerUserId: ownerUserId || null,
    occupancyId: ownerUserId ? newOccupancy() : null,
  };

  try {
    await spawnSubDesktop(runtime, sub);
    await createChromeWindowOnDisplay(runtime, display, url);
    for (let i = 0; i < 20; i += 1) {
      if (await displayHasBrowserWindow(display, 2000)) break;
      await sleep(300);
    }
    const fit = sub.lastGeom || geom;
    await maximizeChrome(display, fit.w, fit.h);

    runtime.subs.push(sub);
    return {
      id: sub.id,
      kind: 'sub' as const,
      display: sub.display,
      running: true,
      ownerUserId: sub.ownerUserId,
      occupancyId: sub.occupancyId,
    };
  } catch (err) {
    await stopSubInternal(runtime, sub);
    throw err;
  }
}

export async function stopSub(sessionId: string, subId: string) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) throw new Error('Session is not running');
  await stopSubInternal(runtime, getSubOrThrow(runtime, subId));
  return true;
}

export function getRuntimePublic(sessionId: string) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) return null;
  return {
    running: true,
    display: runtime.display,
    hasProxy: Boolean(runtime.localProxyPort),
    cdpPort: runtime.cdpPort || null,
    cdpClients: cdpClientCount(sessionId),
    startedAt: runtime.startedAt,
    windows: listWindows(sessionId),
    subs: runtime.subs.map((sub) => ({
      id: sub.id,
      display: sub.display,
      running: Boolean(sub.xvfb),
      ownerUserId: sub.ownerUserId,
    })),
  };
}

const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearIdleWatch(sessionId: string) {
  const timer = idleTimers.get(sessionId);
  if (!timer) return;
  clearTimeout(timer);
  idleTimers.delete(sessionId);
}

/** (Re)arm the idle-stop timer: a session with no VNC or CDP client stops after its idle timeout. */
export function syncIdleWatch(sessionId: string) {
  clearIdleWatch(sessionId);
  const runtime = runtimes.get(sessionId);
  if (!runtime || runtime.stopping) return;
  const minutes = Number(getSession(sessionId)?.idleTimeoutMinutes) || 0;
  if (minutes <= 0) {
    runtime.idleSince = null;
    return;
  }
  if (totalVncConnections(sessionId) > 0) {
    runtime.idleSince = null;
    return;
  }
  if (!runtime.idleSince) runtime.idleSince = Date.now();
  const remain = minutes * 60 * 1000 - (Date.now() - runtime.idleSince);
  const timer = setTimeout(() => {
    idleTimers.delete(sessionId);
    void stopIdleSession(sessionId);
  }, Math.max(0, remain));
  idleTimers.set(sessionId, timer);
}

async function stopIdleSession(sessionId: string) {
  const runtime = runtimes.get(sessionId);
  if (!runtime || runtime.stopping) return;
  if (totalVncConnections(sessionId) > 0) {
    syncIdleWatch(sessionId);
    return;
  }
  const minutes = Number(getSession(sessionId)?.idleTimeoutMinutes) || 0;
  if (minutes <= 0) return;
  const since = runtime.idleSince || 0;
  if (Date.now() - since < minutes * 60 * 1000 - 100) {
    syncIdleWatch(sessionId);
    return;
  }
  console.log(`[idle] session=${sessionId} no VNC/CDP clients for ${minutes}m, stopping`);
  writeAudit({
    action: AUDIT_ACTIONS.sessionStop,
    resourceType: 'session',
    resourceId: sessionId,
    success: true,
    detail: { reason: 'idle_timeout', idleTimeoutMinutes: minutes },
  });
  await stopSession(sessionId);
}

/** Keep one window a user owns (closing the rest), with a fresh occupancy that kicks other viewers. */
export async function takeoverOwnedWindow(sessionId: string, userId: string) {
  const owned = ownedWindows(sessionId, userId);
  if (!owned.length) return null;
  const keep = owned[0];
  for (const extra of owned.slice(1)) {
    if (extra.id === 'main') releaseMainWindow(sessionId, userId, true);
    else await stopSub(sessionId, extra.id);
  }
  const occ = newOccupancy();
  const runtime = runtimes.get(sessionId);
  if (!runtime) return null;
  if (keep.id === 'main') runtime.occupancyId = occ;
  else getSubOrThrow(runtime, keep.id).occupancyId = occ;
  kickVncConnections(sessionId, keep.id === 'main' ? null : keep.id);
  return withOccupancy(sessionId, getWindow(sessionId, keep.id));
}

/** Stop a session nobody owns or drives any more. */
export async function maybeStopIdle(sessionId: string) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) return false;
  if (runtime.mainOwnerUserId || runtime.subs.length > 0 || cdpClientCount(sessionId) > 0) return false;
  await stopSession(sessionId);
  return true;
}

export function getRuntimePids(sessionId: string) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) return null;
  return {
    chrome: runtime.chrome?.pid || null,
    xvfb: runtime.xvfb?.pid || null,
    openbox: runtime.openbox?.pid || null,
    x11vnc: runtime.x11vnc?.pid || null,
    tint2: runtime.tint2?.pid || null,
    singbox: runtime.singbox?.child.pid || null,
    subs: runtime.subs.map((sub) => ({
      id: sub.id,
      xvfb: sub.xvfb?.pid || null,
      openbox: sub.openbox?.pid || null,
      x11vnc: sub.x11vnc?.pid || null,
      tint2: sub.tint2?.pid || null,
    })),
  };
}

export async function stopAllSessions() {
  for (const id of [...runtimes.keys()]) {
    await stopSession(id);
  }
}

onConnectionsChanged(syncIdleWatch);
writeChromePolicies();
startChromeWatchdog();
startDesktopWatch();

export { detectFileDialog, getChromeTitle } from './session/desktopWindows.js';
export { resizeDisplay, typeText } from './session/desktop.js';
export { chownSessionFiles, markActiveDisplay, sessionEnv } from './session/isolation.js';
export { killTree } from './session/proc.js';
export {
  assertSessionRuntime,
  getDisplayHolder,
  getRuntime,
  getSubRuntime,
  listRunningIds,
} from './session/state.js';
export {
  canAccessWindow,
  cdpClientCount,
  claimMainWindow,
  getWindow,
  getWindowOccupancy,
  listWindows,
  ownedWindows,
  registerCdpClient,
  registerVncClient,
  releaseMainWindow,
} from './session/windows.js';
