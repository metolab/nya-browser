import fs from 'fs';
import path from 'path';
import { chromeProfileDir, downloadsDir, getSession, normalizeHomeUrl, sessionDir, sessionProxyTest } from '../../store.js';
import type { FingerprintConfig, WebrtcMode } from '@nya/shared';
import { acceptLanguageHeader, chromeAudioDevicePrefixes, chromeDefaultAcceptLanguages, coerceOs, coerceWebrtcMode, coerceWindowsRelease, gpuProfileById, NEW_TAB_URL, sessionMediaDevices, webrtcLocksUdp, webrtcNeedsPublicIp, windowsFontNames, windowsIdentity, windowsUiFont, windowsVoices } from '@nya/shared';
import { resolveTampermonkeyDir, TAMPERMONKEY_ID } from '../tampermonkey.js';
import { writeWidevineHint } from '../widevine.js';
import {
  hasWindowsFonts,
  removeWindowsFontconfig,
  WINDOWS_ALIASED_FONTCONFIG,
  windowsFontPrefs,
  writeWindowsFontconfig,
} from '../windowsFonts.js';
import { sessionTaskbarPx } from './desktopWindows.js';
import { gpuBackend, hostNvidiaDeviceId } from './gpu.js';
import { sessionLocaleOf } from './isolation.js';
import { envOn, parseWh } from './proc.js';
import { SCREEN_INIT } from './state.js';
import type { Geom } from './types.js';

// Chrome's Preferences and Local State files: free-form JSON.
type ChromePrefs = Record<string, any>;

export const CHROME_BIN = process.env.CHROME_BIN || '/opt/nya-chromium/chrome';

const CHROME_POLICY_DIRS = ['/etc/chromium/policies/managed'];

/** The URL a launch or new window opens: the override, else the session home (the new tab page when unset). */
export function sessionHomeUrl(sessionId: string, override?: string | null) {
  const raw = String(override ?? '').trim();
  return normalizeHomeUrl(raw || getSession(sessionId)?.homeUrl) || NEW_TAB_URL;
}

export function writeChromePolicies() {
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
    PasswordManagerEnabled: true,
    PasswordManagerSaveEnabled: true,
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
    // Dialogs are real GTK windows. One Chrome process owns every desk
    // display; nya-gtk-display.so moves the chooser onto the desk that last
    // sent a VNC click so it does not open on the main X server.
    AllowFileSelectionDialogs: true,
    DefaultFileSystemReadGuardSetting: 2,
    DefaultFileSystemWriteGuardSetting: 2,
    AudioCaptureAllowed: true,
    VideoCaptureAllowed: true,
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
    ExtensionSettings: {
      [TAMPERMONKEY_ID]: {
        toolbar_pin: 'force_pinned',
      },
    },
  };
  const body = `${JSON.stringify(policy, null, 2)}\n`;
  for (const dir of CHROME_POLICY_DIRS) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'nya.json'), body);
  }
}

export function clearChromeLocks(sessionId: string) {
  const profile = chromeProfileDir(sessionId);
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try {
      fs.rmSync(path.join(profile, name), { force: true });
    } catch {
      /* ignore */
    }
  }
}

/** Chrome's first-run Accept-Language for the UI locale (the same on every desktop OS). */
function sessionAcceptLanguages(language: string) {
  return chromeDefaultAcceptLanguages(language) || acceptLanguageHeader(language);
}

const NYA_FONT_PREFS_MARK = 'nya_windows_font_prefs';

/** Windows sessions get Chrome-on-Windows default fonts; drop them again on the way back to Linux. */
function applyWindowsFontPrefs(prefs: ChromePrefs, fingerprint: FingerprintConfig | undefined, language: string) {
  const windows = Boolean(fingerprint && coerceOs(fingerprint.os) === 'windows' && hasWindowsFonts());
  const webprefs = (prefs.webkit && prefs.webkit.webprefs) || {};
  if (windows) {
    prefs.webkit = {
      ...(prefs.webkit || {}),
      webprefs: { ...webprefs, fonts: windowsFontPrefs(coerceWindowsRelease(fingerprint?.windowsRelease), language) },
    };
    prefs[NYA_FONT_PREFS_MARK] = true;
  } else if (prefs[NYA_FONT_PREFS_MARK]) {
    delete webprefs.fonts;
    delete prefs[NYA_FONT_PREFS_MARK];
  }
}

