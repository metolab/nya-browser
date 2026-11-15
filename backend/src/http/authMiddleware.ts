import type { Request, Response, NextFunction } from 'express';
import { AUTH_COOKIE } from '@nya/shared';
import { resolveAuth } from '../modules/auth/service.js';

function readToken(req: Request) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const apiKey = typeof req.headers['x-api-key'] === 'string' ? req.headers['x-api-key'] : '';
  const q = typeof req.query.token === 'string' ? req.query.token : '';
  return req.cookies?.[AUTH_COOKIE] || bearer || apiKey || q || '';
}

function applyAuth(req: Request, token: string) {
  const auth = resolveAuth(token);
  if (!auth) return false;
  req.user = auth.user;
  req.authToken = token;
  req.apiKeyId = auth.apiKeyId;
  return true;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!applyAuth(req, readToken(req))) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  applyAuth(req, readToken(req));
  next();
}

export function readAuthToken(req: Request) {
  return readToken(req);
}
