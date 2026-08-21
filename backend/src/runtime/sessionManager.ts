// @ts-nocheck
import { spawn, execFile, execFileSync } from 'child_process';
import crypto from 'crypto';
import net from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ProxyChain from 'proxy-chain';
import {
  chromeProfileDir,
  downloadsDir,
  ensureSessionDirs,
  ensureSessionFingerprint,
  ensureSessionTimezone,
  getSession,
  normalizeHomeUrl,
  sessionDir,
} from '../store.js';
import { DISPLAY_LIMITS, clampDisplayGeom, normalizeTimezone, AUDIT_ACTIONS } from '@nya/shared';
import { writeAudit } from '../modules/audit/service.js';

const DISPLAY_BASE = Number(process.env.DISPLAY_BASE || 100);
const SUB_DISPLAY_BASE = Number(process.env.SUB_DISPLAY_BASE || 2000);
const MAX_SUBS = Number(process.env.MAX_SUBS || 8);
const VNC_PORT_BASE = Number(process.env.VNC_PORT_BASE || 5900);
const LOCAL_PROXY_BASE = Number(process.env.LOCAL_PROXY_BASE || 18000);
const SLOT_UID_BASE = Number(process.env.SLOT_UID_BASE || 12000);
// Xvfb RANDR cannot grow past the initial -screen size. Start large so pane
// resizes can both shrink and grow. SCREEN_SIZE is only the boot geometry.
const SCREEN_MAX = process.env.SCREEN_MAX || `${DISPLAY_LIMITS.maxW}x${DISPLAY_LIMITS.maxH}x24`;
const SCREEN_INIT = process.env.SCREEN_SIZE || '1920x1080x24';
const CHROME_BIN = process.env.CHROME_BIN || '/opt/nya-chromium/chrome';
const CHROME_POLICY_DIRS = ['/etc/chromium/policies/managed'];
const CHROME_WM_CLASSES = ['chromium', 'Chromium', 'chromium-browser', 'Chromium-browser'];
const WINDOW_ENSURE_COOLDOWN_MS = 8000;

function sessionHomeUrl(sessionId, override) {
  const raw = String(override ?? '').trim();
  if (raw && raw !== 'about:blank') return normalizeHomeUrl(raw);
  return normalizeHomeUrl(getSession(sessionId)?.homeUrl);
}
const DESKTOP_COLORS = ['#0f3d4c', '#3d1f4c', '#1f4c2e', '#4c2e1f', '#1f2e4c', '#4c1f2e'];
const DATA_DIR = process.env.DATA_DIR || '/data';
const NYA_CDP_BASE = (() => {
  const raw = process.env.NYA_CDP_BASE;
  if (raw === '0' || raw === 'off' || raw === 'false') return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 19200;
})();

/** @type {Map<string, any>} */
const runtimes = new Map();
/** @type {Set<number>} */
const usedSlots = new Set();
/** @type {Set<number>} */
const usedSubDisplays = new Set();
/** @type {Map<number, { uid: number, gid: number, home: string, authFile: string, userName: string }>} */
const displayCreds = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killTree(child, signal = 'SIGTERM') {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* ignore */
    }
  }
}

function run(cmd, args, opts = {}) {
  const logFile = opts.logFile;
  /** @type {any} */
  let stdio = opts.stdio || 'ignore';
  if (logFile) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const fd = fs.openSync(logFile, 'a');
    stdio = ['ignore', fd, fd];
  }
  /** @type {import('child_process').SpawnOptions} */
  const spawnOpts = {
    stdio,
    env: { ...process.env, ...(opts.env || {}) },
    detached: true,
  };
  if (Number.isInteger(opts.uid)) spawnOpts.uid = opts.uid;
  if (Number.isInteger(opts.gid)) spawnOpts.gid = opts.gid;
  const child = spawn(cmd, args, spawnOpts);
  if (opts.onExit) {
    child.on('exit', opts.onExit);
  }
  child.on('error', (err) => {
    console.error(`[spawn error] ${cmd}:`, err.message);
  });
  return child;
}

