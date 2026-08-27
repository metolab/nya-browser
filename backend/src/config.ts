import path from 'path';
import { normalizeBasePath } from '@nya/shared';

export const PORT = Number(process.env.PORT || 8080);
export const HOST = process.env.HOST || '0.0.0.0';
export const BASE_PATH = normalizeBasePath(process.env.BASE_PATH);
export const DATA_DIR = process.env.DATA_DIR || '/data';
export const STATIC_DIR =
  process.env.STATIC_DIR || path.resolve(process.cwd(), '../frontend/dist');
export const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'nya.db');
export const INIT_ADMIN_USER = process.env.INIT_ADMIN_USER || 'admin';
export const INIT_ADMIN_PASSWORD =
  process.env.INIT_ADMIN_PASSWORD || process.env.AUTH_PASSWORD || 'nya';
export const AUTH_TTL_MS = Number(process.env.AUTH_TTL_MS || 7 * 24 * 60 * 60 * 1000);
export const CHROME_BIN = process.env.CHROME_BIN || '/opt/nya-chromium/chrome';
export const SING_BOX_BIN = process.env.SING_BOX_BIN || '/usr/local/bin/sing-box';
