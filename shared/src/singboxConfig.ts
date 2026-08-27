import {
  emptyProxyExtra,
  isIpAddress,
  isProxyType,
  stripHostBrackets,
  type ProxyExtra,
  type ProxyType,
} from './proxy.js';

export interface SingboxProxyInput {
  type: ProxyType | 'none';
  host: string;
  port: number | null;
  username: string;
  password: string;
  extra?: ProxyExtra | null;
}

export interface BuildSingboxConfigOptions {
  listenHost?: string;
  listenPort: number;
  proxy: SingboxProxyInput;
  via?: SingboxProxyInput[];
  logPath?: string;
  blockLoopback?: boolean;
}

function extraOf(proxy: SingboxProxyInput): ProxyExtra {
  return proxy.extra ? { ...emptyProxyExtra(), ...proxy.extra } : emptyProxyExtra();
}

function serverOf(proxy: SingboxProxyInput) {
  return stripHostBrackets(proxy.host);
}

function alpnList(extra: ProxyExtra) {
  return extra.alpn
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function tlsObject(proxy: SingboxProxyInput, enabled: boolean) {
  if (!enabled) return undefined;
  const extra = extraOf(proxy);
  const server = serverOf(proxy);
  const sni = extra.sni || (isIpAddress(server) ? '' : server);
  const tls: Record<string, unknown> = {
    enabled: true,
    insecure: extra.insecure,
  };
  if (sni) tls.server_name = sni;
  const alpn = alpnList(extra);
  if (alpn.length) tls.alpn = alpn;
  const fingerprint =
    extra.fingerprint || (extra.security === 'reality' ? 'chrome' : '');
  if (fingerprint) {
    tls.utls = { enabled: true, fingerprint };
  }
  if (extra.security === 'reality') {
    tls.reality = {
      enabled: true,
      public_key: extra.publicKey,
      short_id: extra.shortId,
    };
  }
  return tls;
}

function vlessTransport(extra: ProxyExtra) {
  if (extra.network !== 'ws') return undefined;
  const headers: Record<string, string> = {};
  if (extra.wsHost) headers.Host = extra.wsHost;
  return {
    type: 'ws',
    path: extra.wsPath || '/',
    ...(Object.keys(headers).length ? { headers } : {}),
  };
}

export function buildSingboxOutbound(
  proxy: SingboxProxyInput,
  opts: { tag?: string; detour?: string } = {},
): Record<string, unknown> {
  if (!isProxyType(proxy.type)) {
    throw new Error('Invalid proxy type');
  }
  if (!proxy.host || !proxy.port) {
    throw new Error('Proxy host and port are required');
  }
  const extra = extraOf(proxy);
  const server = serverOf(proxy);
  const port = proxy.port;
  const tag = opts.tag || 'proxy';
  const detour = opts.detour;

  let outbound: Record<string, unknown>;

  if (proxy.type === 'http' || proxy.type === 'https') {
    outbound = {
      type: 'http',
      tag,
      server,
      server_port: port,
    };
    if (proxy.username) outbound.username = proxy.username;
    if (proxy.password) outbound.password = proxy.password;
    const tls = tlsObject({ ...proxy, extra: { ...extra, security: 'tls' } }, proxy.type === 'https');
    if (tls) outbound.tls = tls;
  } else if (proxy.type === 'socks5') {
    outbound = {
      type: 'socks',
      tag,
      server,
      server_port: port,
      version: '5',
    };
    if (proxy.username) outbound.username = proxy.username;
    if (proxy.password) outbound.password = proxy.password;
  } else if (proxy.type === 'ss') {
    if (!proxy.password) throw new Error('Shadowsocks password is required');
    outbound = {
      type: 'shadowsocks',
      tag,
      server,
      server_port: port,
      method: extra.method || 'aes-256-gcm',
      password: proxy.password,
    };
    if (extra.plugin) {
      outbound.plugin = extra.plugin;
      if (extra.pluginOpts) outbound.plugin_opts = extra.pluginOpts;
    }
  } else if (proxy.type === 'anytls') {
    if (!proxy.password) throw new Error('AnyTLS password is required');
    const tls = tlsObject({ ...proxy, extra: { ...extra, security: extra.security === 'none' ? 'tls' : extra.security } }, true);
    outbound = {
      type: 'anytls',
      tag,
      server,
      server_port: port,
      password: proxy.password,
      tls,
    };
  } else if (proxy.type === 'vless') {
    if (!proxy.password) throw new Error('VLESS uuid is required');
    outbound = {
      type: 'vless',
      tag,
      server,
      server_port: port,
      uuid: proxy.password,
      packet_encoding: 'xudp',
    };
    if (extra.flow) outbound.flow = extra.flow;
    const tls = tlsObject(proxy, extra.security !== 'none');
    if (tls) outbound.tls = tls;
    const transport = vlessTransport(extra);
    if (transport) outbound.transport = transport;
  } else {
    throw new Error(`Unsupported proxy type: ${proxy.type}`);
  }

  if (detour) outbound.detour = detour;
  return outbound;
}

export function buildSingboxConfig(opts: BuildSingboxConfigOptions): Record<string, unknown> {
  const listenHost = opts.listenHost || '127.0.0.1';
  const blockLoopback = opts.blockLoopback !== false;
  const via = opts.via || [];
  const viaTags = via.map((_, i) => `via-${i}`);
  const outbounds = [
    buildSingboxOutbound(opts.proxy, { tag: 'proxy', detour: viaTags[0] }),
    ...via.map((hop, i) => buildSingboxOutbound(hop, { tag: viaTags[i], detour: viaTags[i + 1] })),
  ];
  const rules: Record<string, unknown>[] = [];
  if (blockLoopback) {
    rules.push(
      { domain: ['localhost'], action: 'reject' },
      { ip_cidr: ['127.0.0.0/8', '::1/128', '0.0.0.0/8'], action: 'reject' },
    );
  }
  return {
    log: {
      level: 'warn',
      timestamp: true,
      ...(opts.logPath ? { output: opts.logPath } : {}),
    },
    dns: {
      servers: [{ type: 'local', tag: 'local' }],
      strategy: 'prefer_ipv4',
    },
    inbounds: [
      {
        type: 'mixed',
        tag: 'mixed-in',
        listen: listenHost,
        listen_port: opts.listenPort,
      },
    ],
    outbounds,
    route: {
      rules,
      final: 'proxy',
      default_domain_resolver: 'local',
    },
  };
}