function waitPort(port, host = '127.0.0.1', timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const socket = net.connect({ port, host }, () => {
        socket.end();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timeout waiting for ${host}:${port}`));
        } else {
          setTimeout(tryOnce, 200);
        }
      });
    };
    tryOnce();
  });
}

function waitUnixSocket(sockPath, timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      if (!fs.existsSync(sockPath)) {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timeout waiting for ${sockPath}`));
        } else {
          setTimeout(tryOnce, 150);
        }
        return;
      }
      const socket = net.connect({ path: sockPath }, () => {
        socket.end();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timeout waiting for ${sockPath}`));
        } else {
          setTimeout(tryOnce, 150);
        }
      });
    };
    tryOnce();
  });
}

function allocateSlot() {
  for (let i = 0; i < 1000; i += 1) {
    if (!usedSlots.has(i)) {
      usedSlots.add(i);
      return i;
    }
  }
  throw new Error('No free display slots');
}

function releaseSlot(slot) {
  usedSlots.delete(slot);
}

function iptables(args) {
  try {
    execFileSync('iptables', ['-w', '5', ...args], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function ip6tables(args) {
  try {
    execFileSync('ip6tables', ['-w', '5', ...args], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function netChainName(slot) {
  return `NYA${slot}`;
}

function applyUidLoopbackFilter(runtime) {
  if (!Number.isInteger(runtime?.uid)) return;
  const chain = netChainName(runtime.slot);
  const uid = String(runtime.uid);
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
  if (!jumped) {
    console.warn(
      `[net-filter] session=${runtime.id} uid=${uid} loopback isolation skipped (need NET_ADMIN)`,
    );
  }

  ip6tables(['-D', 'OUTPUT', '-m', 'owner', '--uid-owner', uid, '-j', chain]);
  ip6tables(['-N', chain]);
  ip6tables(['-F', chain]);
  // Docker IPv6 is often a black hole; reject all so Chrome does not stall on AAAA.
  ip6tables(['-A', chain, '-j', 'REJECT', '--reject-with', 'icmp6-port-unreachable']);
  ip6tables(['-I', 'OUTPUT', '1', '-m', 'owner', '--uid-owner', uid, '-j', chain]);
}

function removeUidLoopbackFilter(runtime) {
  if (!Number.isInteger(runtime?.uid) || runtime.slot == null) return;
  const chain = netChainName(runtime.slot);
  const uid = String(runtime.uid);
  iptables(['-D', 'OUTPUT', '-m', 'owner', '--uid-owner', uid, '-j', chain]);
  iptables(['-F', chain]);
  iptables(['-X', chain]);
  ip6tables(['-D', 'OUTPUT', '-m', 'owner', '--uid-owner', uid, '-j', chain]);
  ip6tables(['-F', chain]);
  ip6tables(['-X', chain]);
}

function ensureSlotUser(slot) {
  const name = `nyas${slot}`;
  const uid = SLOT_UID_BASE + slot;
  const gid = uid;
  try {
    execFileSync('groupadd', ['-f', '-g', String(gid), name], { stdio: 'pipe' });
  } catch (err) {
    const msg = err.stderr?.toString?.() || err.message || '';
    if (!/already exists/i.test(msg)) {
      console.warn(`[user] groupadd ${name}: ${msg.trim() || err.message}`);
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

function chownTree(dir, uid, gid) {
  try {
    fs.lchownSync(dir, uid, gid);
  } catch {
    return;
  }
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      try {
        fs.lchownSync(child, uid, gid);
      } catch {
        /* ignore */
      }
      continue;
    }
    if (entry.isDirectory()) chownTree(child, uid, gid);
    else {
      try {
        fs.lchownSync(child, uid, gid);
      } catch {
        /* ignore */
      }
    }
  }
}

export function chownSessionFiles(sessionId, runtimeHint = null) {
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

function hardenSessionDirs(sessionId, user) {
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

function writeXauth(home, display, uid, gid) {
  const authFile = path.join(home, '.Xauthority');
  const cookie = crypto.randomBytes(16).toString('hex');
  try {
    fs.unlinkSync(authFile);
  } catch {
    /* ignore */
  }
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
      console.warn(`[xauth] add ${name}: ${(err.stderr && err.stderr.toString()) || err.message}`);
    }
  }
  if (!fs.existsSync(authFile)) {
    throw new Error('Failed to write Xauthority');
  }
  fs.chownSync(authFile, uid, gid);
  fs.chmodSync(authFile, 0o600);
  return authFile;
}

function addXauthDisplay(authFile, display, uid, gid, home) {
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
      console.warn(`[xauth] add ${name}: ${(err.stderr && err.stderr.toString()) || err.message}`);
    }
  }
  try {
    fs.chownSync(authFile, uid, gid);
    fs.chmodSync(authFile, 0o600);
  } catch {
    /* ignore */
  }
}

function ensureX11UnixDir() {
  try {
    fs.mkdirSync('/tmp/.X11-unix', { recursive: true });
    fs.chmodSync('/tmp/.X11-unix', 0o1777);
  } catch {
    /* ignore */
  }
}

function sessionEnv(runtime, extra = {}) {
  const home = sessionDir(runtime.id);
  const tmp = path.join(home, 'tmp');
  return {
    ...process.env,
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
    LANG: 'zh_CN.UTF-8',
    LC_ALL: 'zh_CN.UTF-8',
    TZ: normalizeTimezone(getSession(runtime.id)?.timezone),
    GTK_CSD: '0',
    NO_AT_BRIDGE: '1',
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/dbus/system_bus_socket',
    ...extra,
  };
}

function setDisplayCreds(runtime) {
  displayCreds.set(runtime.display, {
    uid: runtime.uid,
    gid: runtime.gid,
    home: sessionDir(runtime.id),
    authFile: runtime.authFile,
    userName: runtime.userName,
  });
}

function credsForDisplay(display) {
  return displayCreds.get(display) || null;
}

function runAsSession(runtime, cmd, args, opts = {}) {
  return run(cmd, args, {
    ...opts,
    uid: runtime.uid,
    gid: runtime.gid,
    env: sessionEnv(runtime, opts.env),
  });
}

function buildUpstreamUrl(proxy) {
  if (!proxy || proxy.type === 'none') return null;
  const auth =
    proxy.username || proxy.password
      ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
      : '';
    const scheme = proxy.type === 'socks5' ? 'socks5' : proxy.type === 'https' ? 'https' : 'http';
  return `${scheme}://${auth}${proxy.host}:${proxy.port}`;
}

async function startLocalProxy(slot, proxy) {
  const port = LOCAL_PROXY_BASE + slot;
  const upstream = buildUpstreamUrl(proxy);
  if (!upstream) {
    return { port: null, server: null, upstream: null };
  }
  const server = new ProxyChain.Server({
    port,
    host: '127.0.0.1',
    prepareRequestFunction: ({ hostname }) => {
      const host = String(hostname || '').toLowerCase();
      if (
        host === 'localhost' ||
        host === '::1' ||
        host === '[::1]' ||
        host === '0.0.0.0' ||
        /^127\.\d+\.\d+\.\d+$/.test(host)
      ) {
        throw new ProxyChain.RequestError('Localhost is not reachable from sessions', 403);
      }
      return { upstreamProxyUrl: upstream };
    },
  });
  await server.listen();
  return { port, server, upstream };
}

async function restartLocalProxy(runtime, proxy) {
  if (runtime.proxyServer) {
    try {
      await runtime.proxyServer.close(true);
    } catch {
      /* ignore */
    }
    runtime.proxyServer = null;
    runtime.localProxyPort = null;
  }
  const started = await startLocalProxy(runtime.slot, proxy);
  runtime.proxyServer = started.server;
  runtime.localProxyPort = started.port;
  runtime.upstream = started.upstream;
  return started;
}

function writeChromePolicies() {
  const policy = {
    IncognitoModeAvailability: 1,
    BrowserAddPersonEnabled: false,
    BrowserGuestModeEnabled: false,
    ProfilePickerOnStartupEnabled: false,
    BrowserSignin: 0,
    SyncDisabled: true,
    CloudReportingEnabled: false,
    CloudProfileReportingEnabled: false,
    MetricsReportingEnabled: false,
    SpellCheckServiceEnabled: false,
    SearchSuggestEnabled: false,
    AlternateErrorPagesEnabled: false,
    NetworkPredictionOptions: 2,
    TranslateEnabled: false,
    BackgroundModeEnabled: false,
    DefaultBrowserSettingEnabled: false,
    PromotionalTabsEnabled: false,
    ShoppingListEnabled: false,
    UserFeedbackAllowed: false,
    PasswordSharingEnabled: false,
    BrowserLabsEnabled: false,
    ComponentUpdatesEnabled: false,
    SuppressUnsupportedOSWarning: true,
    PrivacySandboxPromptEnabled: false,
    PrivacySandboxAdTopicsEnabled: false,
    PrivacySandboxSiteEnabledAdsEnabled: false,
    PrivacySandboxAdMeasurementEnabled: false,
    UrlKeyedAnonymizedDataCollectionEnabled: false,
    PasswordLeakDetectionEnabled: false,
    SafeBrowsingExtendedReportingEnabled: false,
    RelatedWebsiteSetsEnabled: false,
    HelpTipsEnabled: false,
    SideSearchEnabled: false,
    EnableMediaRouter: false,
    GeminiSettings: 1,
    HelpMeWriteSettings: 2,
    CreateThemesSettings: 2,
    TabOrganizerSettings: 2,
    DevToolsGenAiSettings: 2,
    URLBlocklist: ['file://*'],
    CommandLineFlagSecurityWarningsEnabled: false,
    AllowFileSelectionDialogs: false,
    DefaultFileSystemReadGuardSetting: 2,
    DefaultFileSystemWriteGuardSetting: 2,
    WebRtcIPHandling: 'disable_non_proxied_udp',
    AudioCaptureAllowed: false,
    VideoCaptureAllowed: false,
    DefaultWebBluetoothGuardSetting: 2,
    DefaultWebUsbGuardSetting: 2,
    DefaultSerialGuardSetting: 2,
    ShowHomeButton: true,
    DefaultSearchProviderEnabled: true,
    DefaultSearchProviderName: 'Google',
    DefaultSearchProviderKeyword: 'google.com',
    DefaultSearchProviderSearchURL:
      'https://www.google.com/search?q={searchTerms}',
    DefaultSearchProviderSuggestURL:
      'https://www.google.com/complete/search?client=chrome&q={searchTerms}',
  };
  const body = `${JSON.stringify(policy, null, 2)}\n`;
  for (const dir of CHROME_POLICY_DIRS) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'nya.json'), body);
  }
}

writeChromePolicies();

function clearChromeLocks(sessionId) {
  const profile = chromeProfileDir(sessionId);
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try {
      fs.rmSync(path.join(profile, name), { force: true });
    } catch {
      /* ignore */
    }
  }
}

