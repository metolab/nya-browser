export const AUTH_COOKIE = 'nya_token';

export const FILE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const PASTE_IMAGE_MAX_EDGE = 2000;
export const PASTE_IMAGE_PIXEL_MAX = 4000;

export const BACKUP_EXCLUDE = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'GrShaderCache',
  'ShaderCache',
  'Service Worker/CacheStorage',
  'Crash Reports',
  'BrowserMetrics',
  'optimization_guide_hint_cache_store',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
];

export const AUDIT_ACTIONS = {
  login: 'login',
  loginFailed: 'login_failed',
  logout: 'logout',
  userCreate: 'user.create',
  userUpdate: 'user.update',
  userDelete: 'user.delete',
  passwordChange: 'user.password',
  groupCreate: 'group.create',
  groupUpdate: 'group.update',
  groupDelete: 'group.delete',
  sessionCreate: 'session.create',
  sessionUpdate: 'session.update',
  sessionDelete: 'session.delete',
  sessionStart: 'session.start',
  sessionStop: 'session.stop',
  sessionRestart: 'session.restart',
  sessionFingerprint: 'session.fingerprint',
  sessionNotepad: 'session.notepad',
  assignmentSet: 'grant.set',
  proxyCreate: 'proxy.create',
  proxyUpdate: 'proxy.update',
  proxyDelete: 'proxy.delete',
  proxyTest: 'proxy.test',
  windowCreate: 'window.create',
  windowClose: 'window.close',
  vncConnect: 'vnc.connect',
  backupExport: 'backup.export',
  backupImport: 'backup.import',
} as const;
