import { describe, expect, it } from 'vitest';
import { proxyConnectivityChanged, proxyTestPublicIpChanged } from './proxyLastTest.js';

const base = {
  type: 'http',
  host: '127.0.0.1',
  port: 8080,
  username: 'u',
  password: 'p',
  extra: { sni: '' },
  viaProxyId: null as string | null,
};

describe('proxyConnectivityChanged', () => {
  it('ignores name-only equivalent connectivity fields', () => {
    expect(proxyConnectivityChanged(base, { ...base })).toBe(false);
  });

  it('restarts when a failed retest drops the previous exit IP', () => {
    expect(
      proxyTestPublicIpChanged({ ok: true, exitIp: '203.0.113.10' }, { ok: false, exitIp: null }),
    ).toBe(true);
    expect(
      proxyTestPublicIpChanged({ ok: true, exitIp: '203.0.113.10' }, { ok: true, exitIp: '203.0.113.10' }),
    ).toBe(false);
    expect(proxyTestPublicIpChanged(null, { ok: false, exitIp: null })).toBe(false);
    expect(proxyTestPublicIpChanged(null, { ok: true, exitIp: '203.0.113.10' })).toBe(true);
  });

  it('detects host, credentials, extra, and chain changes', () => {
    expect(proxyConnectivityChanged(base, { ...base, host: '10.0.0.1' })).toBe(true);
    expect(proxyConnectivityChanged(base, { ...base, password: 'other' })).toBe(true);
    expect(proxyConnectivityChanged(base, { ...base, extra: { sni: 'a.example' } })).toBe(true);
    expect(proxyConnectivityChanged(base, { ...base, viaProxyId: 'front-1' })).toBe(true);
  });
});