function writeChromePreferences(sessionId, startUrl) {
  clearChromeLocks(sessionId);
  const profile = chromeProfileDir(sessionId);
  const defaultDir = path.join(profile, 'Default');
  fs.mkdirSync(defaultDir, { recursive: true });
  const downloads = downloadsDir(sessionId);
  const homeUrl = normalizeHomeUrl(startUrl || getSession(sessionId)?.homeUrl);
  const prefsPath = path.join(defaultDir, 'Preferences');
  let prefs = {};
  if (fs.existsSync(prefsPath)) {
    try {
      prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
    } catch {
      prefs = {};
    }
  }
  prefs.download = {
    ...(prefs.download || {}),
    default_directory: downloads,
    directory_upgrade: true,
    prompt_for_download: false,
  };
  prefs.profile = {
    ...(prefs.profile || {}),
    default_content_setting_values: {
      ...((prefs.profile && prefs.profile.default_content_setting_values) || {}),
      notifications: 2,
    },
    exit_type: 'Normal',
    exited_cleanly: true,
  };
  prefs.browser = {
    ...(prefs.browser || {}),
    custom_chrome_frame: false,
  };
  prefs.session = {
    ...(prefs.session || {}),
    restore_on_startup: 4,
    startup_urls: [homeUrl],
  };
  prefs.homepage = homeUrl;
  prefs.homepage_is_newtabpage = false;
  prefs.webrtc = {
    ...(prefs.webrtc || {}),
    ip_handling_policy: 'disable_non_proxied_udp',
    multiple_routes_enabled: false,
    nonproxied_udp_enabled: false,
  };
  fs.writeFileSync(prefsPath, JSON.stringify(prefs));

  const localStatePath = path.join(profile, 'Local State');
  let localState = {};
  if (fs.existsSync(localStatePath)) {
    try {
      localState = JSON.parse(fs.readFileSync(localStatePath, 'utf8'));
    } catch {
      localState = {};
    }
  }
  localState.browser = {
    ...(localState.browser || {}),
    enabled_labs_experiments: [],
  };
  localState.signin = {
    ...(localState.signin || {}),
    allowed: false,
  };
  fs.writeFileSync(localStatePath, JSON.stringify(localState));
}

function writeOpenboxConfig(home) {
  const dir = path.join(home, '.config', 'openbox');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'rc.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <resistance>
    <strength>0</strength>
    <screen_edge_strength>0</screen_edge_strength>
  </resistance>
  <focus>
    <focusNew>yes</focusNew>
    <followMouse>no</followMouse>
    <raiseOnFocus>no</raiseOnFocus>
  </focus>
  <theme>
    <name>Clearlooks</name>
    <titleLayout></titleLayout>
    <keepBorder>no</keepBorder>
  </theme>
  <desktops>
    <number>1</number>
  </desktops>
  <resize>
    <drawContents>no</drawContents>
  </resize>
  <keyboard>
    <chainQuit>yes</chainQuit>
  </keyboard>
  <mouse>
    <dragThreshold>8192</dragThreshold>
    <!-- Keep mouse empty so Button1 is not grabbed from Chrome. -->
  </mouse>
  <applications>
    <application class="*">
      <decor>no</decor>
      <maximized>yes</maximized>
      <position force="yes"><x>0</x><y>0</y></position>
      <layer>above</layer>
      <focus>yes</focus>
    </application>
  </applications>
</openbox_config>
`,
  );
}

function parseWh(spec, fallbackW = 1920, fallbackH = 1080) {
  const m = String(spec || '').match(/(\d+)\s*x\s*(\d+)/i);
  return {
    w: m ? Number(m[1]) : fallbackW,
    h: m ? Number(m[2]) : fallbackH,
  };
}

function gpuBackend() {
  const explicit = String(process.env.NYA_GPU_BACKEND || '').trim().toLowerCase();
  if (explicit) return explicit;
  const raw = String(process.env.NYA_GPU || '').toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'on' || raw === 'nvidia') return 'gl-egl';
  return 'swiftshader';
}

function chromeArgs(sessionId, localProxyPort, geom = parseWh(SCREEN_INIT), cdpPort = null, fingerprint = null, inProcessGpu = false, startUrl = null) {
  const profile = chromeProfileDir(sessionId);
  const homeUrl = sessionHomeUrl(sessionId, startUrl);
  const backend = gpuBackend();
  const disabledFeatures = [
    'TranslateUI',
    'InfiniteSessionRestore',
    'MediaRouter',
    'OptimizationHints',
    'InterestFeedContentSuggestions',
    'AutofillServerCommunication',
    'PrivacySandboxSettings4',
    'FileSystemAccessAPI',
    'FileSystemAccessAPIExperimental',
    'NativeFileSystemAPI',
    'WebRTC',
    'WebGpu',
    'WebGPU',
    'DirectSockets',
  ];
  const enabledFeatures = [];
  if (backend === 'vulkan') {
    enabledFeatures.push('Vulkan', 'VulkanFromANGLE', 'DefaultANGLEVulkan');
  }
  const args = [
    `--user-data-dir=${profile}`,
    '--profile-directory=Default',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-service-autorun',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-domain-reliability',
    '--disable-client-side-phishing-detection',
    '--disable-component-extensions-with-background-pages',
    '--disable-breakpad',
    '--metrics-recording-only',
    '--check-for-update-interval=31536000',
    '--ozone-platform=x11',
    `--disable-features=${disabledFeatures.join(',')}`,
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--disable-webrtc-hw-encoding',
    '--disable-webrtc-hw-decoding',
    '--disable-quic',
    '--disable-file-system',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    '--password-store=basic',
    '--start-maximized',
    '--window-position=0,0',
    `--window-size=${geom.w},${geom.h}`,
    `--homepage=${homeUrl}`,
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--enable-webgl2',
    '--disable-ipv6',
    '--nya-x11-multi-display',
    '--in-process-gpu',
  ];
  if (enabledFeatures.length) {
    args.push(`--enable-features=${enabledFeatures.join(',')}`);
  }
  if (backend === 'vulkan') {
    args.push(
      '--use-gl=angle',
      '--use-angle=vulkan',
      '--disable-vulkan-surface',
      '--enable-gpu-rasterization',
      '--enable-zero-copy',
    );
  } else if (backend === 'egl' || backend === 'gl-egl') {
    args.push('--use-gl=angle', '--use-angle=gl-egl', '--enable-gpu-rasterization');
  } else if (backend === 'gles-egl') {
    args.push('--use-gl=angle', '--use-angle=gles-egl', '--enable-gpu-rasterization');
  } else {
    args.push(
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-gpu-compositing',
    );
  }

  if (fingerprint?.seed) {
    args.push(`--nya-fp-seed=${fingerprint.seed}`);
    args.push(`--nya-hw-concurrency=${String(fingerprint.hardwareConcurrency)}`);
    args.push(`--nya-device-memory=${String(fingerprint.deviceMemory)}`);
  }
  if (cdpPort) {
    args.push(`--remote-debugging-port=${cdpPort}`);
    args.push('--remote-debugging-address=127.0.0.1');
    args.push('--remote-allow-origins=*');
  }

  if (localProxyPort) {
    args.push(`--proxy-server=http://127.0.0.1:${localProxyPort}`);
  } else {
    args.push('--no-proxy-server');
  }
  return args;
}

async function killChromeProfile(sessionId) {
  const profile = chromeProfileDir(sessionId);
  await new Promise((resolve) => {
    execFile('pkill', ['-9', '-f', `--user-data-dir=${profile}`], () => resolve());
  });
}

