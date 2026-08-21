import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { Router } from 'express';
import {
  AUDIT_ACTIONS,
  createUserSchema,
  updateUserSchema,
  putUserGrantsSchema,
} from '@nya/shared';
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { asyncHandler, requireAdmin } from '../../http/util.js';
import { auditFromReq } from '../audit/service.js';
import { revokeUserTokens, toPublicUser } from '../auth/service.js';
import { deleteGrantsForUser, listAllGrants, setUserGrants } from '../../store.js';

export const usersRouter = Router();
usersRouter.use(requireAdmin);

usersRouter.get(
  '/',
  asyncHandler((_req, res) => {
    const rows = db.select().from(users).all().map(toPublicUser);
    const grants = listAllGrants();
    res.json({
      users: rows.map((u) => ({
        ...u,
        grants: grants.filter((g) => g.userId === u.id),
      })),
    });
  }),
);

usersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid' });
    const exists = db.select().from(users).where(eq(users.username, parsed.data.username)).get();
    if (exists) return res.status(409).json({ error: 'Username exists' });
    const now = new Date().toISOString();
    const row = {
      id: nanoid(12),
      username: parsed.data.username,
      passwordHash: await argon2.hash(parsed.data.password),
      role: parsed.data.role,
      disabled: 0,
      createdAt: now,
    };
    db.insert(users).values(row).run();
    auditFromReq(req, {
      action: AUDIT_ACTIONS.userCreate,
      resourceType: 'user',
      resourceId: row.id,
      success: true,
      detail: { username: row.username, role: row.role },
    });
    res.status(201).json({ user: toPublicUser(row) });
  }),
);

usersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid' });
    const row = db.select().from(users).where(eq(users.id, req.params.id)).get();
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.role === 'admin' && parsed.data.disabled) {
      const admins = db.select().from(users).all().filter((u) => u.role === 'admin' && !u.disabled);
      if (admins.length <= 1) return res.status(400).json({ error: 'Cannot disable the last admin' });
    }
    const patch: Partial<typeof row> = {};
    if (parsed.data.password) patch.passwordHash = await argon2.hash(parsed.data.password);
    if (parsed.data.role) patch.role = parsed.data.role;
    if (parsed.data.disabled !== undefined) patch.disabled = parsed.data.disabled ? 1 : 0;
    db.update(users).set(patch).where(eq(users.id, row.id)).run();
    if (parsed.data.password || parsed.data.disabled) revokeUserTokens(row.id);
    auditFromReq(req, {
      action: AUDIT_ACTIONS.userUpdate,
      resourceType: 'user',
      resourceId: row.id,
      success: true,
      detail: { ...parsed.data, password: parsed.data.password ? '***' : undefined },
    });
    res.json({ user: toPublicUser(db.select().from(users).where(eq(users.id, row.id)).get()!) });
  }),
);

usersRouter.delete(
  '/:id',
  asyncHandler((req, res) => {
    const row = db.select().from(users).where(eq(users.id, req.params.id)).get();
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (row.id === req.user?.id) return res.status(400).json({ error: 'Cannot delete yourself' });
    if (row.role === 'admin') {
      const admins = db.select().from(users).all().filter((u) => u.role === 'admin' && !u.disabled);
      if (admins.length <= 1) return res.status(400).json({ error: 'Cannot delete the last admin' });
    }
    revokeUserTokens(row.id);
    deleteGrantsForUser(row.id);
    db.delete(users).where(eq(users.id, row.id)).run();
    auditFromReq(req, {
      action: AUDIT_ACTIONS.userDelete,
      resourceType: 'user',
      resourceId: row.id,
      success: true,
      detail: { username: row.username },
    });
    res.json({ ok: true });
  }),
);

usersRouter.put(
  '/:id/grants',
  asyncHandler((req, res) => {
    const parsed = putUserGrantsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid' });
    const row = db.select().from(users).where(eq(users.id, req.params.id)).get();
    if (!row) return res.status(404).json({ error: 'Not found' });
    let grants;
    try {
      grants = setUserGrants(row.id, parsed.data.grants);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
    auditFromReq(req, {
      action: AUDIT_ACTIONS.assignmentSet,
      resourceType: 'user',
      resourceId: row.id,
      success: true,
      detail: { grants: parsed.data.grants },
    });
    res.json({ grants });
  }),
);
