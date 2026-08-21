import { Router } from 'express';
import { displaySchema, clipboardSchema } from '@nya/shared';
import { asyncHandler } from '../../http/util.js';
import { assertSessionAccess, handleHttpError, HttpError } from '../../http/access.js';
import {
  canAccessWindow,
  getChromeTitle,
  getClipboard,
  resizeDisplay,
  setClipboard,
} from '../../runtime/sessionManager.js';

export const sessionIoRouter = Router({ mergeParams: true });

function gateWindow(req: import('express').Request, windowId: string | null) {
  assertSessionAccess(req, req.params.id);
  if (req.user?.role === 'admin') return;
  const id = windowId || 'main';
  if (!canAccessWindow(req.params.id, id, req.user)) {
    throw new HttpError(403, 'Forbidden');
  }
}

sessionIoRouter.post(
  '/display',
  asyncHandler(async (req, res) => {
    try {
      gateWindow(req, 'main');
      const parsed = displaySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid size' });
      const geom = await resizeDisplay(req.params.id, parsed.data.width, parsed.data.height);
      res.json({ ok: true, geometry: geom });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

sessionIoRouter.post(
  '/subs/:subId/display',
  asyncHandler(async (req, res) => {
    try {
      gateWindow(req, req.params.subId);
      const parsed = displaySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid size' });
      const geom = await resizeDisplay(
        req.params.id,
        parsed.data.width,
        parsed.data.height,
        null,
        req.params.subId,
      );
      res.json({ ok: true, geometry: geom });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

sessionIoRouter.get(
  '/title',
  asyncHandler(async (req, res) => {
    try {
      gateWindow(req, 'main');
      const title = await getChromeTitle(req.params.id);
      res.json({ title });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

sessionIoRouter.get(
  '/subs/:subId/title',
  asyncHandler(async (req, res) => {
    try {
      gateWindow(req, req.params.subId);
      const title = await getChromeTitle(req.params.id, req.params.subId);
      res.json({ title });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

sessionIoRouter.get(
  '/clipboard',
  asyncHandler(async (req, res) => {
    try {
      gateWindow(req, 'main');
      const text = await getClipboard(req.params.id);
      res.json({ text });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

sessionIoRouter.put(
  '/clipboard',
  asyncHandler(async (req, res) => {
    try {
      gateWindow(req, 'main');
      const parsed = clipboardSchema.safeParse(req.body || {});
      await setClipboard(req.params.id, parsed.success ? parsed.data.text : '');
      res.json({ ok: true });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

sessionIoRouter.get(
  '/subs/:subId/clipboard',
  asyncHandler(async (req, res) => {
    try {
      gateWindow(req, req.params.subId);
      const text = await getClipboard(req.params.id, req.params.subId);
      res.json({ text });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

sessionIoRouter.put(
  '/subs/:subId/clipboard',
  asyncHandler(async (req, res) => {
    try {
      gateWindow(req, req.params.subId);
      const parsed = clipboardSchema.safeParse(req.body || {});
      await setClipboard(req.params.id, parsed.success ? parsed.data.text : '', req.params.subId);
      res.json({ ok: true });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);