function childPidAlive(child) {
  const pid = child?.pid;
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function chromePidAlive(runtime) {
  return childPidAlive(runtime.chrome);
}

async function xdotoolChromeIds(display, timeoutMs = 2500) {
  const ids = [];
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

async function displayHasBrowserWindow(display, timeoutMs = 1500) {
  try {
    const list = await runOnDisplay(display, 'wmctrl', ['-lx'], timeoutMs);
    for (const line of list.split('\n')) {
      if (!/chromium/i.test(line)) continue;
      if (/10x10/.test(line)) continue;
      return true;
    }
    return false;
  } catch {
    return Boolean(await findMainChromeWindow(display, timeoutMs));
  }
}

async function createChromeWindowOnDisplay(runtime, display, url) {
  const target = sessionHomeUrl(runtime.id, url);
  await waitChromeControl(runtime.id, 8000);
  if (display !== runtime.display) {
    await sendChromeControl(runtime.id, {
      id: Date.now(),
      cmd: 'attachDisplay',
      display: `:${display}`,
    });
  }
  return sendChromeControl(runtime.id, {
    id: Date.now() + 1,
    cmd: 'createWindow',
    display: `:${display}`,
    url: target,
  });
}

async function ensureChromeWindow(runtime, display, geom, opts = {}) {
  if (await displayHasBrowserWindow(display)) return true;
  runtime.windowEnsureAt = runtime.windowEnsureAt || {};
  const key = String(display);
  const now = Date.now();
  if (!opts.force && now - (runtime.windowEnsureAt[key] || 0) < (opts.cooldownMs ?? WINDOW_ENSURE_COOLDOWN_MS)) {
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
    console.warn(
      `[chrome-watch] session=${runtime.id} display=:${display} recreate failed:`,
      err.message,
    );
    return false;
  }
}

async function restoreSessionWindows(runtime, { force = false } = {}) {
  const geom = runtime.lastGeom || parseWh(SCREEN_INIT);
  if (force) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && !(await displayHasBrowserWindow(runtime.display))) {
      await sleep(300);
    }
    await maximizeChrome(runtime.display, geom.w, geom.h);
  }
  await ensureChromeWindow(runtime, runtime.display, geom, { force });
  for (const sub of [...(runtime.subs || [])]) {
    if (runtime.stopping || !runtimes.has(runtime.id)) return;
    await ensureChromeWindow(runtime, sub.display, sub.lastGeom || geom, { force });
  }
}

async function startChrome(runtime) {
  const session = getSession(runtime.id);
  if (!session) throw new Error('Session not found');
  const fingerprint = ensureSessionFingerprint(runtime.id);
  if (!fingerprint) throw new Error('Failed to persist session fingerprint');
  const startUrl = runtime.launchUrl || sessionHomeUrl(runtime.id);
  runtime.launchUrl = startUrl;
  writeChromePreferences(runtime.id, startUrl);
  chownSessionFiles(runtime.id, runtime);
  const cdpPort = runtime.cdpPort || (NYA_CDP_BASE > 0 ? NYA_CDP_BASE + runtime.slot : null);
  runtime.cdpPort = cdpPort;
  const args = chromeArgs(
    runtime.id,
    runtime.localProxyPort,
    runtime.lastGeom || parseWh(SCREEN_INIT),
    cdpPort,
    fingerprint,
    Boolean(runtime.inProcessGpu),
    startUrl,
  );
  const home = sessionDir(runtime.id);
  const logFile = path.join(home, 'chrome.log');
  runtime.allowRecover = true;
  runtime.chromeStartedAt = Date.now();
  runtime.chromeHasInProcessGpu = Boolean(runtime.inProcessGpu);
  console.log(`[chrome ${runtime.id}] gpu backend=${gpuBackend()}`);
  runtime.chrome = runAsSession(runtime, CHROME_BIN, args, {
    logFile,
    onExit: (code, signal) => {
      console.log(`[chrome ${runtime.id}] exited code=${code} signal=${signal}`);
      runtime.chrome = null;
      if (runtime.allowRecover && runtimes.has(runtime.id)) {
        scheduleChromeRecover(runtime, 'exit');
      }
    },
  });
}

async function stopChrome(runtime) {
  runtime.allowRecover = false;
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
}

async function recoverChrome(runtime, reason) {
  if (!runtimes.has(runtime.id) || runtime.stopping) return;
  console.log(`[chrome-watch] session=${runtime.id} reason=${reason} restarting`);
  try {
    await restartBrowser(runtime.id);
  } catch (err) {
    console.error(`[chrome-watch] session=${runtime.id} restart failed:`, err.message);
  }
}

function scheduleChromeRecover(runtime, reason) {
  if (!runtime || runtime.stopping || runtime.recovering) return;
  if (!runtimes.has(runtime.id)) return;
  const now = Date.now();
  if (now - (runtime.lastRecoverAt || 0) < 5000) return;
  runtime.lastRecoverAt = now;
  runtime.recovering = true;
  void recoverChrome(runtime, reason).finally(() => {
    runtime.recovering = false;
  });
}

async function watchChrome(runtime) {
  if (runtime.stopping || runtime.recovering || runtime.watchBusy || !runtime.allowRecover) return;
  if (Date.now() - (runtime.chromeStartedAt || 0) < 8000) return;
  runtime.watchBusy = true;
  try {
    if (!chromePidAlive(runtime)) {
      if (runtime.chrome) scheduleChromeRecover(runtime, 'watchdog');
      return;
    }
    await ensureAllChromeWindows(runtime);
  } catch (err) {
    console.warn(`[chrome-watch] session=${runtime.id}`, err.message);
  } finally {
    runtime.watchBusy = false;
  }
}

async function ensureAllChromeWindows(runtime) {
  if (!childPidAlive(runtime.xvfb)) {
    console.warn(`[chrome-watch] session=${runtime.id} primary Xvfb is down`);
    return;
  }
  await ensureChromeWindow(runtime, runtime.display, runtime.lastGeom);
  for (const sub of [...(runtime.subs || [])]) {
    if (runtime.stopping || runtime.recovering || !runtimes.has(runtime.id)) return;
    if (!childPidAlive(sub.xvfb) || !childPidAlive(sub.openbox) || !childPidAlive(sub.x11vnc)) {
      const now = Date.now();
      if (now - (sub.lastRespawnAt || 0) < WINDOW_ENSURE_COOLDOWN_MS) continue;
      sub.lastRespawnAt = now;
      try {
        await respawnSubDesktop(runtime, sub);
      } catch (err) {
        console.warn(
          `[chrome-watch] session=${runtime.id} sub=${sub.id} desktop respawn failed:`,
          err.message,
        );
        continue;
      }
    }
    await ensureChromeWindow(runtime, sub.display, sub.lastGeom);
  }
}

let watchTimer = null;
function startChromeWatchdog() {
  if (watchTimer) return;
  watchTimer = setInterval(() => {
    for (const runtime of runtimes.values()) {
      void watchChrome(runtime);
    }
  }, 5000);
  if (typeof watchTimer.unref === 'function') watchTimer.unref();
}

startChromeWatchdog();

/**
 * Start full desktop stack for a session.
 */