/**
 * Font environment for Chrome. Windows sessions get DirectWrite-like glyph
 * metrics (patch 004-fonts) and a fontconfig with either the real Windows
 * fonts or Linux fonts aliased to Windows names; Linux sessions keep the
 * system fontconfig.
 */
export function chromeFontEnv(sessionId: string, fingerprint: FingerprintConfig): NodeJS.ProcessEnv {
  const windows = coerceOs(fingerprint.os) === 'windows';
  const env: NodeJS.ProcessEnv = windows ? { NYA_FONT_RASTER: 'dwrite' } : {};
  const fontconfigDir = path.join(sessionDir(sessionId), '.config', 'nya');
  if (windows && hasWindowsFonts()) {
    env.FONTCONFIG_FILE = writeWindowsFontconfig(
      fontconfigDir,
      coerceWindowsRelease(fingerprint.windowsRelease),
      sessionLocaleOf(sessionId).language,
    );
    return env;
  }
  removeWindowsFontconfig(fontconfigDir);
  if (windows && fs.existsSync(WINDOWS_ALIASED_FONTCONFIG)) env.FONTCONFIG_FILE = WINDOWS_ALIASED_FONTCONFIG;
  return env;
}

export function writeChromePreferences(sessionId: string, startUrl?: string | null) {
  clearChromeLocks(sessionId);
  const profile = chromeProfileDir(sessionId);
  const defaultDir = path.join(profile, 'Default');
  fs.mkdirSync(defaultDir, { recursive: true });
  const downloads = downloadsDir(sessionId);
  const homeUrl = sessionHomeUrl(sessionId, startUrl);
  const newTab = homeUrl === NEW_TAB_URL;
  const prefsPath = path.join(defaultDir, 'Preferences');
  let prefs: ChromePrefs = {};
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
  prefs.selectfile = {
    ...(prefs.selectfile || {}),
    last_directory: downloads,
  };
  prefs.credentials_enable_service = true;
  prefs.credentials_enable_autosignin = true;
  prefs.profile = {
    ...(prefs.profile || {}),
    password_manager_enabled: true,
    password_manager_leak_detection: false,
    password_manager_auto_signin: true,
    default_content_setting_values: {
      ...((prefs.profile && prefs.profile.default_content_setting_values) || {}),
      notifications: 3,
      geolocation: sessionGeoContentSetting(sessionId),
    },
    content_settings: {
      ...((prefs.profile && prefs.profile.content_settings) || {}),
      exceptions: {
        ...((prefs.profile && prefs.profile.content_settings && prefs.profile.content_settings.exceptions) || {}),
        geolocation: {},
      },
    },
    exit_type: 'Normal',
    exited_cleanly: true,
  };
  prefs.autofill = {
    ...(prefs.autofill || {}),
    profile_enabled: true,
  };
  prefs.browser = {
    ...(prefs.browser || {}),
    custom_chrome_frame: true,
  };
  prefs.session = {
    ...(prefs.session || {}),
    // 5 = open the new tab page (Chrome's default), 4 = open startup_urls.
    restore_on_startup: newTab ? 5 : 4,
    startup_urls: newTab ? [] : [homeUrl],
  };
  const { language } = sessionLocaleOf(sessionId);
  const acceptLang = sessionAcceptLanguages(language);
  prefs.intl = {
    ...(prefs.intl || {}),
    accept_languages: acceptLang,
    selected_languages: acceptLang,
    app_locale: language,
  };
  if (newTab) delete prefs.homepage;
  else prefs.homepage = homeUrl;
  prefs.homepage_is_newtabpage = newTab;
  applyWindowsFontPrefs(prefs, getSession(sessionId)?.fingerprint, language);
  // Chrome on Windows keeps the bookmark bar to the NTP; this build defaults it on.
  // The marker tells a Windows default apart from a user choice, so switching
  // back to Linux restores the build default.
  const bookmarkMarker = path.join(profile, '.nya-windows-bookmark-bar');
  if (coerceOs(getSession(sessionId)?.fingerprint?.os) === 'windows') {
    if (prefs.bookmark_bar?.show_on_all_tabs === undefined) {
      prefs.bookmark_bar = { ...(prefs.bookmark_bar || {}), show_on_all_tabs: false };
      fs.writeFileSync(bookmarkMarker, '');
    }
  } else if (fs.existsSync(bookmarkMarker)) {
    if (prefs.bookmark_bar?.show_on_all_tabs === false) {
      const { show_on_all_tabs: _windowsDefault, ...bookmarkBar } = prefs.bookmark_bar;
      prefs.bookmark_bar = bookmarkBar;
    }
    fs.rmSync(bookmarkMarker, { force: true });
  }
  const webrtcMode = sessionWebrtcMode(sessionId, getSession(sessionId)?.fingerprint);
  const webrtcNet = webrtcNetworkPolicy(webrtcMode);
  prefs.webrtc = {
    ...(prefs.webrtc || {}),
    ...webrtcNet,
  };
  const tmSettings = (prefs.extensions && prefs.extensions.settings && prefs.extensions.settings[TAMPERMONKEY_ID]) || {};
  prefs.extensions = {
    ...(prefs.extensions || {}),
    ui: {
      ...((prefs.extensions && prefs.extensions.ui) || {}),
      developer_mode: true,
    },
    settings: {
      ...((prefs.extensions && prefs.extensions.settings) || {}),
      [TAMPERMONKEY_ID]: {
        ...tmSettings,
        user_scripts_enabled: true,
      },
    },
  };
  fs.writeFileSync(prefsPath, JSON.stringify(prefs));

  const localStatePath = path.join(profile, 'Local State');
  let localState: ChromePrefs = {};
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
  localState.intl = {
    ...(localState.intl || {}),
    app_locale: language,
  };
  fs.writeFileSync(localStatePath, JSON.stringify(localState));
  writeWidevineHint(profile);
}

