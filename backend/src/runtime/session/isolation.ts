import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile, execFileSync, type ExecFileOptions } from 'child_process';
import { ensureSessionDirs, getSession, sessionDir, sessionLocaleSettings } from '../../store.js';
import { posixLocale, resolveSessionLocale } from '@nya/shared';
import { DATA_DIR } from '../../config.js';
import { sessionLocale } from '../locale.js';
import { errMsg, run, type RunOptions } from './proc.js';
import { runtimes, SLOT_UID_BASE, SUB_DISPLAY_BASE } from './state.js';
import type { DisplayCreds, SessionRuntime } from './types.js';

export type SlotUser = { name: string; uid: number; gid: number };

const usedSlots = new Set<number>();
export const usedSubDisplays = new Set<number>();
export const displayCreds = new Map<number, DisplayCreds>();

export function allocateSlot() {
  for (let i = 0; i < 1000; i += 1) {
    if (!usedSlots.has(i)) {
      usedSlots.add(i);
      return i;
    }
  }
  throw new Error('No free display slots');
}

export function releaseSlot(slot: number) {
  usedSlots.delete(slot);
}

export function allocateSubDisplay() {
  for (let i = 0; i < 5000; i += 1) {
    const d = SUB_DISPLAY_BASE + i;
    if (!usedSubDisplays.has(d) && !displayCreds.has(d)) {
      usedSubDisplays.add(d);
      return d;
    }
  }
  throw new Error('No free sub display');
}

function stderrOf(err: unknown) {
  const stderr = (err as { stderr?: Buffer | string } | null)?.stderr;
  return stderr ? stderr.toString() : '';
}

