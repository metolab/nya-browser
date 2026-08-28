import { Router } from 'express';
import {
  AUDIT_ACTIONS,
  createSessionSchema,
  createWindowSchema,
  putNotepadSchema,
  putTargetGrantsSchema,
  startSessionSchema,
  updateSessionSchema,
} from '@nya/shared';
import { asyncHandler, requireAdmin } from '../../http/util.js';
import { HttpError, assertNotepadAccess, assertSessionAccess, handleHttpError } from '../../http/access.js';
import { auditFromReq } from '../audit/service.js';
import {
  createSession,
  deleteSession,
  getSession,
  listSessionGrants,
  regenerateSessionFingerprint,
  setSessionGrants,
  updateSession,
} from '../../store.js';
import {
  applyProxy,
  canAccessWindow,
  claimMainWindow,
  createSub,
  getRuntimePublic,
  getWindow,
  maybeStopIdle,
  ownedWindows,
  releaseMainWindow,
  restartBrowser,
  startSession,
  stopSession,
  stopSub,
  syncIdleWatch,
  takeoverOwnedWindow,
} from '../../runtime/sessionManager.js';
import { sessionIoRouter } from './io.js';
import { filesRouter } from '../files/routes.js';
import { presentSession, presentSessions, visibleWindows } from './present.js';

export const sessionsRouter = Router();

sessionsRouter.get(
  '/',
  asyncHandler((req, res) => {
    res.json({ sessions: presentSessions(req) });
  }),
);

sessionsRouter.post(
  '/',
  requireAdmin,
  asyncHandler((req, res) => {
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid' });
    let session;
    try {
      session = createSession({
        name: parsed.data.name,
        description: parsed.data.description,
        notepad: parsed.data.notepad,
        groupId: parsed.data.groupId ?? null,
        proxyId: parsed.data.proxyId ?? null,
        timezone: parsed.data.timezone,
        chromeLanguage: parsed.data.chromeLanguage,
        homeUrl: parsed.data.homeUrl,
        idleTimeoutMinutes: parsed.data.idleTimeoutMinutes,
      });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
    auditFromReq(req, {
      action: AUDIT_ACTIONS.sessionCreate,
      resourceType: 'session',
      resourceId: session.id,
      success: true,
      detail: { name: session.name },
    });
    res.status(201).json({ session: presentSession(session, req.user) });
  }),
);

sessionsRouter.patch(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = updateSessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid' });
    const before = getSession(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    let session;
    try {
      session = updateSession(req.params.id, parsed.data);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
    if (!session) return res.status(404).json({ error: 'Not found' });
    if (parsed.data.proxyId !== undefined && parsed.data.proxyId !== before.proxyId) {
      await applyProxy(session.id, session.proxy);
    } else if (
      getRuntimePublic(session.id) &&
      ((parsed.data.timezone && parsed.data.timezone !== before.timezone) ||
        (parsed.data.chromeLanguage && parsed.data.chromeLanguage !== before.chromeLanguage))
    ) {
      await restartBrowser(session.id);
    }
    if (parsed.data.idleTimeoutMinutes !== undefined) {
      syncIdleWatch(session.id);
    }
    auditFromReq(req, {
      action: AUDIT_ACTIONS.sessionUpdate,
      resourceType: 'session',
      resourceId: session.id,
      success: true,
    });
    res.json({ session: presentSession(session, req.user) });
  }),
);

sessionsRouter.delete(
  '/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await stopSession(req.params.id);
    const ok = deleteSession(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    auditFromReq(req, {
      action: AUDIT_ACTIONS.sessionDelete,
      resourceType: 'session',
      resourceId: req.params.id,
      success: true,
    });
    res.json({ ok: true });
  }),
);

sessionsRouter.get(
  '/:id/grants',
  requireAdmin,
  asyncHandler((req, res) => {
    if (!getSession(req.params.id)) return res.status(404).json({ error: 'Not found' });
    res.json({ grants: listSessionGrants(req.params.id) });
  }),
);

