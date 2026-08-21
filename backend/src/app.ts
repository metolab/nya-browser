import path from 'path';
import fs from 'fs';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { STATIC_DIR } from './config.js';
import { authMiddleware } from './http/authMiddleware.js';
import { publicAuthRouter, privateAuthRouter } from './modules/auth/routes.js';
import { usersRouter } from './modules/users/routes.js';
import { sessionsRouter } from './modules/sessions/routes.js';
import { proxiesRouter } from './modules/proxies/routes.js';
import { auditRouter } from './modules/audit/routes.js';
import { liveRouter, monitorRouter } from './modules/monitor/routes.js';
import { groupsRouter } from './modules/groups/routes.js';
import { backupRouter } from './modules/backup/routes.js';
import { logger } from './logger.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/api/ping', (_req, res) => {
    res.json({ t: Date.now() });
  });

  app.use('/api', publicAuthRouter);
  app.use('/api', authMiddleware);
  app.use('/api', privateAuthRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/proxies', proxiesRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/monitor', monitorRouter);
  app.use('/api/live', liveRouter);
  app.use('/api/groups', groupsRouter);
  app.use('/api', backupRouter);
  app.use('/api/sessions', sessionsRouter);

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, 'request failed');
    if (res.headersSent) return;
    res.status(500).json({ error: err.message || 'Internal error' });
  });

  if (fs.existsSync(STATIC_DIR)) {
    app.use(express.static(STATIC_DIR));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
      res.sendFile(path.join(STATIC_DIR, 'index.html'));
    });
  }

  return app;
}
