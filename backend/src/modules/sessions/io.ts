import fs from 'fs';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { clipboardFilesSchema, clipboardSchema, displaySchema, typeTextSchema } from '@nya/shared';
import { asyncHandler } from '../../http/util.js';
import { assertSessionAccess, handleHttpError, HttpError } from '../../http/access.js';
import {
  assertSessionRuntime,
  canAccessWindow,
  chownSessionFiles,
  getChromeTitle,
  resizeDisplay,
  typeText,
} from '../../runtime/sessionManager.js';
import {
  getClipboard,
  setClipboard,
  setClipboardFiles,
  setClipboardImage,
} from '../../runtime/clipboard.js';
import { toClipboardPng } from '../files/image.js';
import { resolveClipboardFiles, savePastedImage } from '../files/service.js';

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});

export const sessionIoRouter = Router({ mergeParams: true });

function gateWindow(req: Request, windowId: string | null) {
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

async function putClipboardImage(req: Request, res: Response, subId: string | null) {
  gateWindow(req, subId || 'main');
  assertSessionRuntime(req.params.id, subId);
  const file = req.file;
  if (!file?.buffer?.length) {
    res.status(400).json({ error: 'Image required' });
    return;
  }
  let png: Buffer;
  try {
    png = await toClipboardPng(file.buffer);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid image' });
    return;
  }
  const saved = savePastedImage(req.params.id, png);
  chownSessionFiles(req.params.id);
  await setClipboardImage(req.params.id, png, subId);
  res.json({ ok: true, kind: 'image', file: { name: saved.name, path: saved.path, size: saved.size } });
}

async function putClipboardFiles(req: Request, res: Response, subId: string | null) {
  gateWindow(req, subId || 'main');
  assertSessionRuntime(req.params.id, subId);
  const parsed = clipboardFilesSchema.safeParse(req.body || {});
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid paths' });
    return;
  }
  const abs = resolveClipboardFiles(req.params.id, parsed.data.paths);
  await setClipboardFiles(req.params.id, abs, subId);
  res.json({ ok: true, kind: 'files', files: parsed.data.paths });
}

async function putClipboardImagePath(req: Request, res: Response, subId: string | null) {
  gateWindow(req, subId || 'main');
  assertSessionRuntime(req.params.id, subId);
  const rel = String(req.body?.path || '').trim();
  if (!rel) {
    res.status(400).json({ error: 'Path required' });
    return;
  }
  const [abs] = resolveClipboardFiles(req.params.id, [rel]);
  const png = await toClipboardPng(fs.readFileSync(abs));
  await setClipboardImage(req.params.id, png, subId);
  res.json({ ok: true, kind: 'image', file: { path: rel } });
}

function addClipboardAndType(prefix: string, subOf: (req: Request) => string | null) {
  sessionIoRouter.get(
    `${prefix}/clipboard`,
    asyncHandler(async (req, res) => {
      try {
        gateWindow(req, subOf(req) || 'main');
        res.json(await getClipboard(req.params.id, subOf(req)));
      } catch (err) {
        handleHttpError(err, res);
      }
    }),
  );

  sessionIoRouter.put(
    `${prefix}/clipboard`,
    asyncHandler(async (req, res) => {
      try {
        gateWindow(req, subOf(req) || 'main');
        const parsed = clipboardSchema.safeParse(req.body || {});
        const state = await setClipboard(req.params.id, parsed.success ? parsed.data.text : '', subOf(req));
        res.json({ ok: true, ...state });
      } catch (err) {
        handleHttpError(err, res);
      }
    }),
  );

  sessionIoRouter.post(
    `${prefix}/clipboard/image`,
    imageUpload.single('image'),
    asyncHandler(async (req, res) => {
      try {
        await putClipboardImage(req, res, subOf(req));
      } catch (err) {
        handleHttpError(err, res);
      }
    }),
  );

  sessionIoRouter.post(
    `${prefix}/clipboard/files`,
    asyncHandler(async (req, res) => {
      try {
        await putClipboardFiles(req, res, subOf(req));
      } catch (err) {
        handleHttpError(err, res);
      }
    }),
  );

  sessionIoRouter.post(
    `${prefix}/clipboard/image-path`,
    asyncHandler(async (req, res) => {
      try {
        await putClipboardImagePath(req, res, subOf(req));
      } catch (err) {
        handleHttpError(err, res);
      }
    }),
  );

  sessionIoRouter.post(
    `${prefix}/type`,
    asyncHandler(async (req, res) => {
      try {
        gateWindow(req, subOf(req) || 'main');
        const parsed = typeTextSchema.safeParse(req.body || {});
        if (!parsed.success) return res.status(400).json({ ok: false, error: 'Invalid text' });
        await typeText(req.params.id, parsed.data.text, subOf(req));
        res.json({ ok: true });
      } catch (err) {
        handleHttpError(err, res);
      }
    }),
  );
}

addClipboardAndType('', () => null);
addClipboardAndType('/subs/:subId', (req) => req.params.subId);
