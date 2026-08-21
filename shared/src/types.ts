export type Role = 'admin' | 'user';

export type ProxyType = 'http' | 'https' | 'socks5';

export type ProxyTypeOrNone = ProxyType | 'none';

export interface FingerprintConfig {
  seed: string;
  hardwareConcurrency: number;
  deviceMemory: number;
}

export interface ProxyConfig {
  type: ProxyTypeOrNone;
  host: string;
  port: number | null;
  username: string;
  password: string;
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

export interface ProxyRecord {
  id: string;
  name: string;
  type: ProxyType;
  host: string;
  port: number;
  username: string;
  password: string;
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

export interface RuntimeInfo {
  running?: boolean;
  display?: number;
  vncPort?: number;
  hasProxy?: boolean;
  startedAt?: string;
  cdpPort?: number | null;
  windows?: SessionWindow[];
  usage?: ProcessUsage;
}

export interface Session {
  id: string;
  name: string;
  description: string;
  groupId: string | null;
  proxyId: string | null;
  proxy: ProxyConfig;
  fingerprint?: FingerprintConfig;
  timezone: string;
  homeUrl: string;
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
  windows: SessionWindow[];
}

export interface MonitorSnapshot {
  at: string;
  host: HostMetrics;
  sessions: SessionUsage[];
}

export interface BackupManifest {
  version: 1;
  exportedAt: string;
  name: string;
  description: string;
  timezone: string;
  homeUrl: string;
  fingerprint: FingerprintConfig;
  proxy: {
    id: string | null;
    name: string | null;
    type: ProxyTypeOrNone;
    host: string;
    port: number | null;
    username: string;
  };
}

export interface LiveSession {
  session: Session;
  windows: SessionWindow[];
  chrome: ProcessUsage;
  viewerCount: number;
}

export const DEFAULT_HOME_URL = 'https://www.google.com/';

export const emptyProxy = (): ProxyConfig => ({
  type: 'none',
  host: '',
  port: null,
  username: '',
  password: '',
});
