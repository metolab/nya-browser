import { count, desc, eq, and, gte, lte } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../../db/client.js';
import { auditLogs } from '../../db/schema.js';
import { asyncHandler, requireAdmin } from '../../http/util.js';

export const auditRouter = Router();
auditRouter.use(requireAdmin);

auditRouter.get(
  '/',
  asyncHandler((req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const actorId = typeof req.query.actorId === 'string' ? req.query.actorId.trim() : '';
    const action = typeof req.query.action === 'string' ? req.query.action.trim() : '';
    const from = typeof req.query.from === 'string' ? req.query.from : '';
    const to = typeof req.query.to === 'string' ? req.query.to : '';

    const conds = [];
    if (actorId) conds.push(eq(auditLogs.actorId, actorId));
    if (action) conds.push(eq(auditLogs.action, action));
    if (from) conds.push(gte(auditLogs.at, from));
    if (to) conds.push(lte(auditLogs.at, to));
    const where = conds.length ? and(...conds) : undefined;

    const total = Number(
      (where
        ? db.select({ n: count() }).from(auditLogs).where(where).get()
        : db.select({ n: count() }).from(auditLogs).get()
      )?.n || 0,
    );

    const rows = (
      where
        ? db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.at)).limit(limit).offset(offset)
        : db.select().from(auditLogs).orderBy(desc(auditLogs.at)).limit(limit).offset(offset)
    ).all();

    res.json({
      total,
      limit,
      offset,
      logs: rows.map((r) => ({
        id: r.id,
        at: r.at,
        actorId: r.actorId,
        actorUsername: r.actorUsername,
        action: r.action,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        ip: r.ip,
        success: Boolean(r.success),
        detail: r.detail ? JSON.parse(r.detail) : null,
      })),
    });
  }),
);
