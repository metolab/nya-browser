import { desc, eq, and, gte, lte } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../../db/client.js';
import { auditLogs } from '../../db/schema.js';
import { asyncHandler, requireAdmin } from '../../http/util.js';

export const auditRouter = Router();
auditRouter.use(requireAdmin);

auditRouter.get(
  '/',
  asyncHandler((req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const actorId = typeof req.query.actorId === 'string' ? req.query.actorId : '';
    const action = typeof req.query.action === 'string' ? req.query.action : '';
    const from = typeof req.query.from === 'string' ? req.query.from : '';
    const to = typeof req.query.to === 'string' ? req.query.to : '';

    const conds = [];
    if (actorId) conds.push(eq(auditLogs.actorId, actorId));
    if (action) conds.push(eq(auditLogs.action, action));
    if (from) conds.push(gte(auditLogs.at, from));
    if (to) conds.push(lte(auditLogs.at, to));

    const rows = (
      conds.length
        ? db.select().from(auditLogs).where(and(...conds)).orderBy(desc(auditLogs.at)).limit(limit)
        : db.select().from(auditLogs).orderBy(desc(auditLogs.at)).limit(limit)
    ).all();

    res.json({
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
