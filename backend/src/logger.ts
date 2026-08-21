import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { DATA_DIR } from './config.js';

const logDir = path.join(DATA_DIR, 'logs');
fs.mkdirSync(logDir, { recursive: true });

const dest = pino.destination({
  dest: path.join(logDir, 'app.log'),
  sync: false,
  mkdir: true,
});

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    base: undefined,
  },
  dest,
);

export const APP_LOG_PATH = path.join(logDir, 'app.log');