export async function startSession(sessionId, { url, ownerUserId } = {}) {
  if (runtimes.has(sessionId)) {
    const existing = runtimes.get(sessionId);
    if (ownerUserId && existing && !existing.mainOwnerUserId) {
      existing.mainOwnerUserId = ownerUserId;
    }
    return getRuntimePublic(sessionId);
  }
  const session = getSession(sessionId);
  if (!session) throw new Error('Session not found');
  const launchUrl = sessionHomeUrl(sessionId, url);

  const slot = allocateSlot();
  const display = DISPLAY_BASE + slot;
  const vncPort = VNC_PORT_BASE + slot;
  const home = sessionDir(sessionId);
  /** @type {any} */
  let runtime = null;
  try {
    const user = ensureSlotUser(slot);
    ensureSessionDirs(sessionId);
    ensureSessionFingerprint(sessionId);
    ensureSessionTimezone(sessionId);
    writeChromePreferences(sessionId, launchUrl);
    writeOpenboxConfig(home);
    hardenSessionDirs(sessionId, user);
    const authFile = writeXauth(home, display, user.uid, user.gid);
    const vncSock = path.join(home, 'vnc.sock');
    try {
      fs.unlinkSync(vncSock);
    } catch {
      /* ignore */
    }
    ensureX11UnixDir();

    runtime = {
      id: sessionId,
      slot,
      display,
      vncPort,
      vncSock,
      uid: user.uid,
      gid: user.gid,
      userName: user.name,
      authFile,
      localProxyPort: null,
      proxyServer: null,
      upstream: null,
      xvfb: null,
      openbox: null,
      chrome: null,
      x11vnc: null,
      cdpPort: NYA_CDP_BASE > 0 ? NYA_CDP_BASE + slot : null,
      startedAt: new Date().toISOString(),
      launchUrl,
      subs: [],
      inProcessGpu: true,
      mainOwnerUserId: ownerUserId || null,
      occupancyId: ownerUserId ? newOccupancy() : null,
    };
    setDisplayCreds(runtime);
    runtime.xvfb = runAsSession(runtime, 'Xvfb', [
      `:${display}`,
      '-screen',
      '0',
      SCREEN_MAX,
      '-nolisten',
      'tcp',
      '-auth',
      authFile,
      '+extension',
      'RANDR',
      '+extension',
      'XTEST',
    ], { logFile: path.join(home, 'xvfb.log') });
    await sleep(500);
    await waitForX(runtime).catch((err) => {
      console.warn(`[display ${sessionId}] X not ready:`, err.message);
    });

    runtime.openbox = runAsSession(runtime, 'openbox', ['--sm-disable'], {
      logFile: path.join(home, 'openbox.log'),
    });
    await sleep(300);

    const boot = parseWh(SCREEN_INIT);
    try {
      let lastBootErr = null;
      for (let i = 0; i < 8; i += 1) {
        try {
          await setFramebuffer(runtime, boot.w, boot.h);
          lastBootErr = null;
          break;
        } catch (err) {
          lastBootErr = err;
          await sleep(250);
        }
      }
      if (lastBootErr) throw lastBootErr;
      runtime.lastGeom = { w: boot.w, h: boot.h };
    } catch (err) {
      console.warn(`[display ${sessionId}] boot framebuffer failed:`, err.message);
    }

    const proxy = await startLocalProxy(slot, session.proxy);
    runtime.proxyServer = proxy.server;
    runtime.localProxyPort = proxy.port;
    runtime.upstream = proxy.upstream;
    applyUidLoopbackFilter(runtime);

    // Start VNC before Chrome so the session is reachable even while Chrome boots.
    runtime.x11vnc = spawnX11vnc(runtime, home);
    await waitUnixSocket(vncSock);
    try {
      fs.chmodSync(vncSock, 0o600);
    } catch {
      /* ignore */
    }

    // Distinct root color helps confirm desktops are truly separate.
    runAsSession(runtime, 'xsetroot', ['-solid', DESKTOP_COLORS[slot % DESKTOP_COLORS.length]]);

    await startChrome(runtime);
    await sleep(1000);

    runtimes.set(sessionId, runtime);
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

function spawnX11vnc(runtime, home, opts = {}) {
  // Unix socket only: other session UIDs cannot attach to this desktop.
  // Do not use -threads: framebuffer resizes and pointer/key injection become unstable.
  const display = opts.display ?? runtime.display;
  const sock = opts.vncSock || runtime.vncSock || path.join(home, 'vnc.sock');
  const desktop = opts.desktopName || `nya-${runtime.id}`;
  const logFile = opts.logFile || path.join(home, 'x11vnc.log');
  return runAsSession(runtime, 'x11vnc', [
    '-display',
    `:${display}`,
    '-unixsock',
    sock,
    '-rfbport',
    '0',
    '-alwaysshared',
    '-forever',
    '-shared',
    '-noxdamage',
    '-repeat',
    '-speeds',
    'lan',
    '-wait',
    '1',
    '-defer',
    '0',
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
  ], { env: { DISPLAY: `:${display}` } });
}

async function forceCleanupRuntime(runtime) {
  removeUidLoopbackFilter(runtime);
  displayCreds.delete(runtime.display);
  await stopAllSubs(runtime);
  if (runtime.clipboardHolder) {
    killTree(runtime.clipboardHolder, 'SIGKILL');
    runtime.clipboardHolder = null;
  }
  const kids = [runtime.chrome, runtime.x11vnc, runtime.openbox, runtime.xvfb];
  for (const child of kids) {
    killTree(child, 'SIGTERM');
  }
  await sleep(400);
  for (const child of kids) {
    killTree(child, 'SIGKILL');
  }
  await killChromeProfile(runtime.id);
  if (runtime.vncSock) {
    try {
      fs.unlinkSync(runtime.vncSock);
    } catch {
      /* ignore */
    }
  }
  try {
    fs.unlinkSync(chromeControlSock(runtime.id));
  } catch {
    /* ignore */
  }
  if (runtime.proxyServer) {
    try {
      await runtime.proxyServer.close(true);
    } catch {
      /* ignore */
    }
  }
}

export async function stopSession(sessionId) {
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

export async function restartBrowser(sessionId, { url } = {}) {
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

export async function applyProxy(sessionId, proxyInput) {
  const session = getSession(sessionId);
  if (!session) throw new Error('Session not found');
  const proxy = proxyInput || session.proxy;
  if (runtimes.has(sessionId)) {
    const runtime = runtimes.get(sessionId);
    await restartLocalProxy(runtime, proxy);
    applyUidLoopbackFilter(runtime);
    await restartBrowser(sessionId);
  }
  return getSession(sessionId);
}

function runOnDisplay(display, file, args, timeout = 8000) {
  const cred = credsForDisplay(display);
  /** @type {import('child_process').ExecFileOptions} */
  const opts = {
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
  return new Promise((resolve, reject) => {
    execFile(file, args, opts, (err, stdout, stderr) => {
      if (err) {
        const e = new Error((stderr || err.message || '').trim() || String(err));
        reject(e);
        return;
      }
      resolve(String(stdout || ''));
    });
  });
}

async function restrictChromeWindowControls(display, id) {
  try {
    await runOnDisplay(display, 'xprop', [
      '-id',
      id,
      '-f',
      '_MOTIF_WM_HINTS',
      '32c',
      '-set',
      '_MOTIF_WM_HINTS',
      '3, 0, 0, 0, 0',
    ]);
  } catch {
    /* ignore */
  }
  try {
    await runOnDisplay(display, 'xprop', [
      '-id',
      id,
      '-f',
      '_NET_WM_ALLOWED_ACTIONS',
      '32a',
      '-set',
      '_NET_WM_ALLOWED_ACTIONS',
      '_NET_WM_ACTION_MOVE,_NET_WM_ACTION_RESIZE,_NET_WM_ACTION_FULLSCREEN',
    ]);
  } catch {
    /* ignore */
  }
}

async function findMainChromeWindow(display, timeoutMs = 2500) {
  try {
    const ids = await xdotoolChromeIds(display, timeoutMs);
    for (const id of ids) {
      try {
        const geom = await runOnDisplay(
          display,
          'xdotool',
          ['getwindowgeometry', id],
          timeoutMs,
        );
        const m = geom.match(/Geometry:\s+(\d+)x(\d+)/);
        if (m && Number(m[1]) <= 32 && Number(m[2]) <= 32) {
          try {
            await runOnDisplay(display, 'xdotool', ['windowlower', id], timeoutMs);
          } catch {
            /* ignore */
          }
          continue;
        }
      } catch {
        /* ignore */
      }
      return id;
    }
  } catch {
    /* ignore */
  }
  try {
    const list = await runOnDisplay(display, 'wmctrl', ['-lx'], timeoutMs);
    for (const line of list.split('\n')) {
      if (!/chromium/i.test(line)) continue;
      if (/10x10/.test(line)) continue;
      const id = line.trim().split(/\s+/)[0];
      if (id) return id;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function maximizeChrome(display, width, height) {
  const id = await findMainChromeWindow(display);
  if (!id) return;
  await restrictChromeWindowControls(display, id);
  const tryRun = async (file, args) => {
    try {
      await runOnDisplay(display, file, args, 2500);
    } catch {
      /* ignore */
    }
  };
  // Maximized windows ignore windowsize; drop it, set geometry, then restore.
  await tryRun('wmctrl', [
    '-i',
    '-r',
    id,
    '-b',
    'remove,maximized_vert,maximized_horz',
  ]);
  await tryRun('xdotool', ['windowmove', id, '0', '0']);
  await tryRun('xdotool', ['windowsize', id, String(width), String(height)]);
  await tryRun('wmctrl', ['-i', '-r', id, '-e', `0,0,0,${width},${height}`]);
  await tryRun('wmctrl', ['-i', '-r', id, '-b', 'add,maximized_vert,maximized_horz']);
  await tryRun('wmctrl', ['-i', '-r', id, '-b', 'add,above']);
  await tryRun('xdotool', ['windowraise', id]);
  await tryRun('xdotool', ['windowactivate', id]);
}

function parseXrandr(xr) {
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

async function readFramebuffer(runtime) {
  const xr = await runOnDisplay(runtime.display, 'xrandr', [], 4000);
  return parseXrandr(xr);
}

async function waitForX(runtime, timeoutMs = 5000) {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < timeoutMs) {
    try {
      await runOnDisplay(runtime.display, 'xrandr', [], 1500);
      return;
    } catch (err) {
      lastErr = err;
      await sleep(150);
    }
  }
  throw lastErr || new Error('X display did not become ready');
}

async function ensureMode(runtime, output, modeName, ew, eh, xrText) {
  if (new RegExp(`\\b${modeName}\\b`).test(xrText)) return;
  const add = async (args) => {
    try {
      await runOnDisplay(runtime.display, 'xrandr', ['--newmode', modeName, ...args], 4000);
    } catch {
      /* already exists */
    }
    try {
      await runOnDisplay(runtime.display, 'xrandr', ['--addmode', output, modeName], 4000);
    } catch {
      /* already added */
    }
  };
  // Xvfb's native mode is 0.00Hz; 0-clock timings are accepted immediately.
  await add(['0', String(ew), '0', '0', '0', String(eh), '0', '0', '0']);
  const check = await runOnDisplay(runtime.display, 'xrandr', [], 4000);
  if (new RegExp(`\\b${modeName}\\b`).test(check)) return;
  try {
    const cvtOut = await runOnDisplay(
      runtime.display,
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

async function setFramebuffer(runtime, ew, eh) {
  const info = await readFramebuffer(runtime);
  if (info.w === ew && info.h === eh) return info;

  const modeName = `${ew}x${eh}`;
  const xr = await runOnDisplay(runtime.display, 'xrandr', [], 4000);
  await ensureMode(runtime, info.output, modeName, ew, eh, xr);

  const growing = ew > info.w || eh > info.h;
  const tryMode = () =>
    runOnDisplay(
      runtime.display,
      'xrandr',
      ['--output', info.output, '--mode', modeName],
      4000,
    );
  const tryFb = () =>
    runOnDisplay(runtime.display, 'xrandr', ['--fb', `${ew}x${eh}`], 4000);

  let lastErr = null;
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
    const now = await readFramebuffer(runtime);
    actual = { w: now.w, h: now.h };
    if (actual.w === ew && actual.h === eh) return now;
  }
  if (lastErr) throw lastErr;
  throw new Error(`display is ${actual.w}x${actual.h}, wanted ${ew}x${eh}`);
}

async function applyDesiredGeom(runtime) {
  return applyDesiredGeomTo(runtime, runtime.display);
}

async function applyDesiredGeomTo(holder, display) {
  const want = holder.desiredGeom;
  if (!want) return holder.lastGeom;
  holder.desiredGeom = null;
  const view = { display };
  const actual = await readFramebuffer(view);
  if (actual.w === want.w && actual.h === want.h) {
    await maximizeChrome(display, want.w, want.h);
    holder.lastGeom = { w: want.w, h: want.h };
  } else {
    await setFramebuffer(view, want.w, want.h);
    await maximizeChrome(display, want.w, want.h);
    holder.lastGeom = { w: want.w, h: want.h };
  }
  if (holder.desiredGeom) return applyDesiredGeomTo(holder, display);
  return holder.lastGeom;
}

function withResizeLock(runtime, fn) {
  const prev = runtime.resizeTail || Promise.resolve();
  const next = prev.then(fn, fn);
  runtime.resizeTail = next.catch(() => {});
  return next;
}

/**
 * Resize the X desktop to the viewer pane, then maximize Chrome to fill it.
 * Concurrent calls are serialized and coalesced to the latest size.
 */
export async function resizeDisplay(sessionId, width, height, runtimeHint = null, subId = null) {
  const runtime = runtimeHint || runtimes.get(sessionId);
  if (!runtime) throw new Error('Session is not running');
  const { w: ew, h: eh } = clampDisplayGeom(width, height);
  const holder = subId ? getSubOrThrow(runtime, subId) : runtime;
  const display = subId ? holder.display : runtime.display;
  holder.desiredGeom = { w: ew, h: eh };
  const geom = await withResizeLock(holder, () => applyDesiredGeomTo(holder, display));
  return geom || { w: ew, h: eh };
}

function chromeControlSock(sessionId) {
  return path.join(chromeProfileDir(sessionId), 'nya-chrome.sock');
}

function allocateSubDisplay() {
  for (let i = 0; i < 5000; i += 1) {
    const d = SUB_DISPLAY_BASE + i;
    if (!usedSubDisplays.has(d) && !displayCreds.has(d)) {
      usedSubDisplays.add(d);
      return d;
    }
  }
  throw new Error('No free sub display');
}

function getSubOrThrow(runtime, subId) {
  const sub = (runtime.subs || []).find((s) => s.id === subId);
  if (!sub) throw new Error('Sub-desktop not found');
  return sub;
}

function sendChromeControl(sessionId, payload, timeoutMs = 25000) {
  const sockPath = chromeControlSock(sessionId);
  return new Promise((resolve, reject) => {
    const socket = net.connect({ path: sockPath });
    let buf = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('nya-chrome.sock timeout'));
    }, timeoutMs);
    socket.on('connect', () => {
      socket.write(`${JSON.stringify(payload)}\n`);
    });
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      clearTimeout(timer);
      socket.end();
      try {
        const msg = JSON.parse(buf.slice(0, nl));
        if (!msg.ok) {
          reject(new Error(msg.error || 'chrome control failed'));
          return;
        }
        resolve(msg);
      } catch (err) {
        reject(err);
      }
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function waitChromeControl(sessionId, timeoutMs = 30000) {
  await waitUnixSocket(chromeControlSock(sessionId), timeoutMs);
}

async function stopSubInternal(runtime, sub) {
  if (!sub) return;
  if (sub.clipboardHolder) {
    killTree(sub.clipboardHolder, 'SIGKILL');
    sub.clipboardHolder = null;
  }
  const kids = [sub.x11vnc, sub.openbox, sub.xvfb];
  for (const child of kids) {
    killTree(child, 'SIGTERM');
  }
  await sleep(250);
  for (const child of kids) {
    killTree(child, 'SIGKILL');
  }
  if (sub.vncSock) {
    try {
      fs.unlinkSync(sub.vncSock);
    } catch {
      /* ignore */
    }
  }
  displayCreds.delete(sub.display);
  usedSubDisplays.delete(sub.display);
  runtime.subs = (runtime.subs || []).filter((s) => s.id !== sub.id);
}

async function stopAllSubs(runtime) {
  const list = [...(runtime.subs || [])];
  for (const sub of list) {
    await stopSubInternal(runtime, sub);
  }
  runtime.subs = [];
}

export async function listSubs(sessionId) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) throw new Error('Session is not running');
  return (runtime.subs || []).map((sub) => ({
    id: sub.id,
    display: sub.display,
    running: Boolean(sub.xvfb),
    ownerUserId: sub.ownerUserId || null,
  }));
}

async function spawnSubDesktop(runtime, sub) {
  const home = sessionDir(runtime.id);
  const display = sub.display;
  const view = { ...runtime, display };
  setDisplayCreds(view);
  ensureX11UnixDir();
  if (sub.vncSock) {
    try {
      fs.unlinkSync(sub.vncSock);
    } catch {
      /* ignore */
    }
  }

  sub.xvfb = runAsSession(runtime, 'Xvfb', [
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
  ], { logFile: path.join(home, `xvfb-sub-${sub.id}.log`), env: { DISPLAY: `:${display}` } });

  await sleep(400);
  await waitForX(view).catch((err) => {
    console.warn(`[sub ${runtime.id}/${sub.id}] X not ready:`, err.message);
  });

  sub.openbox = runAsSession(runtime, 'openbox', ['--sm-disable'], {
    logFile: path.join(home, `openbox-sub-${sub.id}.log`),
    env: { DISPLAY: `:${display}` },
  });
  await sleep(250);

  const boot = sub.lastGeom || parseWh(SCREEN_INIT);
  try {
    await setFramebuffer(view, boot.w, boot.h);
    sub.lastGeom = { w: boot.w, h: boot.h };
  } catch (err) {
    console.warn(`[sub ${runtime.id}/${sub.id}] boot framebuffer failed:`, err.message);
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

async function respawnSubDesktop(runtime, sub) {
  console.log(`[chrome-watch] session=${runtime.id} sub=${sub.id} respawning desktop :${sub.display}`);
  if (sub.clipboardHolder) {
    killTree(sub.clipboardHolder, 'SIGKILL');
    sub.clipboardHolder = null;
  }
  const kids = [sub.x11vnc, sub.openbox, sub.xvfb];
  for (const child of kids) {
    killTree(child, 'SIGTERM');
  }
  await sleep(250);
  for (const child of kids) {
    killTree(child, 'SIGKILL');
  }
  sub.xvfb = null;
  sub.openbox = null;
  sub.x11vnc = null;
  await spawnSubDesktop(runtime, sub);
}

export async function createSub(sessionId, url, { ownerUserId } = {}) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) throw new Error('Session is not running');
  if ((runtime.subs || []).length >= MAX_SUBS) {
    throw new Error(`At most ${MAX_SUBS} extra desktops per session`);
  }

  if (!runtime.inProcessGpu || !runtime.chromeHasInProcessGpu) {
    runtime.inProcessGpu = true;
    await restartBrowser(sessionId);
  }

  const home = sessionDir(sessionId);
  const subId = crypto.randomBytes(4).toString('hex');
  const display = allocateSubDisplay();
  addXauthDisplay(runtime.authFile, display, runtime.uid, runtime.gid, home);
  const vncSock = path.join(home, `vnc-sub-${subId}.sock`);
  ensureX11UnixDir();

  const sub = {
    id: subId,
    display,
    vncSock,
    xvfb: null,
    openbox: null,
    x11vnc: null,
    lastGeom: parseWh(SCREEN_INIT),
    clipboardText: undefined,
    clipboardHolder: null,
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
    await maximizeChrome(display, sub.lastGeom.w, sub.lastGeom.h);

    if (!runtime.subs) runtime.subs = [];
    runtime.subs.push(sub);
    return {
      id: sub.id,
      kind: 'sub',
      display: sub.display,
      running: true,
      ownerUserId: sub.ownerUserId || null,
      occupancyId: sub.occupancyId || null,
    };
  } catch (err) {
    await stopSubInternal(runtime, sub);
    throw err;
  }
}

export async function stopSub(sessionId, subId) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) throw new Error('Session is not running');
  const sub = getSubOrThrow(runtime, subId);
  await stopSubInternal(runtime, sub);
  return true;
}

export function getSubRuntime(sessionId, subId) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) return null;
  const sub = (runtime.subs || []).find((s) => s.id === subId);
  if (!sub) return null;
  return { runtime, sub };
}

export function getRuntime(sessionId) {
  return runtimes.get(sessionId) || null;
}

export function getRuntimePublic(sessionId) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) return null;
  return {
    running: true,
    display: runtime.display,
    vncPort: runtime.vncPort,
    hasProxy: Boolean(runtime.localProxyPort),
    cdpPort: runtime.cdpPort || null,
    startedAt: runtime.startedAt,
    windows: listWindows(sessionId),
    subs: (runtime.subs || []).map((sub) => ({
      id: sub.id,
      display: sub.display,
      running: Boolean(sub.xvfb),
      ownerUserId: sub.ownerUserId || null,
    })),
  };
}

/** @type {Map<string, number>} */
const vncCounts = new Map();
/** @type {Map<string, Set<import('ws').WebSocket>>} */
const vncClients = new Map();
/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const idleTimers = new Map();

function totalVncConnections(sessionId) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) return 0;
  let n = getVncCount(sessionId, null);
  for (const sub of runtime.subs || []) {
    n += getVncCount(sessionId, sub.id);
  }
  return n;
}