sessionsRouter.put(
  '/:id/grants',
  requireAdmin,
  asyncHandler((req, res) => {
    if (!getSession(req.params.id)) return res.status(404).json({ error: 'Not found' });
    const parsed = putTargetGrantsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid' });
    let grants;
    try {
      grants = setSessionGrants(req.params.id, parsed.data.userIds, parsed.data.notepadUserIds);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
    auditFromReq(req, {
      action: AUDIT_ACTIONS.assignmentSet,
      resourceType: 'session',
      resourceId: req.params.id,
      success: true,
      detail: { userIds: parsed.data.userIds, notepadUserIds: parsed.data.notepadUserIds },
    });
    res.json({ grants });
  }),
);

sessionsRouter.get(
  '/:id/notepad',
  asyncHandler((req, res) => {
    try {
      const { session } = assertNotepadAccess(req, req.params.id);
      res.json({ notepad: session.notepad || '' });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

sessionsRouter.put(
  '/:id/notepad',
  asyncHandler((req, res) => {
    try {
      assertNotepadAccess(req, req.params.id);
      const parsed = putNotepadSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid' });
      }
      const session = updateSession(req.params.id, { notepad: parsed.data.notepad });
      if (!session) return res.status(404).json({ error: 'Not found' });
      auditFromReq(req, {
        action: AUDIT_ACTIONS.sessionNotepad,
        resourceType: 'session',
        resourceId: session.id,
        success: true,
      });
      res.json({ notepad: session.notepad || '' });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

sessionsRouter.post(
  '/:id/start',
  asyncHandler(async (req, res) => {
    try {
      const { session, admin } = assertSessionAccess(req, req.params.id);
      const parsed = startSessionSchema.safeParse(req.body || {});
      const url = parsed.success ? parsed.data.url : undefined;
      const running = getRuntimePublic(session.id);
      const runtime = await startSession(session.id, {
        url,
        ownerUserId: admin ? undefined : req.user!.id,
      });
      if (!admin && !running) {
        claimMainWindow(session.id, req.user!.id);
      }
      auditFromReq(req, {
        action: AUDIT_ACTIONS.sessionStart,
        resourceType: 'session',
        resourceId: session.id,
        success: true,
      });
      res.json({ runtime, session: presentSession(getSession(session.id)!, req.user) });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

sessionsRouter.post(
  '/:id/stop',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await stopSession(req.params.id);
    auditFromReq(req, {
      action: AUDIT_ACTIONS.sessionStop,
      resourceType: 'session',
      resourceId: req.params.id,
      success: true,
    });
    res.json({ ok: true });
  }),
);

sessionsRouter.post(
  '/:id/restart',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = startSessionSchema.safeParse(req.body || {});
    const runtime = await restartBrowser(req.params.id, {
      url: parsed.success ? parsed.data.url : undefined,
    });
    auditFromReq(req, {
      action: AUDIT_ACTIONS.sessionRestart,
      resourceType: 'session',
      resourceId: req.params.id,
      success: true,
    });
    res.json({ runtime });
  }),
);

sessionsRouter.post(
  '/:id/fingerprint/regenerate',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const session = regenerateSessionFingerprint(req.params.id);
    if (!session) return res.status(404).json({ error: 'Not found' });
    let runtime = getRuntimePublic(session.id);
    if (runtime) runtime = await restartBrowser(session.id);
    auditFromReq(req, {
      action: AUDIT_ACTIONS.sessionFingerprint,
      resourceType: 'session',
      resourceId: session.id,
      success: true,
    });
    res.json({ session: presentSession(session, req.user) });
  }),
);

sessionsRouter.put(
  '/:id/proxy',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const proxyId = req.body?.proxyId === undefined ? null : req.body.proxyId;
    const session = updateSession(req.params.id, { proxyId });
    if (!session) return res.status(404).json({ error: 'Not found' });
    await applyProxy(session.id, session.proxy);
    auditFromReq(req, {
      action: AUDIT_ACTIONS.sessionUpdate,
      resourceType: 'session',
      resourceId: session.id,
      success: true,
      detail: { proxyId },
    });
    res.json({ session: presentSession(session, req.user) });
  }),
);

sessionsRouter.get(
  '/:id/windows',
  asyncHandler((req, res) => {
    try {
      assertSessionAccess(req, req.params.id);
      res.json({ windows: visibleWindows(req.params.id, req.user!) });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

sessionsRouter.post(
  '/:id/windows',
  asyncHandler(async (req, res) => {
    try {
      const { session, admin } = assertSessionAccess(req, req.params.id);
      const parsed = createWindowSchema.safeParse(req.body || {});
      const url = parsed.success ? parsed.data.url : undefined;
      const takeover = Boolean(parsed.success && parsed.data.takeover);
      const userId = req.user!.id;

      const owned = ownedWindows(session.id, userId);
      if (owned.length) {
        const live = owned.some((w) => (w.vncConnections || 0) > 0);
        if (live && !takeover) {
          throw new HttpError(409, '该会话已在其他页面打开', { code: 'WINDOW_OWNED' });
        }
        const win = await takeoverOwnedWindow(session.id, userId);
        auditFromReq(req, {
          action: AUDIT_ACTIONS.windowCreate,
          resourceType: 'window',
          resourceId: `${session.id}:${win?.id || 'main'}`,
          success: true,
          detail: { takeover: live },
        });
        return res.status(201).json({ window: win, takenOver: live, runtime: getRuntimePublic(session.id) });
      }

      let runtime = getRuntimePublic(session.id);
      if (!runtime) {
        await startSession(session.id, { url, ownerUserId: userId });
        const win = claimMainWindow(session.id, userId);
        auditFromReq(req, {
          action: AUDIT_ACTIONS.windowCreate,
          resourceType: 'window',
          resourceId: `${session.id}:${win?.id || 'main'}`,
          success: true,
        });
        return res.status(201).json({ window: win, runtime: getRuntimePublic(session.id) });
      }

      const existing = getWindow(session.id, 'main');
      if (existing && !existing.ownerUserId) {
        const win = claimMainWindow(session.id, userId);
        auditFromReq(req, {
          action: AUDIT_ACTIONS.windowCreate,
          resourceType: 'window',
          resourceId: `${session.id}:main`,
          success: true,
        });
        return res.status(201).json({ window: win, runtime: getRuntimePublic(session.id) });
      }

      const sub = await createSub(session.id, url, { ownerUserId: userId });
      auditFromReq(req, {
        action: AUDIT_ACTIONS.windowCreate,
        resourceType: 'window',
        resourceId: `${session.id}:${sub.id}`,
        success: true,
      });
      res.status(201).json({ window: { ...sub, vncConnections: 0 }, runtime: getRuntimePublic(session.id) });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

sessionsRouter.delete(
  '/:id/windows/:windowId',
  asyncHandler(async (req, res) => {
    try {
      const { admin } = assertSessionAccess(req, req.params.id);
      const windowId = req.params.windowId;
      if (!canAccessWindow(req.params.id, windowId, req.user) && !admin) {
        throw new HttpError(403, 'Forbidden');
      }
      if (windowId === 'main') {
        releaseMainWindow(req.params.id, req.user!.id, admin);
      } else {
        await stopSub(req.params.id, windowId);
      }
      await maybeStopIdle(req.params.id);
      auditFromReq(req, {
        action: AUDIT_ACTIONS.windowClose,
        resourceType: 'window',
        resourceId: `${req.params.id}:${windowId}`,
        success: true,
      });
      res.json({ ok: true });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

// Compatibility aliases used by the existing desk UI.
sessionsRouter.post(
  '/:id/subs',
  asyncHandler(async (req, res) => {
    try {
      const { session } = assertSessionAccess(req, req.params.id);
      const userId = req.user!.id;
      if (!getRuntimePublic(session.id)) {
        await startSession(session.id, { url: req.body?.url, ownerUserId: userId });
      }
      const sub = await createSub(session.id, req.body?.url, { ownerUserId: userId });
      auditFromReq(req, {
        action: AUDIT_ACTIONS.windowCreate,
        resourceType: 'window',
        resourceId: `${session.id}:${sub.id}`,
        success: true,
      });
      res.json({ sub });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

sessionsRouter.get(
  '/:id/subs',
  asyncHandler((req, res) => {
    try {
      assertSessionAccess(req, req.params.id);
      const windows = visibleWindows(req.params.id, req.user!).filter((w) => w.kind === 'sub');
      res.json({ subs: windows });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

sessionsRouter.delete(
  '/:id/subs/:subId',
  asyncHandler(async (req, res) => {
    try {
      const { admin } = assertSessionAccess(req, req.params.id);
      if (!canAccessWindow(req.params.id, req.params.subId, req.user) && !admin) {
        throw new HttpError(403, 'Forbidden');
      }
      await stopSub(req.params.id, req.params.subId);
      auditFromReq(req, {
        action: AUDIT_ACTIONS.windowClose,
        resourceType: 'window',
        resourceId: `${req.params.id}:${req.params.subId}`,
        success: true,
      });
      res.json({ ok: true });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

sessionsRouter.use('/:id/files', filesRouter);
sessionsRouter.use('/:id', sessionIoRouter);

