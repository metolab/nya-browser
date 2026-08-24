import path from 'path';
import fs from 'fs';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { injectIndexHtml } from '@nya/shared';
import { BASE_PATH, STATIC_DIR } from './config.js';
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

function sendIndex(_req: express.Request, res: express.Response, next: express.NextFunction) {
  const file = path.join(STATIC_DIR, 'index.html');
  fs.readFile(file, 'utf8', (err, html) => {
    if (err) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(injectIndexHtml(html, BASE_PATH));
  });
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  const routed = express.Router();
  routed.use(cors({ origin: true, credentials: true }));
  routed.use(express.json({ limit: '2mb' }));
  routed.use(cookieParser());

  routed.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  routed.get('/api/ping', (_req, res) => {
    res.json({ t: Date.now() });
  });

  routed.use('/api', publicAuthRouter);
  routed.use('/api', authMiddleware);
  routed.use('/api', privateAuthRouter);
  routed.use('/api/users', usersRouter);
  routed.use('/api/proxies', proxiesRouter);
  routed.use('/api/audit', auditRouter);
  routed.use('/api/monitor', monitorRouter);
  routed.use('/api/live', liveRouter);
  routed.use('/api/groups', groupsRouter);
  routed.use('/api', backupRouter);
  routed.use('/api/sessions', sessionsRouter);

  routed.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, 'request failed');
    if (res.headersSent) return;
    res.status(500).json({ error: err.message || 'Internal error' });
  });

  if (fs.existsSync(STATIC_DIR)) {
    routed.use(express.static(STATIC_DIR, { index: false }));
    routed.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
      sendIndex(req, res, next);
    });
  }

  if (BASE_PATH !== '/') {
    app.get('/api/health', (_req, res) => {
      res.json({ ok: true });
    });
    app.get('/', (_req, res) => {
      res.redirect(302, `${BASE_PATH}/`);
    });
  }

  app.use(BASE_PATH, routed);
  return app;
}
