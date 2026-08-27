import http from 'http';
import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { ProxyRecord, ProxyTestResult } from '@nya/shared';
import { regionFromLoc } from '@nya/shared';
import { withEphemeralSidecar } from '../../runtime/singbox.js';

const TEST_URL = process.env.PROXY_TEST_URL || 'https://cp.cloudflare.com/cdn-cgi/trace';
const TIMEOUT_MS = Number(process.env.PROXY_TEST_TIMEOUT_MS || 12000);

function parseTrace(body: string) {
  const map: Record<string, string> = {};
  for (const line of body.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    map[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const loc = map.loc || null;
  return {
    exitIp: map.ip || null,
    loc,
    colo: map.colo || null,
    region: regionFromLoc(loc),
  };
}

function requestText(url: string, agent: unknown): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method: 'GET',
        agent: agent as http.Agent,
        timeout: TIMEOUT_MS,
        headers: { 'User-Agent': 'nya-browser-proxy-test' },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function testProxy(proxy: ProxyRecord): Promise<ProxyTestResult> {
  const started = Date.now();
  const empty = { exitIp: null, loc: null, colo: null, region: null };
  try {
    const result = await withEphemeralSidecar(proxy, async (port) => {
      const agent = new HttpsProxyAgent(`http://127.0.0.1:${port}`);
      const { status, body } = await requestText(TEST_URL, agent);
      const latencyMs = Date.now() - started;
      if (status < 200 || status >= 300) {
        return { ok: false, latencyMs, ...empty, error: `HTTP ${status}` };
      }
      const parsed = parseTrace(body);
      if (!parsed.exitIp && !parsed.loc) {
        return { ok: false, latencyMs, ...empty, error: 'unexpected trace response' };
      }
      return { ok: true, latencyMs, ...parsed, error: null };
    });
    return result;
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      ...empty,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