function sessionWebrtcMode(sessionId: string, fingerprint?: FingerprintConfig | null): WebrtcMode {
  return coerceWebrtcMode(fingerprint?.webrtcMode || getSession(sessionId)?.fingerprint?.webrtcMode);
}

function sessionGeoContentSetting(sessionId: string) {
  // Never write profile-level allow (1): that authorizes real geolocation
  // before CDP can attach a spoofed override. Allow-mode uses per-origin grant.
  const geo = getSession(sessionId)?.fingerprint?.geo;
  if (geo?.permission === 'block') return 2;
  return 0;
}

/** Ads-aligned WebRTC UDP policy. replace/forward need ICE; the rest lock UDP. */
function webrtcNetworkPolicy(mode: WebrtcMode) {
  const lockUdp = webrtcLocksUdp(mode);
  return {
    ip_handling_policy: lockUdp ? 'disable_non_proxied_udp' : 'default_public_interface_only',
    multiple_routes_enabled: !lockUdp,
    nonproxied_udp_enabled: !lockUdp,
  };
}

function firstIpv4(raw: unknown) {
  const m = String(raw || '').match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
  if (!m) return '';
  const parts = m[1].split('.').map((n) => Number(n));
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return '';
  return m[1];
}

function sessionPublicIp(sessionId: string) {
  const session = getSession(sessionId);
  const test = session ? sessionProxyTest(session) : null;
  if (!test?.ok) return '';
  const ip = firstIpv4(test.exitIp);
  if (!ip) return '';
  const [a, b] = ip.split('.').map((n) => Number(n));
  if (a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) {
    return '';
  }
  return ip;
}

/** The launch flags that follow the proxy exit; Chrome restarts when this changes under a new proxy. */
export function chromeExitProfile(sessionId: string, fingerprint: FingerprintConfig | null = null) {
  const webrtcMode = sessionWebrtcMode(sessionId, fingerprint);
  return webrtcNeedsPublicIp(webrtcMode) ? sessionPublicIp(sessionId) : '';
}

