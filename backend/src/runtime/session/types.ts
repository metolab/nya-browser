import type { ChildProcess } from 'child_process';
import type { ClipboardKind, ProxyConfig } from '@nya/shared';
import type { SingboxHandle } from '../singbox.js';

export type Geom = { w: number; h: number };

/** One X desktop (Xvfb + openbox + x11vnc) of a session: the main one or an extra one. */
export type DisplayHolder = {
  display: number;
  vncSock: string;
  xvfb: ChildProcess | null;
  openbox: ChildProcess | null;
  x11vnc: ChildProcess | null;
  tint2: ChildProcess | null;
  taskbarOn: boolean;
  taskbarFitted: boolean;
  lastGeom?: Geom;
  desiredGeom?: Geom | null;
  resizeTail?: Promise<unknown>;
  clipboardText?: string;
  clipboardKind: ClipboardKind | string;
  clipboardFiles: string[];
  clipboardHolder: ChildProcess | null;
  clipboardLockUntil: number;
  holdGen: number;
  occupancyId: string | null;
};

export type SubDesktop = DisplayHolder & {
  id: string;
  ownerUserId: string | null;
  lastRespawnAt?: number;
};

export type SessionRuntime = DisplayHolder & {
  id: string;
  slot: number;
  uid: number;
  gid: number;
  userName: string;
  authFile: string;
  localProxyPort: number | null;
  singbox: SingboxHandle | null;
  /** The proxy the sidecar runs; `none` means a direct outbound. */
  proxy: ProxyConfig;
  /** Serializes sidecar swaps and restarts. */
  proxyTail?: Promise<unknown>;
  /** The `--proxy-server` port Chrome launched with; null means `--no-proxy-server`. */
  chromeProxyPort?: number | null;
  /** Launch flags that follow the proxy exit (locale, WebRTC public IP) at Chrome start. */
  chromeExitProfile?: string;
  chrome: ChildProcess | null;
  cdpPort: number | null;
  startedAt: string;
  launchUrl: string;
  subs: SubDesktop[];
  chromeStartedAt?: number;
  mainOwnerUserId: string | null;
  activeDisplay?: number;
  osTaskbarPx?: number;
  allowRecover?: boolean;
  recovering?: boolean;
  stopping?: boolean;
  watchBusy?: boolean;
  lastRecoverAt?: number;
  /** Last window-recreate attempt per X display. */
  windowEnsureAt?: Record<string, number>;
  idleSince?: number | null;
};

/** The uid/gid/xauth a process on a given X display runs with. */
export type DisplayCreds = {
  uid: number;
  gid: number;
  home: string;
  authFile: string;
  userName: string;
};
