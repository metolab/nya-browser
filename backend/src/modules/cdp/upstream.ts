import http from 'http';
import type { Request } from 'express';
import { joinBasePath } from '@nya/shared';
import { BASE_PATH } from '../../config.js';
import { getRuntime } from '../../runtime/sessionManager.js';
import { HttpError } from '../../http/access.js';

export type CdpVersion = {
  Browser?: string;
  'Protocol-Version'?: string;
  'User-Agent'?: string;
  'V8-Version'?: string;
  'WebKit-Version'?: string;
  webSocketDebuggerUrl?: string;
};

export type CdpTarget = {
  id: string;
  type: string;
  title?: string;
  url?: string;
  parentId?: string;
  description?: string;
  faviconUrl?: string;
  devtoolsFrontendUrl?: string;
  webSocketDebuggerUrl?: string;
};

export const TARGET_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function getCdpJson<T>(port: number, pathname: string, timeoutMs = 3000) {
  return new Promise<T>((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname, timeout: timeoutMs }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
      });
      res.on('end', () => {
        if ((res.statusCode || 0) >= 400) {
          reject(new Error(`CDP HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(buf) as T);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('CDP timeout')));
    req.on('error', reject);
  });
}

/** Local CDP port of a running session, or an HttpError the caller can surface. */
export function sessionCdpPort(sessionId: string): number {
  const runtime = getRuntime(sessionId);
  if (!runtime) throw new HttpError(409, 'Session is not running', { code: 'SESSION_NOT_RUNNING' });
  if (!runtime.cdpPort) throw new HttpError(409, 'CDP is disabled on this server', { code: 'CDP_DISABLED' });
  return runtime.cdpPort as number;
}

export async function browserVersion(port: number) {
  try {
    const version = await getCdpJson<CdpVersion>(port, '/json/version');
    if (!version.webSocketDebuggerUrl) throw new Error('missing webSocketDebuggerUrl');
    return version;
  } catch {
    throw new HttpError(503, 'Browser is not ready for CDP yet', { code: 'CDP_NOT_READY' });
  }
}

function firstHeader(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw ? raw.split(',')[0].trim() : '';
}

export function publicCdpUrls(req: Request, sessionId: string) {
  const proto = req.protocol === 'https' ? 'https' : 'http';
  const host = firstHeader(req.headers['x-forwarded-host']) || req.get('host') || '127.0.0.1';
  const id = encodeURIComponent(sessionId);
  const token = typeof req.query.token === 'string' && req.query.token ? req.query.token : '';
  const suffix = token ? `?token=${encodeURIComponent(token)}` : '';
  const wsBase = `${proto === 'https' ? 'wss' : 'ws'}://${host}${joinBasePath(BASE_PATH, `/ws/cdp/${id}`)}`;
  return {
    wsUrl: `${wsBase}${suffix}`,
    httpUrl: `${proto}://${host}${joinBasePath(BASE_PATH, `/api/sessions/${id}/cdp`)}`,
    pageWsUrl: (targetId: string) => `${wsBase}/page/${encodeURIComponent(targetId)}${suffix}`,
  };
}
