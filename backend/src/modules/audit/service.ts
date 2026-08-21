import { nanoid } from 'nanoid';
import type { Request } from 'express';
import { db } from '../../db/client.js';
import { auditLogs } from '../../db/schema.js';
import { clientIp } from '../../http/util.js';

export function writeAudit(input: {
  actorId?: string | null;
  actorUsername?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  ip?: string | null;
  success: boolean;
  detail?: Record<string, unknown> | null;
}) {
  db.insert(auditLogs)
    .values({
      id: nanoid(12),
      at: new Date().toISOString(),
      actorId: input.actorId || null,
      actorUsername: input.actorUsername || null,
      action: input.action,
      resourceType: input.resourceType || null,
      resourceId: input.resourceId || null,
      ip: input.ip || null,
      success: input.success ? 1 : 0,
      detail: input.detail ? JSON.stringify(redact(input.detail)) : null,
    } as typeof auditLogs.$inferInsert)
    .run();
}

export function auditFromReq(
  req: Request,
  input: {
    action: string;
    resourceType?: string | null;
    resourceId?: string | null;
    success: boolean;
    detail?: Record<string, unknown> | null;
  },
) {
  writeAudit({
    actorId: req.user?.id || null,
    actorUsername: req.user?.username || null,
    ip: clientIp(req),
    ...input,
  });
}

function redact(detail: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...detail };
  for (const key of Object.keys(out)) {
    if (/password/i.test(key)) out[key] = '***';
  }
  return out;
}