function iptables(args: string[]) {
  try {
    execFileSync('iptables', ['-w', '5', ...args], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function ip6tables(args: string[]) {
  try {
    execFileSync('ip6tables', ['-w', '5', ...args], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function netChainName(slot: number) {
  return `NYA${slot}`;
}

/**
 * Per-session OUTPUT chain for the session uid: loopback is closed except the
 * local proxy and CDP port, a proxied session reaches nothing else at all, and
 * IPv6 is rejected. Re-run it whenever the session's proxy changes.
 */
export function applySessionNetFilter(runtime: SessionRuntime) {
  if (!Number.isInteger(runtime.uid)) return;
  const chain = netChainName(runtime.slot);
  const uid = String(runtime.uid);
  // Hold the uid closed while the chain is rebuilt under a live browser.
  const guard = ['-m', 'owner', '--uid-owner', uid, '-j', 'REJECT', '--reject-with', 'icmp-port-unreachable'];
  const guarded = iptables(['-I', 'OUTPUT', '1', ...guard]);
  iptables(['-D', 'OUTPUT', '-m', 'owner', '--uid-owner', uid, '-j', chain]);
  iptables(['-N', chain]);
  iptables(['-F', chain]);
  // Docker embedded DNS must stay reachable.
  iptables(['-A', chain, '-d', '127.0.0.11', '-j', 'RETURN']);
  if (runtime.localProxyPort) {
    iptables([
      '-A',
      chain,
      '-p',
      'tcp',
      '-d',
      '127.0.0.1',
      '--dport',
      String(runtime.localProxyPort),
      '-j',
      'RETURN',
    ]);
  }
  if (runtime.cdpPort) {
    iptables([
      '-A',
      chain,
      '-p',
      'tcp',
      '-d',
      '127.0.0.1',
      '--sport',
      String(runtime.cdpPort),
      '-j',
      'RETURN',
    ]);
  }
  iptables([
    '-A',
    chain,
    '-d',
    '127.0.0.0/8',
    '-j',
    'REJECT',
    '--reject-with',
    'icmp-port-unreachable',
  ]);
  if (runtime.localProxyPort && runtime.proxy.type !== 'none') {
    // A proxied session reaches the network only through its local proxy:
    // direct packets (WebRTC STUN and ICE checks over UDP) carry the host address.
    iptables(['-A', chain, '-j', 'REJECT', '--reject-with', 'icmp-port-unreachable']);
  }
  const jumped = iptables([
    '-I',
    'OUTPUT',
    '1',
    '-m',
    'owner',
    '--uid-owner',
    uid,
    '-j',
    chain,
  ]);
  if (guarded) iptables(['-D', 'OUTPUT', ...guard]);
  if (!jumped) {
    console.warn(
      `[net-filter] session=${runtime.id} uid=${uid} network isolation skipped (need NET_ADMIN)`,
    );
  }

  ip6tables(['-D', 'OUTPUT', '-m', 'owner', '--uid-owner', uid, '-j', chain]);
  ip6tables(['-N', chain]);
  ip6tables(['-F', chain]);
  // Docker IPv6 is often a black hole; reject all so Chrome does not stall on AAAA.
  ip6tables(['-A', chain, '-j', 'REJECT', '--reject-with', 'icmp6-port-unreachable']);
  ip6tables(['-I', 'OUTPUT', '1', '-m', 'owner', '--uid-owner', uid, '-j', chain]);
}

export function removeSessionNetFilter(runtime: SessionRuntime) {
  if (!Number.isInteger(runtime.uid) || runtime.slot == null) return;
  const chain = netChainName(runtime.slot);
  const uid = String(runtime.uid);
  iptables(['-D', 'OUTPUT', '-m', 'owner', '--uid-owner', uid, '-j', chain]);
  iptables(['-F', chain]);
  iptables(['-X', chain]);
  ip6tables(['-D', 'OUTPUT', '-m', 'owner', '--uid-owner', uid, '-j', chain]);
  ip6tables(['-F', chain]);
  ip6tables(['-X', chain]);
}

export function ensureSlotUser(slot: number): SlotUser {
  const name = `nyas${slot}`;
  const uid = SLOT_UID_BASE + slot;
  const gid = uid;
  try {
    execFileSync('groupadd', ['-f', '-g', String(gid), name], { stdio: 'pipe' });
  } catch (err) {
    const msg = stderrOf(err) || errMsg(err);
    if (!/already exists/i.test(msg)) {
      console.warn(`[user] groupadd ${name}: ${msg.trim()}`);
    }
  }
  let existing = '';
  try {
    existing = execFileSync('getent', ['passwd', name], { encoding: 'utf8' }).trim();
  } catch {
    existing = '';
  }
  if (!existing) {
    execFileSync(
      'useradd',
      [
        '-M',
        '-N',
        '-u',
        String(uid),
        '-g',
        String(gid),
        '-s',
        '/usr/sbin/nologin',
        '-d',
        '/nonexistent',
        name,
      ],
      { stdio: 'pipe' },
    );
  }
  return { name, uid, gid };
}

function chownTree(dir: string, uid: number, gid: number) {
  try {
    fs.lchownSync(dir, uid, gid);
  } catch {
    return;
  }
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      chownTree(child, uid, gid);
      continue;
    }
    try {
      fs.lchownSync(child, uid, gid);
    } catch {
      /* ignore */
    }
  }
}

export function chownSessionFiles(sessionId: string, runtimeHint: SessionRuntime | null = null) {
  const runtime = runtimeHint || runtimes.get(sessionId);
  if (!runtime || !Number.isInteger(runtime.uid)) return;
  const dir = sessionDir(sessionId);
  chownTree(dir, runtime.uid, runtime.gid);
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* ignore */
  }
}

export function hardenSessionDirs(sessionId: string, user: SlotUser) {
  const sessionsRoot = path.join(DATA_DIR, 'sessions');
  const storePath = path.join(DATA_DIR, 'sessions.json');
  fs.mkdirSync(sessionsRoot, { recursive: true });
  try {
    fs.chmodSync(DATA_DIR, 0o755);
  } catch {
    /* ignore */
  }
  try {
    fs.chmodSync(sessionsRoot, 0o711);
  } catch {
    /* ignore */
  }
  try {
    fs.chmodSync(storePath, 0o600);
  } catch {
    /* ignore */
  }
  ensureSessionDirs(sessionId);
  fs.mkdirSync(path.join(sessionDir(sessionId), 'tmp'), { recursive: true });
  chownTree(sessionDir(sessionId), user.uid, user.gid);
  fs.chmodSync(sessionDir(sessionId), 0o700);
}

function xauthAdd(authFile: string, display: number, home: string) {
  const cookie = crypto.randomBytes(16).toString('hex');
  const names = [
    `:${display}`,
    `unix:${display}`,
    `localhost/unix:${display}`,
    `${os.hostname()}/unix:${display}`,
  ];
  for (const name of names) {
    try {
      execFileSync('xauth', ['-f', authFile, 'add', name, '.', cookie], {
        env: { ...process.env, HOME: home, XAUTHORITY: authFile },
        stdio: 'pipe',
      });
    } catch (err) {
      console.warn(`[xauth] add ${name}: ${stderrOf(err) || errMsg(err)}`);
    }
  }
}

/** A fresh Xauthority holding only a cookie for `display`. */
export function writeXauth(home: string, display: number, uid: number, gid: number) {
  const authFile = path.join(home, '.Xauthority');
  try {
    fs.unlinkSync(authFile);
  } catch {
    /* ignore */
  }
  xauthAdd(authFile, display, home);
  if (!fs.existsSync(authFile)) {
    throw new Error('Failed to write Xauthority');
  }
  fs.chownSync(authFile, uid, gid);
  fs.chmodSync(authFile, 0o600);
  return authFile;
}

export function addXauthDisplay(authFile: string, display: number, uid: number, gid: number, home: string) {
  xauthAdd(authFile, display, home);
  try {
    fs.chownSync(authFile, uid, gid);
    fs.chmodSync(authFile, 0o600);
  } catch {
    /* ignore */
  }
}

export function ensureX11UnixDir() {
  try {
    fs.mkdirSync('/tmp/.X11-unix', { recursive: true });
    fs.chmodSync('/tmp/.X11-unix', 0o1777);
  } catch {
    /* ignore */
  }
}

export const GTK_DISPLAY_SO = process.env.NYA_GTK_DISPLAY_SO || '/usr/local/lib/nya-gtk-display.so';

function activeDisplayFile(runtime: SessionRuntime) {
  return path.join(sessionDir(runtime.id), 'tmp', 'nya-active-display');
}

export function writeActiveDisplay(runtime: SessionRuntime, display: number) {
  if (runtime.activeDisplay === display) return;
  runtime.activeDisplay = display;
  const file = activeDisplayFile(runtime);
  const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, `:${display}\n`);
  fs.renameSync(tmp, file);
  try {
    fs.chownSync(file, runtime.uid, runtime.gid);
  } catch {
    /* ignore */
  }
}

export function markActiveDisplay(sessionId: string, display: number | null | undefined) {
  const runtime = runtimes.get(sessionId);
  if (!runtime || display == null) return;
  writeActiveDisplay(runtime, display);
}

/** Timezone and Chrome language of a session, with `auto` resolved from its proxy exit. */
export function sessionLocaleOf(sessionId: string) {
  const session = getSession(sessionId);
  return session ? sessionLocaleSettings(session) : resolveSessionLocale({});
}

// Backend credentials and secrets stay out of the browser's environment.
const SECRET_ENV = /PASSWORD|SECRET|TOKEN|CREDENTIAL|API_KEY|PRIVATE_KEY|^INIT_ADMIN_|^AUTH_/i;

function sessionBaseEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !SECRET_ENV.test(key)));
}