function clearIdleWatch(sessionId) {
  const timer = idleTimers.get(sessionId);
  if (!timer) return;
  clearTimeout(timer);
  idleTimers.delete(sessionId);
}

export function syncIdleWatch(sessionId) {
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

async function stopIdleSession(sessionId) {
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
  console.log(`[idle] session=${sessionId} no VNC for ${minutes}m, stopping`);
  writeAudit({
    action: AUDIT_ACTIONS.sessionStop,
    resourceType: 'session',
    resourceId: sessionId,
    success: true,
    detail: { reason: 'idle_timeout', idleTimeoutMinutes: minutes },
  });
  await stopSession(sessionId);
}

function newOccupancy() {
  return crypto.randomBytes(12).toString('hex');
}

export function vncKey(sessionId, subId = null) {
  return subId ? `${sessionId}:${subId}` : `${sessionId}:main`;
}

export function addVncConnection(sessionId, subId = null) {
  const k = vncKey(sessionId, subId);
  vncCounts.set(k, (vncCounts.get(k) || 0) + 1);
  syncIdleWatch(sessionId);
  return () => {
    const n = (vncCounts.get(k) || 1) - 1;
    if (n <= 0) vncCounts.delete(k);
    else vncCounts.set(k, n);
    syncIdleWatch(sessionId);
  };
}

export function registerVncClient(sessionId, subId, ws) {
  const k = vncKey(sessionId, subId);
  let set = vncClients.get(k);
  if (!set) {
    set = new Set();
    vncClients.set(k, set);
  }
  set.add(ws);
  const release = addVncConnection(sessionId, subId);
  const done = () => {
    set.delete(ws);
    if (set.size === 0) vncClients.delete(k);
    release();
  };
  ws.on('close', done);
  return done;
}

export function kickVncConnections(sessionId, subId = null) {
  const set = vncClients.get(vncKey(sessionId, subId));
  if (!set) return;
  for (const ws of [...set]) {
    try {
      ws.close(4000, 'taken_over');
    } catch {
      /* ignore */
    }
  }
}

export function getWindowOccupancy(sessionId, windowId) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) return null;
  if (!windowId || windowId === 'main') return runtime.occupancyId || null;
  const sub = (runtime.subs || []).find((s) => s.id === windowId);
  return sub?.occupancyId || null;
}

