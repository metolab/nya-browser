import type { GeoConfig } from './geo.js';
import { emptyProxyExtra, type ProxyExtra, type ProxyType, type ProxyTypeOrNone } from './proxy.js';
import type { OsType, WindowsRelease } from './osProfiles.js';
import type { WebrtcMode } from './webrtc.js';

export type Role = 'admin' | 'user';

export interface FingerprintConfig {
  seed: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  gpuProfile: string;
  webrtcMode: WebrtcMode;
  geo: GeoConfig;
  os: OsType;
  windowsRelease: WindowsRelease;
}

export interface ProxyConfig {
  type: ProxyTypeOrNone;
  host: string;
  port: number | null;
  username: string;
  password: string;
  extra: ProxyExtra;
  viaProxyId?: string | null;
}

export interface ProxyTestResult {
  ok: boolean;
  latencyMs: number | null;
  exitIp: string | null;
  loc: string | null;
  colo: string | null;
  region: string | null;
  error: string | null;
}

/** A proxy that belongs to one session only; its front proxy is a saved one. */
export interface SessionProxy {
  type: ProxyType;
  host: string;
  port: number;
  username: string;
  password: string;
  extra: ProxyExtra;
  viaProxyId: string | null;
  lastTestAt: string | null;
  lastTest: ProxyTestResult | null;
}

export interface ProxyRecord {
  id: string;
  name: string;
  type: ProxyType;
  host: string;
  port: number;
  username: string;
  password: string;
  extra: ProxyExtra;
  viaProxyId: string | null;
  createdAt: string;
  lastTestAt: string | null;
  lastTest: ProxyTestResult | null;
}

export interface UserPublic {
  id: string;
  username: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export interface SessionGroup {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  createdAt: string;
}

export type AccessKind = 'session' | 'folder';

export interface AccessGrant {
  userId: string;
  username?: string;
  kind: AccessKind;
  targetId: string;
  targetName?: string;
  allowNotepad?: boolean;
}

export interface SessionWindow {
  id: string;
  kind: 'main' | 'sub';
  display: number;
  running: boolean;
  ownerUserId: string | null;
  ownerUsername?: string | null;
  vncConnections: number;
  width: number;
  height: number;
  usage?: ProcessUsage;
}

export interface ProcessUsage {
  pid: number | null;
  rssBytes: number;
  cpuPercent: number;
}

export interface GpuUsage {
  available: boolean;
  memBytes: number;
  utilPercent: number;
}

export interface RuntimeInfo {
  running?: boolean;
  display?: number;
  hasProxy?: boolean;
  startedAt?: string;
  cdpPort?: number | null;
  cdpClients?: number;
  windows?: SessionWindow[];
  usage?: ProcessUsage;
}

export interface Session {
  id: string;
  name: string;
  description: string;
  notepad?: string;
  canNotepad?: boolean;
  groupId: string | null;
  proxyId: string | null;
  /** Set instead of `proxyId` when the session uses its own proxy. */
  customProxy: SessionProxy | null;
  /** The proxy the session runs with: the saved one, the custom one, or `none`. */
  proxy: ProxyConfig;
  fingerprint?: FingerprintConfig;
  /** An IANA name. */
  timezone: string;
  /** A Chrome UI language code. */
  chromeLanguage: string;
  homeUrl: string;
  idleTimeoutMinutes: number;
  createdAt: string;
  updatedAt: string;
  runtime: RuntimeInfo;
  grants?: AccessGrant[];
}

export interface FileEntry {
  name: string;
  type: 'file' | 'dir';
  size: number | null;
  mtime: string;
}

export type SessionDownloadState = 'in_progress' | 'completed' | 'cancelled' | 'failed';

export interface SessionUpload {
  name: string;
  path: string;
  size: number;
  mtime: string;
}

export interface SessionDownload {
  id: string;
  name: string;
  path: string;
  url: string;
  state: SessionDownloadState;
  receivedBytes: number;
  totalBytes: number;
  startedAt: string;
  updatedAt: string;
  missing?: boolean;
}

export interface LocalFileJob {
  id: string;
  path: string;
  name: string;
  total: number;
  state: 'active' | 'completed' | 'cancelled' | 'error';
}

export type ClipboardKind = 'text' | 'image' | 'files';

export interface SessionClipboard {
  kind: ClipboardKind;
  text: string;
  files?: string[];
}

export interface SessionFileChooser {
  open: boolean;
  title: string;
}

export interface SessionTransfer {
  chooser: SessionFileChooser | null;
  uploads: SessionUpload[];
  downloads: SessionDownload[];
  localJobs: LocalFileJob[];
}

export interface AuditLog {
  id: string;
  at: string;
  actorId: string | null;
  actorUsername: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  ip: string | null;
  success: boolean;
  detail: Record<string, unknown> | null;
}

export interface HostMetrics {
  loadavg: number[];
  cpuPercent: number;
  memory: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
  };
  disk: {
    path: string;
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
  };
  uptimeSeconds: number;
}

export interface SessionUsage {
  sessionId: string;
  name: string;
  running: boolean;
  chrome: ProcessUsage;
  cpuPercent: number;
  rssBytes: number;
  diskBytes: number;
  gpu: GpuUsage;
  windows: SessionWindow[];
}

export interface MonitorSnapshot {
  at: string;
  host: HostMetrics;
  sessions: SessionUsage[];
}

export interface SessionPassword {
  origin: string;
  username: string;
  password: string;
  note: string;
}

export interface BackupManifest {
  version: 1;
  exportedAt: string;
  name: string;
  description: string;
  notepad?: string;
  timezone: string;
  chromeLanguage?: string;
  homeUrl: string;
  idleTimeoutMinutes?: number;
  fingerprint: FingerprintConfig;
  proxy: {
    id: string | null;
    name: string | null;
    type: ProxyTypeOrNone;
    host: string;
    port: number | null;
    username: string;
    extra?: ProxyExtra;
  };
  customProxy?: SessionProxy | null;
  passwords?: SessionPassword[];
}

export interface LiveSession {
  session: Session;
  windows: SessionWindow[];
  chrome: ProcessUsage;
  viewerCount: number;
  cdpClients: number;
}

/** An empty home URL opens Chrome's new tab page, as a fresh Chrome install does. */
export const DEFAULT_HOME_URL = '';
export const NEW_TAB_URL = 'chrome://newtab/';

export const emptyProxy = (): ProxyConfig => ({
  type: 'none',
  host: '',
  port: null,
  username: '',
  password: '',
  extra: emptyProxyExtra(),
  viaProxyId: null,
});