export function sessionEnv(runtime: SessionRuntime, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const home = sessionDir(runtime.id);
  const tmp = path.join(home, 'tmp');
  const { timezone, language } = sessionLocaleOf(runtime.id);
  const wanted = posixLocale(language);
  const posix = sessionLocale(wanted);
  const env: NodeJS.ProcessEnv = {
    ...sessionBaseEnv(),
    DISPLAY: `:${runtime.display}`,
    HOME: home,
    USER: runtime.userName,
    LOGNAME: runtime.userName,
    XAUTHORITY: runtime.authFile,
    TMPDIR: tmp,
    TMP: tmp,
    TEMP: tmp,
    XDG_RUNTIME_DIR: tmp,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    LANG: posix,
    LC_ALL: posix,
    LANGUAGE: wanted.split('.')[0],
    TZ: timezone,
    GTK_CSD: '1',
    GTK_USE_PORTAL: '0',
    NO_AT_BRIDGE: '1',
    NYA_ACTIVE_DISPLAY_FILE: activeDisplayFile(runtime),
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/dbus/system_bus_socket',
    // Remote IME would swallow Unicode keysyms. Local IME commits are injected
    // as finished text; the session must not compose again.
    GTK_IM_MODULE: 'simple',
    QT_IM_MODULE: 'simple',
    XMODIFIERS: '@im=none',
    ...extra,
  };
  delete env.IBUS_ADDRESS;
  delete env.IBUS_DAEMON_PID;
  return env;
}

export function setDisplayCreds(runtime: SessionRuntime, display = runtime.display) {
  displayCreds.set(display, {
    uid: runtime.uid,
    gid: runtime.gid,
    home: sessionDir(runtime.id),
    authFile: runtime.authFile,
    userName: runtime.userName,
  });
}

export function runAsSession(runtime: SessionRuntime, cmd: string, args: string[], opts: RunOptions = {}) {
  return run(cmd, args, {
    ...opts,
    uid: runtime.uid,
    gid: runtime.gid,
    env: sessionEnv(runtime, opts.env),
  });
}

/** Run an X client against `display` as the user that owns it; resolves stdout. */
export function runOnDisplay(display: number, file: string, args: string[], timeout = 8000) {
  const cred = displayCreds.get(display) || null;
  const opts: ExecFileOptions = {
    env: {
      ...process.env,
      DISPLAY: `:${display}`,
      ...(cred
        ? {
            HOME: cred.home,
            XAUTHORITY: cred.authFile,
            USER: cred.userName,
            LOGNAME: cred.userName,
          }
        : {}),
    },
    timeout,
    maxBuffer: 1024 * 1024,
  };
  if (cred && Number.isInteger(cred.uid)) {
    opts.uid = cred.uid;
    opts.gid = cred.gid;
  }
  return new Promise<string>((resolve, reject) => {
    execFile(file, args, opts, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(String(stderr || err.message || '').trim() || String(err)));
        return;
      }
      resolve(String(stdout || ''));
    });
  });
}
