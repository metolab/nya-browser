import { Router } from 'express';
import { AUTH_COOKIE, AUDIT_ACTIONS, loginSchema } from '@nya/shared';
import { asyncHandler, clientIp } from '../../http/util.js';
import { cookieOptions, issueToken, revokeToken, verifyUser } from './service.js';
import { writeAudit } from '../audit/service.js';

const loginHits = new Map<string, number[]>();

function limited(ip: string) {
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const prev = (loginHits.get(ip) || []).filter((t) => now - t < windowMs);
  prev.push(now);
  loginHits.set(ip, prev);
  return prev.length > Number(process.env.LOGIN_RATE_LIMIT || 80);
}

export const publicAuthRouter = Router();
export const privateAuthRouter = Router();

publicAuthRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    const ip = clientIp(req);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    if (limited(ip)) {
      writeAudit({
        action: AUDIT_ACTIONS.loginFailed,
        ip,
        success: false,
        detail: { reason: 'rate_limited' },
      });
      return res.status(429).json({ error: 'Too many attempts' });
    }
    const user = await verifyUser(parsed.data.username, parsed.data.password);
    if (!user) {
      writeAudit({
        actorUsername: parsed.data.username,
        action: AUDIT_ACTIONS.loginFailed,
        ip,
        success: false,
      });
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    const token = issueToken(user.id);
    res.cookie(AUTH_COOKIE, token, cookieOptions());
    writeAudit({
      actorId: user.id,
      actorUsername: user.username,
      action: AUDIT_ACTIONS.login,
      ip,
      success: true,
    });
    res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        disabled: Boolean(user.disabled),
        createdAt: user.createdAt,
      },
    });
  }),
);

privateAuthRouter.post(
  '/logout',
  asyncHandler((req, res) => {
    const token = req.cookies?.[AUTH_COOKIE];
    revokeToken(token);
    writeAudit({
      actorId: req.user?.id,
      actorUsername: req.user?.username,
      action: AUDIT_ACTIONS.logout,
      ip: clientIp(req),
      success: true,
    });
    res.clearCookie(AUTH_COOKIE, { path: '/' });
    res.json({ ok: true });
  }),
);

privateAuthRouter.get(
  '/me',
  asyncHandler((req, res) => {
    res.json({ user: req.user });
  }),
);
