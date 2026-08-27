import { expect, test } from '@playwright/test';
import { asAdmin } from '../helpers';

test('proxy catalog and test', async () => {
  const admin = await asAdmin();
  const created = await admin.post('/api/proxies', {
    data: {
      name: `proxy-${Date.now()}`,
      type: 'http',
      host: '127.0.0.1',
      port: 9,
    },
  });
  expect(created.status()).toBe(201);
  const proxy = (await created.json()).proxy;
  expect(proxy.type).toBe('http');

  const listed = await admin.get('/api/proxies');
  expect((await listed.json()).proxies.some((p: { id: string }) => p.id === proxy.id)).toBeTruthy();

  const patched = await admin.patch(`/api/proxies/${proxy.id}`, {
    data: { name: `proxy-edit-${Date.now()}`, host: '127.0.0.2' },
  });
  expect(patched.ok()).toBeTruthy();
  expect((await patched.json()).proxy.host).toBe('127.0.0.2');

  const tested = await admin.post(`/api/proxies/${proxy.id}/test`);
  expect(tested.ok()).toBeTruthy();
  const result = (await tested.json()).result;
  expect(result.ok).toBeFalsy();
  expect(result.error).toBeTruthy();

  const socks = await admin.post('/api/proxies', {
    data: { name: `socks-${Date.now()}`, type: 'socks5', host: '127.0.0.1', port: 1080 },
  });
  expect(socks.status()).toBe(201);

  const ss = await admin.post('/api/proxies', {
    data: {
      name: `ss-${Date.now()}`,
      type: 'ss',
      host: '127.0.0.1',
      port: 8388,
      password: 'secret',
      extra: { method: 'aes-256-gcm' },
    },
  });
  expect(ss.status()).toBe(201);

  const vless = await admin.post('/api/proxies', {
    data: {
      name: `vless-${Date.now()}`,
      type: 'vless',
      host: 'example.com',
      port: 443,
      password: '11111111-1111-1111-1111-111111111111',
      extra: { security: 'tls', sni: 'example.com' },
    },
  });
  expect(vless.status()).toBe(201);

  const anytls = await admin.post('/api/proxies', {
    data: {
      name: `anytls-${Date.now()}`,
      type: 'anytls',
      host: 'example.com',
      port: 443,
      password: 'secret',
      extra: { sni: 'www.example.com', insecure: true },
    },
  });
  expect(anytls.status()).toBe(201);

  await admin.delete(`/api/proxies/${proxy.id}`);
  await admin.delete(`/api/proxies/${(await socks.json()).proxy.id}`);
  await admin.delete(`/api/proxies/${(await ss.json()).proxy.id}`);
  await admin.delete(`/api/proxies/${(await vless.json()).proxy.id}`);
  await admin.delete(`/api/proxies/${(await anytls.json()).proxy.id}`);
  await admin.dispose();
});
