export const PROXY_TYPES = ['http', 'https', 'socks5', 'anytls', 'ss', 'vless'] as const;

export type ProxyType = (typeof PROXY_TYPES)[number];

export type ProxyTypeOrNone = ProxyType | 'none';

export const SS_METHODS = [
  'aes-128-gcm',
  'aes-192-gcm',
  'aes-256-gcm',
  'chacha20-ietf-poly1305',
  'xchacha20-ietf-poly1305',
  '2022-blake3-aes-128-gcm',
  '2022-blake3-aes-256-gcm',
  '2022-blake3-chacha20-poly1305',
] as const;

export type SsMethod = (typeof SS_METHODS)[number];

export const VLESS_NETWORKS = ['tcp', 'ws'] as const;

export type VlessNetwork = (typeof VLESS_NETWORKS)[number];

export const VLESS_SECURITIES = ['none', 'tls', 'reality'] as const;

export type VlessSecurity = (typeof VLESS_SECURITIES)[number];

export const TLS_FINGERPRINTS = [
  'chrome',
  'firefox',
  'safari',
  'ios',
  'android',
  'edge',
  'random',
] as const;

export type TlsFingerprint = (typeof TLS_FINGERPRINTS)[number];

export interface ProxyExtra {
  sni: string;
  insecure: boolean;
  method: string;
  plugin: string;
  pluginOpts: string;
  flow: string;
  network: VlessNetwork;
  wsPath: string;
  wsHost: string;
  security: VlessSecurity;
  fingerprint: string;
  publicKey: string;
  shortId: string;
  alpn: string;
}

export const emptyProxyExtra = (): ProxyExtra => ({
  sni: '',
  insecure: false,
  method: 'aes-256-gcm',
  plugin: '',
  pluginOpts: '',
  flow: '',
  network: 'tcp',
  wsPath: '',
  wsHost: '',
  security: 'tls',
  fingerprint: '',
  publicKey: '',
  shortId: '',
  alpn: '',
});

export function isProxyType(value: unknown): value is ProxyType {
  return typeof value === 'string' && (PROXY_TYPES as readonly string[]).includes(value);
}

export function normalizeProxyExtra(input: unknown): ProxyExtra {
  const base = emptyProxyExtra();
  if (!input || typeof input !== 'object') return base;
  const o = input as Record<string, unknown>;
  const method = String(o.method || '').trim();
  const network = o.network === 'ws' ? 'ws' : 'tcp';
  const security =
    o.security === 'none' || o.security === 'reality' || o.security === 'tls'
      ? o.security
      : 'tls';
  return {
    sni: String(o.sni || '').trim(),
    insecure: Boolean(o.insecure),
    method: method || base.method,
    plugin: String(o.plugin || '').trim(),
    pluginOpts: String(o.pluginOpts || '').trim(),
    flow: String(o.flow || '').trim(),
    network,
    wsPath: String(o.wsPath || '').trim(),
    wsHost: String(o.wsHost || '').trim(),
    security,
    fingerprint: String(o.fingerprint || '').trim(),
    publicKey: String(o.publicKey || '').trim(),
    shortId: String(o.shortId || '').trim(),
    alpn: String(o.alpn || '').trim(),
  };
}

export function stripHostBrackets(host: string) {
  const h = String(host || '').trim();
  if (h.startsWith('[') && h.endsWith(']')) return h.slice(1, -1);
  return h;
}

export function isIpAddress(host: string) {
  const h = stripHostBrackets(host);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(h)) return true;
  return h.includes(':');
}

function b64decode(value: string) {
  const norm = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm + '='.repeat((4 - (norm.length % 4)) % 4);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(pad, 'base64').toString('utf8');
  }
  return decodeURIComponent(escape(atob(pad)));
}

function decodeHashName(hash: string) {
  if (!hash) return '';
  try {
    return decodeURIComponent(hash);
  } catch {
    return hash;
  }
}

function parseSsUserinfo(userinfo: string) {
  const raw = decodeURIComponent(userinfo || '');
  const colon = raw.indexOf(':');
  if (colon > 0 && /^[a-z0-9-]+$/i.test(raw.slice(0, colon))) {
    return { method: raw.slice(0, colon), password: raw.slice(colon + 1) };
  }
  const decoded = b64decode(raw);
  const i = decoded.indexOf(':');
  if (i <= 0) throw new Error('Invalid Shadowsocks userinfo');
  return { method: decoded.slice(0, i), password: decoded.slice(i + 1) };
}

function defaultPort(type: ProxyType) {
  if (type === 'http') return 80;
  if (type === 'socks5') return 1080;
  if (type === 'ss') return 8388;
  return 443;
}

export interface ParsedProxyUri {
  name: string;
  type: ProxyType;
  host: string;
  port: number;
  username: string;
  password: string;
  extra: ProxyExtra;
}

function asUrl(raw: string) {
  return new URL(raw);
}

