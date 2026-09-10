export function proxyTestPublicIpChanged(
  previous: { ok?: boolean; exitIp?: string | null } | null | undefined,
  next: { ok?: boolean; exitIp?: string | null } | null | undefined,
) {
  const before = previous?.ok ? String(previous.exitIp || '') : '';
  const after = next?.ok ? String(next.exitIp || '') : '';
  return before !== after;
}

export function proxyConnectivityChanged(
  current: {
    type: string;
    host: string;
    port: number;
    username: string;
    password: string;
    extra: unknown;
    viaProxyId: string | null;
  },
  next: {
    type: string;
    host: string;
    port: number;
    username: string;
    password: string;
    extra: unknown;
    viaProxyId: string | null;
  },
) {
  return (
    next.type !== current.type ||
    next.host !== current.host ||
    next.port !== current.port ||
    next.username !== current.username ||
    next.password !== current.password ||
    JSON.stringify(next.extra) !== JSON.stringify(current.extra) ||
    (next.viaProxyId || null) !== (current.viaProxyId || null)
  );
}