function withOccupancy(sessionId, win) {
  if (!win) return win;
  return { ...win, occupancyId: getWindowOccupancy(sessionId, win.id) };
}

export function ownedWindows(sessionId, userId) {
  return listWindows(sessionId).filter((w) => w.ownerUserId === userId);
}

export async function takeoverOwnedWindow(sessionId, userId) {
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

export function getVncCount(sessionId, subId = null) {
  return vncCounts.get(vncKey(sessionId, subId)) || 0;
}

export function listWindows(sessionId) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) return [];
  const boot = parseWh(SCREEN_INIT);
  const mainGeom = runtime.lastGeom || boot;
  const main = {
    id: 'main',
    kind: 'main',
    display: runtime.display,
    running: true,
    ownerUserId: runtime.mainOwnerUserId || null,
    vncConnections: getVncCount(sessionId, null),
    width: mainGeom.w,
    height: mainGeom.h,
  };
  const subs = (runtime.subs || []).map((sub) => {
    const geom = sub.lastGeom || boot;
    return {
      id: sub.id,
      kind: 'sub',
      display: sub.display,
      running: Boolean(sub.xvfb),
      ownerUserId: sub.ownerUserId || null,
      vncConnections: getVncCount(sessionId, sub.id),
      width: geom.w,
      height: geom.h,
    };
  });
  return [main, ...subs];
}

