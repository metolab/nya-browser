import type { Request, Response, NextFunction } from 'express';
import { AUTH_COOKIE } from '@nya/shared';
import { resolveToken } from '../modules/auth/service.js';

function readToken(req: Request) {
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const q = typeof req.query.token === 'string' ? req.query.token : '';
  return req.cookies?.[AUTH_COOKIE] || bearer || q || '';
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = readToken(req);
  const user = resolveToken(token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  req.user = user;
  req.authToken = token;
  next();
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = readToken(req);
  const user = resolveToken(token);
  if (user) {
    req.user = user;
    req.authToken = token;
  }
  next();
}

export function readAuthToken(req: Request) {
  return readToken(req);
}
