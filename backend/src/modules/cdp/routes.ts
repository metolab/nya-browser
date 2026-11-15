import { Router, type Request } from 'express';
import { asyncHandler } from '../../http/util.js';
import { assertSessionAccess, handleHttpError } from '../../http/access.js';
import {
  browserVersion,
  getCdpJson,
  publicCdpUrls,
  sessionCdpPort,
  type CdpTarget,
} from './upstream.js';

export const cdpRouter = Router({ mergeParams: true });

function sessionId(req: Request) {
  return String(req.params.id);
}

cdpRouter.use((req, res, next) => {
  try {
    assertSessionAccess(req, sessionId(req));
    next();
  } catch (err) {
    handleHttpError(err, res);
  }
});

cdpRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    try {
      const id = sessionId(req);
      const version = await browserVersion(sessionCdpPort(id));
      const urls = publicCdpUrls(req, id);
      res.json({
        wsUrl: urls.wsUrl,
        httpUrl: urls.httpUrl,
        browser: version.Browser || null,
        protocolVersion: version['Protocol-Version'] || null,
        userAgent: version['User-Agent'] || null,
      });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

cdpRouter.get(
  '/json/version',
  asyncHandler(async (req, res) => {
    try {
      const id = sessionId(req);
      const version = await browserVersion(sessionCdpPort(id));
      res.json({ ...version, webSocketDebuggerUrl: publicCdpUrls(req, id).wsUrl });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

cdpRouter.get(
  ['/json', '/json/list'],
  asyncHandler(async (req, res) => {
    try {
      const id = sessionId(req);
      const port = sessionCdpPort(id);
      const urls = publicCdpUrls(req, id);
      let targets: CdpTarget[];
      try {
        targets = await getCdpJson<CdpTarget[]>(port, '/json/list');
      } catch {
        return res.status(503).json({ error: 'Browser is not ready for CDP yet', code: 'CDP_NOT_READY' });
      }
      res.json(
        targets.map(({ devtoolsFrontendUrl: _frontend, ...t }) => ({
          ...t,
          webSocketDebuggerUrl: urls.pageWsUrl(t.id),
        })),
      );
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);