export function countOwnedWindows(sessionId, userId) {
  return listWindows(sessionId).filter((w) => w.ownerUserId === userId).length;
}

export function getWindow(sessionId, windowId) {
  return listWindows(sessionId).find((w) => w.id === windowId) || null;
}

export function canAccessWindow(sessionId, windowId, user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const win = getWindow(sessionId, windowId || 'main');
  if (!win) return false;
  return win.ownerUserId === user.id;
}

export function claimMainWindow(sessionId, userId) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) throw new Error('Session is not running');
  if (runtime.mainOwnerUserId && runtime.mainOwnerUserId !== userId) {
    throw new Error('Main window is in use');
  }
  runtime.mainOwnerUserId = userId;
  runtime.occupancyId = newOccupancy();
  return withOccupancy(sessionId, getWindow(sessionId, 'main'));
}

export function releaseMainWindow(sessionId, userId, asAdmin = false) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) return false;
  if (!asAdmin && runtime.mainOwnerUserId && runtime.mainOwnerUserId !== userId) {
    throw new Error('Not the window owner');
  }
  if (asAdmin || runtime.mainOwnerUserId === userId) {
    runtime.mainOwnerUserId = null;
  }
  return true;
}

export async function maybeStopIdle(sessionId) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) return false;
  const hasOwner = Boolean(runtime.mainOwnerUserId);
  const hasSub = (runtime.subs || []).length > 0;
  if (hasOwner || hasSub) return false;
  await stopSession(sessionId);
  return true;
}

export function listRunningIds() {
  return [...runtimes.keys()];
}

export function getRuntimePids(sessionId) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) return null;
  return {
    chrome: runtime.chrome?.pid || null,
    xvfb: runtime.xvfb?.pid || null,
    openbox: runtime.openbox?.pid || null,
    x11vnc: runtime.x11vnc?.pid || null,
    subs: (runtime.subs || []).map((sub) => ({
      id: sub.id,
      xvfb: sub.xvfb?.pid || null,
      openbox: sub.openbox?.pid || null,
      x11vnc: sub.x11vnc?.pid || null,
    })),
  };
}

export function listRuntimesPublic() {
  /** @type {Record<string, any>} */
  const out = {};
  for (const id of runtimes.keys()) {
    out[id] = getRuntimePublic(id);
  }
  return out;
}

export async function stopAllSessions() {
  const ids = [...runtimes.keys()];
  for (const id of ids) {
    await stopSession(id);
  }
}

export function execOnDisplay(sessionId, file, args) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) {
    return Promise.reject(new Error('Session is not running'));
  }
  /** @type {import('child_process').ExecFileOptions} */
  const opts = {
    env: sessionEnv(runtime),
    maxBuffer: 2 * 1024 * 1024,
  };
  if (Number.isInteger(runtime.uid)) {
    opts.uid = runtime.uid;
    opts.gid = runtime.gid;
  }
  return new Promise((resolve, reject) => {
    execFile(file, args, opts, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export async function getClipboard(sessionId, subId = null) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) throw new Error('Session is not running');
  const holder = subId ? getSubOrThrow(runtime, subId) : runtime;
  try {
    const { stdout } = await execFileOnHolder(runtime, holder, 'timeout', [
      '2',
      'xclip',
      '-selection',
      'clipboard',
      '-o',
    ]);
    const text = stdout;
    holder.clipboardText = text;
    return text;
  } catch {
    if (typeof holder.clipboardText === 'string') {
      return holder.clipboardText;
    }
    return '';
  }
}

function execFileOnHolder(runtime, holder, file, args) {
  const display = holder.display ?? runtime.display;
  /** @type {import('child_process').ExecFileOptions} */
  const opts = {
    env: sessionEnv(runtime, { DISPLAY: `:${display}` }),
    maxBuffer: 2 * 1024 * 1024,
  };
  if (Number.isInteger(runtime.uid)) {
    opts.uid = runtime.uid;
    opts.gid = runtime.gid;
  }
  return new Promise((resolve, reject) => {
    execFile(file, args, opts, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export async function setClipboard(sessionId, text, subId = null) {
  const runtime = runtimes.get(sessionId);
  if (!runtime) throw new Error('Session is not running');
  const holder = subId ? getSubOrThrow(runtime, subId) : runtime;
  const value = String(text ?? '');
  holder.clipboardText = value;

  if (holder.clipboardHolder?.pid) {
    killTree(holder.clipboardHolder, 'SIGKILL');
    holder.clipboardHolder = null;
  }

  await new Promise((resolve, reject) => {
    /** @type {import('child_process').SpawnOptions} */
    const spawnOpts = {
      env: sessionEnv(runtime, { DISPLAY: `:${holder.display}` }),
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore'],
    };
    if (Number.isInteger(runtime.uid)) {
      spawnOpts.uid = runtime.uid;
      spawnOpts.gid = runtime.gid;
    }
    const child = spawn('xclip', ['-selection', 'clipboard', '-i'], spawnOpts);
    child.on('error', reject);
    child.stdin.write(value, 'utf8');
    child.stdin.end();
    setTimeout(() => {
      holder.clipboardHolder = child;
      resolve();
    }, 150);
  });
}
