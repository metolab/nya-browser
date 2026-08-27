import { describe, expect, it } from 'vitest';
import {
  buildSingboxConfig,
  buildSingboxOutbound,
  emptyProxyExtra,
  parseProxyUri,
  tryParseProxyUri,
} from './index.js';

describe('parseProxyUri', () => {
  it('parses anytls', () => {
    const p = parseProxyUri('anytls://secret@proxy.example.com:443/?sni=www.cloudflare.com&insecure=1#Home');
    expect(p.type).toBe('anytls');
    expect(p.host).toBe('proxy.example.com');
    expect(p.port).toBe(443);
    expect(p.password).toBe('secret');
    expect(p.extra.sni).toBe('www.cloudflare.com');
    expect(p.extra.insecure).toBe(true);
    expect(p.name).toBe('Home');
  });

  it('parses ss sip002 base64 userinfo', () => {
    const userinfo = Buffer.from('aes-256-gcm:hunter2').toString('base64');
    const p = parseProxyUri(`ss://${userinfo}@ss.example.com:8388#n1`);
    expect(p.type).toBe('ss');
    expect(p.host).toBe('ss.example.com');
    expect(p.port).toBe(8388);
    expect(p.password).toBe('hunter2');
    expect(p.extra.method).toBe('aes-256-gcm');
    expect(p.name).toBe('n1');
  });

  it('parses ss method:password userinfo', () => {
    const p = parseProxyUri('ss://chacha20-ietf-poly1305:pass@10.0.0.1:10001');
    expect(p.extra.method).toBe('chacha20-ietf-poly1305');
    expect(p.password).toBe('pass');
    expect(p.host).toBe('10.0.0.1');
  });

  it('parses vless reality', () => {
    const p = parseProxyUri(
      'vless://11111111-1111-1111-1111-111111111111@v.example.com:443?type=tcp&security=reality&sni=www.microsoft.com&fp=chrome&pbk=pubkey&sid=abcd&flow=xtls-rprx-vision#v',
    );
    expect(p.type).toBe('vless');
    expect(p.password).toBe('11111111-1111-1111-1111-111111111111');
    expect(p.extra.security).toBe('reality');
    expect(p.extra.publicKey).toBe('pubkey');
    expect(p.extra.shortId).toBe('abcd');
    expect(p.extra.flow).toBe('xtls-rprx-vision');
    expect(p.extra.fingerprint).toBe('chrome');
  });

  it('parses vless ws+tls', () => {
    const p = parseProxyUri(
      'vless://11111111-1111-1111-1111-111111111111@v.example.com:443?type=ws&security=tls&path=%2Fws&host=v.example.com&sni=v.example.com',
    );
    expect(p.extra.network).toBe('ws');
    expect(p.extra.wsPath).toBe('/ws');
    expect(p.extra.wsHost).toBe('v.example.com');
    expect(p.extra.security).toBe('tls');
  });

  it('parses socks5 and http', () => {
    expect(parseProxyUri('socks5://u:p@127.0.0.1:1080').type).toBe('socks5');
    expect(parseProxyUri('http://u:p@127.0.0.1:8080').password).toBe('p');
    expect(tryParseProxyUri('not-a-uri')).toBeNull();
  });
});

describe('buildSingboxConfig', () => {
  it('builds http outbound through mixed inbound', () => {
    const cfg = buildSingboxConfig({
      listenPort: 18001,
      proxy: {
        type: 'http',
        host: '10.1.1.1',
        port: 8080,
        username: 'u',
        password: 'p',
        extra: emptyProxyExtra(),
      },
    });
    expect(cfg.inbounds).toEqual([
      expect.objectContaining({ type: 'mixed', listen: '127.0.0.1', listen_port: 18001 }),
    ]);
    expect(cfg.outbounds).toEqual([
      expect.objectContaining({
        type: 'http',
        server: '10.1.1.1',
        server_port: 8080,
        username: 'u',
        password: 'p',
      }),
    ]);
    expect(cfg.route).toEqual(
      expect.objectContaining({
        final: 'proxy',
        rules: expect.arrayContaining([expect.objectContaining({ action: 'reject' })]),
      }),
    );
  });

  it('enables tls for https proxy', () => {
    const outbound = buildSingboxOutbound({
      type: 'https',
      host: 'proxy.example.com',
      port: 443,
      username: '',
      password: '',
      extra: { ...emptyProxyExtra(), sni: 'proxy.example.com' },
    });
    expect(outbound.type).toBe('http');
    expect(outbound.tls).toEqual(expect.objectContaining({ enabled: true, server_name: 'proxy.example.com' }));
  });

  it('builds ss / anytls / vless outbounds', () => {
    expect(
      buildSingboxOutbound({
        type: 'ss',
        host: 'ss.example.com',
        port: 8388,
        username: '',
        password: 'pw',
        extra: { ...emptyProxyExtra(), method: 'chacha20-ietf-poly1305' },
      }),
    ).toEqual(
      expect.objectContaining({
        type: 'shadowsocks',
        method: 'chacha20-ietf-poly1305',
        password: 'pw',
      }),
    );
    expect(
      buildSingboxOutbound({
        type: 'anytls',
        host: 'a.example.com',
        port: 443,
        username: '',
        password: 'secret',
        extra: { ...emptyProxyExtra(), sni: 'www.example.com', insecure: true },
      }),
    ).toEqual(
      expect.objectContaining({
        type: 'anytls',
        password: 'secret',
        tls: expect.objectContaining({ enabled: true, server_name: 'www.example.com', insecure: true }),
      }),
    );
    const vless = buildSingboxOutbound({
      type: 'vless',
      host: 'v.example.com',
      port: 443,
      username: '',
      password: '11111111-1111-1111-1111-111111111111',
      extra: {
        ...emptyProxyExtra(),
        security: 'reality',
        publicKey: 'pk',
        shortId: 'ab',
        flow: 'xtls-rprx-vision',
        fingerprint: 'chrome',
        sni: 'www.microsoft.com',
      },
    });
    expect(vless).toEqual(
      expect.objectContaining({
        type: 'vless',
        uuid: '11111111-1111-1111-1111-111111111111',
        flow: 'xtls-rprx-vision',
        tls: expect.objectContaining({
          enabled: true,
          server_name: 'www.microsoft.com',
          reality: { enabled: true, public_key: 'pk', short_id: 'ab' },
          utls: { enabled: true, fingerprint: 'chrome' },
        }),
      }),
    );
  });

  it('can omit loopback reject for tests', () => {
    const cfg = buildSingboxConfig({
      listenPort: 1,
      blockLoopback: false,
      proxy: {
        type: 'socks5',
        host: '127.0.0.1',
        port: 1080,
        username: '',
        password: '',
        extra: emptyProxyExtra(),
      },
    });
    expect(cfg.route).toEqual(expect.objectContaining({ rules: [] }));
  });
});
