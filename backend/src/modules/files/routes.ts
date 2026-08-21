import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../http/util.js';
import { assertSessionAccess, handleHttpError } from '../../http/access.js';
import { chownSessionFiles } from '../../runtime/sessionManager.js';
import { listFiles, mkdir, removeEntry, resolveSessionPath } from './service.js';

export const filesRouter = Router({ mergeParams: true });

filesRouter.use((req, res, next) => {
  try {
    assertSessionAccess(req, req.params.id);
    next();
  } catch (err) {
    handleHttpError(err, res);
  }
});

filesRouter.get(
  '/',
  asyncHandler((req, res) => {
    const result = listFiles(req.params.id, String(req.query.path || '.'));
    res.json(result);
  }),
);

filesRouter.post(
  '/mkdir',
  asyncHandler((req, res) => {
    mkdir(req.params.id, req.body?.path);
    chownSessionFiles(req.params.id);
    res.json({ ok: true });
  }),
);

filesRouter.delete(
  '/',
  asyncHandler((req, res) => {
    removeEntry(req.params.id, String(req.query.path || req.body?.path || ''));
    res.json({ ok: true });
  }),
);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      try {
        const dirRel = String(req.query.dir || req.body?.dir || '.');
        const { full } = resolveSessionPath(req.params.id, dirRel);
        fs.mkdirSync(full, { recursive: true });
        cb(null, full);
      } catch (err) {
        cb(err as Error, undefined);
      }
    },
    filename: (_req, file, cb) => {
      cb(null, path.basename(file.originalname));
    },
  }),
  limits: { fileSize: 512 * 1024 * 1024 },
});

filesRouter.post(
  '/upload',
  upload.array('files', 50),
  asyncHandler((req, res) => {
    chownSessionFiles(req.params.id);
    res.json({
      ok: true,
      files: ((req.files as Express.Multer.File[]) || []).map((f) => ({
        name: f.filename,
        size: f.size,
      })),
    });
  }),
);

filesRouter.get(
  '/download',
  asyncHandler((req, res) => {
    const { full } = resolveSessionPath(req.params.id, String(req.query.path || ''));
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.download(full, path.basename(full));
  }),
);
