import path from 'path';
import { Router } from 'express';
import { APP_LOG_PATH } from '../../logger.js';
import { asyncHandler, requireAdmin } from '../../http/util.js';
import { getSnapshot, tailFile } from './sampler.js';
import { sessionDir } from '../../store.js';
import { getSession } from '../../store.js';
import { getRuntimePublic, listRunningIds } from '../../runtime/sessionManager.js';
import { presentSession } from '../sessions/present.js';
import { getUserById } from '../auth/service.js';

const LOG_FILES: Record<string, string> = {
  chrome: 'chrome.log',
  x11vnc: 'x11vnc.log',
  openbox: 'openbox.log',
  xvfb: 'xvfb.log',
};

export const monitorRouter = Router();
monitorRouter.use(requireAdmin);

const liveHandler = asyncHandler((req, res) => {
  const sessions = listRunningIds()
    .map((id) => getSession(id))
    .filter(Boolean)
    .map((s) => {
      const presented = presentSession(s!, req.user);
      const snap = getSnapshot().sessions.find((x) => x.sessionId === s!.id);
      const liveWindows = presented.runtime.windows || [];
      const viewerCount = liveWindows.reduce((n, w) => n + (w.vncConnections || 0), 0);
      return {
        session: presented,
        windows: liveWindows.map((w) => {
          const extra = snap?.windows?.find((x) => x.id === w.id);
          const owner = w.ownerUserId ? getUserById(w.ownerUserId) : null;
          return {
            ...w,
            usage: extra && 'usage' in extra ? extra.usage : undefined,
            ownerUsername: owner?.username || null,
          };
        }),
        chrome: snap?.chrome || { pid: null, rssBytes: 0, cpuPercent: 0 },
        viewerCount,
      };
    });
  res.json({ sessions });
});

monitorRouter.get('/', asyncHandler((_req, res) => {
  res.json({ monitor: getSnapshot() });
}));

monitorRouter.get('/live', liveHandler);

export const liveRouter = Router();
liveRouter.use(requireAdmin);
liveRouter.get('/', liveHandler);

monitorRouter.get(
  '/logs/app',
  asyncHandler((req, res) => {
    const tail = Math.min(2000, Math.max(20, Number(req.query.tail) || 200));
    res.json({ path: APP_LOG_PATH, content: tailFile(APP_LOG_PATH, tail) });
  }),
);

monitorRouter.get(
  '/sessions/:id/logs',
  asyncHandler((req, res) => {
    if (!getSession(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const file = String(req.query.file || 'chrome');
    const name = LOG_FILES[file];
    if (!name) return res.status(400).json({ error: 'Unknown log file' });
    const tail = Math.min(2000, Math.max(20, Number(req.query.tail) || 200));
    const full = path.join(sessionDir(req.params.id), name);
    res.json({
      file,
      running: Boolean(getRuntimePublic(req.params.id)),
      content: tailFile(full, tail),
    });
  }),
);