function fromHttpLike(url: URL, type: 'http' | 'https' | 'socks5'): ParsedProxyUri {
  const extra = emptyProxyExtra();
  extra.sni = url.searchParams.get('sni') || '';
  extra.insecure = url.searchParams.get('insecure') === '1';
  return {
    name: decodeHashName(url.hash.replace(/^#/, '')),
    type,
    host: stripHostBrackets(url.hostname),
    port: url.port ? Number(url.port) : defaultPort(type),
    username: decodeURIComponent(url.username || ''),
    password: decodeURIComponent(url.password || ''),
    extra,
  };
}

export function parseProxyUri(input: string): ParsedProxyUri {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Empty proxy URI');
  const scheme = raw.split(':', 1)[0].toLowerCase();

  if (scheme === 'ss') {
    const hashIndex = raw.indexOf('#');
    const body = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
    const name = decodeHashName(hashIndex >= 0 ? raw.slice(hashIndex + 1) : '');
    const rest = body.replace(/^ss:\/\//i, '');
    if (!rest.includes('@')) {
      const decoded = b64decode(rest);
      const at = decoded.lastIndexOf('@');
      if (at < 0) throw new Error('Invalid Shadowsocks URI');
      return parseProxyUri(`ss://${encodeURIComponent(decoded.slice(0, at))}@${decoded.slice(at + 1)}#${encodeURIComponent(name)}`);
    }
    const url = asUrl(body.includes('://') ? body : `ss://${rest}`);
    const userinfo = url.password
      ? `${url.username}:${url.password}`
      : decodeURIComponent(url.username || '');
    const { method, password } = parseSsUserinfo(userinfo);
    const extra = emptyProxyExtra();
    extra.method = method;
    extra.plugin = url.searchParams.get('plugin') || '';
    extra.pluginOpts = url.searchParams.get('plugin-opts') || '';
    if (extra.plugin.includes(';')) {
      const [plugin, ...opts] = extra.plugin.split(';');
      extra.plugin = plugin;
      extra.pluginOpts = extra.pluginOpts || opts.join(';');
    }
    return {
      name,
      type: 'ss',
      host: stripHostBrackets(url.hostname),
      port: url.port ? Number(url.port) : defaultPort('ss'),
      username: '',
      password,
      extra,
    };
  }

  if (scheme === 'anytls') {
    const url = asUrl(raw);
    const extra = emptyProxyExtra();
    extra.sni = url.searchParams.get('sni') || '';
    extra.insecure = url.searchParams.get('insecure') === '1' || url.searchParams.get('insecure') === 'true';
    extra.fingerprint = url.searchParams.get('fp') || url.searchParams.get('fingerprint') || '';
    extra.alpn = url.searchParams.get('alpn') || '';
    return {
      name: decodeHashName(url.hash.replace(/^#/, '')),
      type: 'anytls',
      host: stripHostBrackets(url.hostname),
      port: url.port ? Number(url.port) : defaultPort('anytls'),
      username: '',
      password: decodeURIComponent(url.username || ''),
      extra,
    };
  }

  if (scheme === 'vless') {
    const url = asUrl(raw);
    const extra = emptyProxyExtra();
    const typeParam = (url.searchParams.get('type') || 'tcp').toLowerCase();
    extra.network = typeParam === 'ws' ? 'ws' : 'tcp';
    extra.wsPath = url.searchParams.get('path') || '';
    extra.wsHost = url.searchParams.get('host') || '';
    extra.sni = url.searchParams.get('sni') || '';
    extra.flow = url.searchParams.get('flow') || '';
    extra.fingerprint = url.searchParams.get('fp') || url.searchParams.get('fingerprint') || '';
    extra.publicKey = url.searchParams.get('pbk') || url.searchParams.get('publicKey') || '';
    extra.shortId = url.searchParams.get('sid') || url.searchParams.get('shortId') || '';
    extra.alpn = url.searchParams.get('alpn') || '';
    extra.insecure =
      url.searchParams.get('allowInsecure') === '1' ||
      url.searchParams.get('insecure') === '1';
    const security = (url.searchParams.get('security') || 'none').toLowerCase();
    extra.security = security === 'reality' ? 'reality' : security === 'tls' ? 'tls' : 'none';
    return {
      name: decodeHashName(url.hash.replace(/^#/, '')),
      type: 'vless',
      host: stripHostBrackets(url.hostname),
      port: url.port ? Number(url.port) : defaultPort('vless'),
      username: '',
      password: decodeURIComponent(url.username || ''),
      extra,
    };
  }

  if (scheme === 'socks' || scheme === 'socks5' || scheme === 'socks5h') {
    return fromHttpLike(asUrl(raw.replace(/^socks5h/i, 'socks5').replace(/^socks:/i, 'socks5:')), 'socks5');
  }
  if (scheme === 'https') return fromHttpLike(asUrl(raw), 'https');
  if (scheme === 'http') return fromHttpLike(asUrl(raw), 'http');

  throw new Error(`Unsupported proxy URI scheme: ${scheme}`);
}

export function tryParseProxyUri(input: string): ParsedProxyUri | null {
  try {
    return parseProxyUri(input);
  } catch {
    return null;
  }
}