export function chromeArgs(
  sessionId: string,
  localProxyPort: number | null,
  geom: Geom = parseWh(SCREEN_INIT),
  cdpPort: number | null = null,
  fingerprint: FingerprintConfig | null = null,
  startUrl: string | null = null,
) {
  const profile = chromeProfileDir(sessionId);
  const homeUrl = sessionHomeUrl(sessionId, startUrl);
  const { language } = sessionLocaleOf(sessionId);
  const acceptLang = sessionAcceptLanguages(language);
  const backend = gpuBackend();
  const windowsSession = coerceOs(fingerprint?.os) === 'windows';
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
    'DirectSockets',
    'CalculateNativeWinOcclusion',
    'IntensiveWakeUpThrottling',
    'TabFreeze',
    'IdleDetection',
  ];
  const webrtcMode = sessionWebrtcMode(sessionId, fingerprint);
  const enabledFeatures: string[] = [];
  // One --disable-blink-features switch: Chrome keeps only the last copy.
  const disabledBlinkFeatures: string[] = webrtcMode === 'disabled' ? ['NyaWebRTC'] : [];
  // Off on current Chrome stable: Privacy Sandbox ads APIs, Shared Storage,
  // and the experimental WebGPU interfaces that --enable-unsafe-webgpu turns on.
  disabledBlinkFeatures.push(
    'AdInterestGroupAPI',
    'Fledge',
    'FledgeBiddingAndAuctionServerAPI',
    'AllowURNsInIframes',
    'Parakeet',
    'TopicsAPI',
    'TopicsDocumentAPI',
    'TopicsImgAPI',
    'SharedStorageAPI',
    'WebGPUExperimentalFeatures',
  );
  if (windowsSession) {
    // On by default on Windows/macOS (PublicKeyCredential extension:payment).
    enabledFeatures.push('SecurePaymentConfirmationBrowser');
  }
  if (backend !== 'swiftshader') {
    enabledFeatures.push('WebGPU', 'WebGPUService');
  }
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
    '--disable-breakpad',
    '--metrics-recording-only',
    '--check-for-update-interval=31536000',
    '--ozone-platform=x11',
    `--disable-features=${disabledFeatures.join(',')}`,
    `--force-webrtc-ip-handling-policy=${webrtcNetworkPolicy(webrtcMode).ip_handling_policy}`,
    ...(disabledBlinkFeatures.length ? [`--disable-blink-features=${disabledBlinkFeatures.join(',')}`] : []),
    '--use-fake-device-for-media-stream',
    ...(backend !== 'swiftshader' ? ['--enable-unsafe-webgpu'] : []),
    '--disable-webrtc-hw-encoding',
    '--disable-webrtc-hw-decoding',
    '--disable-quic',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    '--password-store=basic',
    '--start-maximized',
    '--window-position=0,0',
    // X11Window shrinks a screen-sized window by 1px; start Windows sessions at
    // the work area so the maximized window is the full 1920 wide.
    `--window-size=${geom.w},${geom.h - sessionTaskbarPx(sessionId)}`,
    ...(homeUrl === NEW_TAB_URL ? [] : [`--homepage=${homeUrl}`]),
    `--lang=${language}`,
    `--accept-lang=${acceptLang}`,
    '--disable-dev-shm-usage',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-background-timer-throttling',
    '--disable-hang-monitor',
    '--disable-background-mode',
    '--no-sandbox',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--enable-webgl2',
    '--disable-ipv6',
    '--nya-ua-brand=Google Chrome',
    // One EGL-readback compositor per X display (patch 012-browser-windows).
    // Menus/bubbles/window.open stay NativeWidgetAura on that compositor.
    // Extra type_normal windows (Ctrl+N / 新窗口) are a second X11 window
    // with GPU readback so WebContents paints and tint2 can list them.
    // In-process GPU is required so UI-thread present cache and the GPU
    // thread share address space.
    '--nya-x11-multi-display',
    '--in-process-gpu',
    // LOG(ERROR) "nya-present …" in the session chrome.log. Heartbeat every
    // 10s or when the center pixel changes; failures are one-shot.
    '--enable-logging=stderr',
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
    // Raster/WebGL on NVIDIA EGL, but the EGL display must not be the
    // UI Xlib connection (patch 011-x11-gpu-present). Window present is EGL readback +
    // X PutImage (Xvfb has no eglCreateWindowSurface configs). Do not
    // add --disable-gpu-compositing: that path is the MIT-SHM presenter
    // that stalls after a lost completion event.
    // Xvfb has no native pixmap/overlay path; --enable-zero-copy waits for
    // scanout that never happens. Raster/WebGL still run on NVIDIA EGL.
    args.push('--use-gl=angle', '--use-angle=gl-egl', '--enable-gpu-rasterization');
  } else if (backend === 'gles-egl') {
    args.push('--use-gl=angle', '--use-angle=gles-egl', '--enable-gpu-rasterization');
  } else {
    args.push(
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--enable-gpu-rasterization',
    );
    // X11CanvasSurface + MIT-SHM multibuffer stalls after a lost
    // completion event: renderer keeps running, the main window pixmap
    // freezes, new widgets (menus) still present. Stay on the GL
    // compositor unless explicitly forced back.
    if (envOn('NYA_SOFTWARE_COMPOSITOR')) {
      args.push('--disable-gpu-compositing');
    }
  }

  if (fingerprint?.seed) {
    args.push(`--nya-fp-seed=${fingerprint.seed}`);
    args.push(`--nya-hw-concurrency=${String(fingerprint.hardwareConcurrency)}`);
    args.push(`--nya-device-memory=${String(fingerprint.deviceMemory)}`);
    const gpu = gpuProfileById(fingerprint.gpuProfile || '');
    if (gpu?.angleName) {
      args.push(`--nya-gpu-model=${gpu.angleName}`);
      if (gpu.deviceId) args.push(`--nya-gpu-device-id=${gpu.deviceId}`);
      if (gpu.architecture) args.push(`--nya-gpu-arch=${gpu.architecture}`);
    }
    args.push(`--nya-webrtc-mode=${webrtcMode}`);
    const publicIp = sessionPublicIp(sessionId);
    if (publicIp && webrtcNeedsPublicIp(webrtcMode)) {
      args.push(`--nya-webrtc-public-ip=${publicIp}`);
    }
    const os = coerceOs(fingerprint.os);
    const media = sessionMediaDevices(os, fingerprint.seed, language);
    const [defaultAudio, communicationsAudio] = chromeAudioDevicePrefixes(language);
    args.push(
      `--nya-media-audio-in=${media.audioInput}`,
      `--nya-media-audio-out=${media.audioOutput}`,
      `--nya-media-video=${media.videoInput}`,
      `--nya-media-default-prefix=${defaultAudio}`,
    );
    if (os === 'windows') args.push(`--nya-media-comm-prefix=${communicationsAudio}`);
    const windowsRelease = coerceWindowsRelease(fingerprint.windowsRelease);
    const win = windowsIdentity(os, windowsRelease);
    // With real Windows fonts fontconfig sees only those; otherwise filter the
    // aliased Linux fonts down to the release's names.
    if (win && !hasWindowsFonts()) {
      args.push(`--nya-fonts=${windowsFontNames(windowsRelease, fingerprint.seed).join('|')}`);
    }
    if (win) {
      args.push(
        '--nya-os=windows',
        `--nya-os-release=${windowsRelease}`,
        `--nya-os-ua-platform=${win.uaPlatform}`,
        `--nya-os-navigator-platform=${win.navigatorPlatform}`,
        `--nya-os-ch-platform=${win.chPlatform}`,
        `--nya-os-ch-platform-version=${win.chPlatformVersion}`,
        // Shipped on Windows, off on Linux: navigator.share/canShare and navigator.bluetooth.
        '--enable-blink-features=WebShare,WebBluetooth',
        `--nya-os-voices=${windowsVoices(language)
          .map(([name, lang]) => `${name}|${lang}`)
          .join(';')}`,
        `--nya-os-ui-font=${windowsUiFont(language)}`,
      );
      // HEVC decode and H.264 High / HEVC WebRTC come from the GPU on Windows.
      if (backend !== 'swiftshader') args.push('--nya-os-hw-video');
      // The D3D11 renderer string carries the PCI device id.
      const deviceId = gpu?.angleName ? '' : hostNvidiaDeviceId();
      if (deviceId && backend !== 'swiftshader') args.push(`--nya-gpu-device-id=${deviceId}`);
    }
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
  const tampermonkeyDir = resolveTampermonkeyDir();
  if (tampermonkeyDir) {
    args.push(`--load-extension=${tampermonkeyDir}`);
    args.push(`--allowlisted-extension-id=${TAMPERMONKEY_ID}`);
  }
  return args;
}
