import { Router } from 'express';
import { AUDIT_ACTIONS, createGroupSchema, updateGroupSchema, putTargetGrantsSchema } from '@nya/shared';
import { asyncHandler, requireAdmin } from '../../http/util.js';
import { auditFromReq } from '../audit/service.js';
import {
  createGroup,
  deleteGroup,
  getGroup,
  listFolderGrants,
  listVisibleGroups,
  setFolderGrants,
  updateGroup,
} from '../../store.js';

export const groupsRouter = Router();

groupsRouter.get(
  '/',
  asyncHandler((req, res) => {
    res.json({ groups: listVisibleGroups(req.user!) });
  }),
);

groupsRouter.post(
  '/',
  requireAdmin,
  asyncHandler((req, res) => {
    const parsed = createGroupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid' });
    try {
      const group = createGroup({
        name: parsed.data.name,
        parentId: parsed.data.parentId ?? null,
      });
      auditFromReq(req, {
        action: AUDIT_ACTIONS.groupCreate,
        resourceType: 'group',
        resourceId: group.id,
        success: true,
        detail: { name: group.name, parentId: group.parentId },
      });
      res.status(201).json({ group });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }),
);

groupsRouter.patch(
  '/:id',
  requireAdmin,
  asyncHandler((req, res) => {
    const parsed = updateGroupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid' });
    if (!getGroup(req.params.id)) return res.status(404).json({ error: 'Not found' });
    try {
      const group = updateGroup(req.params.id, parsed.data);
      auditFromReq(req, {
        action: AUDIT_ACTIONS.groupUpdate,
        resourceType: 'group',
        resourceId: req.params.id,
        success: true,
      });
      res.json({ group });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }),
);

groupsRouter.delete(
  '/:id',
  requireAdmin,
  asyncHandler((req, res) => {
    const ok = deleteGroup(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    auditFromReq(req, {
      action: AUDIT_ACTIONS.groupDelete,
      resourceType: 'group',
      resourceId: req.params.id,
      success: true,
    });
    res.json({ ok: true });
  }),
);

groupsRouter.get(
  '/:id/grants',
  requireAdmin,
  asyncHandler((req, res) => {
    if (!getGroup(req.params.id)) return res.status(404).json({ error: 'Not found' });
    res.json({ grants: listFolderGrants(req.params.id) });
  }),
);

groupsRouter.put(
  '/:id/grants',
  requireAdmin,
  asyncHandler((req, res) => {
    if (!getGroup(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const parsed = putTargetGrantsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid' });
    try {
      const grants = setFolderGrants(req.params.id, parsed.data.userIds, parsed.data.notepadUserIds);
      auditFromReq(req, {
        action: AUDIT_ACTIONS.assignmentSet,
        resourceType: 'group',
        resourceId: req.params.id,
        success: true,
        detail: { userIds: parsed.data.userIds, notepadUserIds: parsed.data.notepadUserIds },
      });
      res.json({ grants });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }),
);
