import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../http/util.js';
import { assertSessionAccess, handleHttpError } from '../../http/access.js';
import { chownSessionFiles } from '../../runtime/sessionManager.js';
import { finishLocalJob, startLocalJob } from './jobs.js';
import { FILE_UPLOAD_MAX_BYTES } from '@nya/shared';
import { uniqueName } from './names.js';
import {
  applyUploadMtime,
  getTransfer,
  listDownloads,
  listFiles,
  listUploads,
  mkdir,
  recordUpload,
  removeEntry,
  resolveSessionPath,
} from './service.js';

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

filesRouter.get(
  '/uploads',
  asyncHandler((req, res) => {
    res.json({ uploads: listUploads(req.params.id) });
  }),
);

filesRouter.get(
  '/downloads',
  asyncHandler((req, res) => {
    res.json({ downloads: listDownloads(req.params.id) });
  }),
);

filesRouter.get(
  '/transfer',
  asyncHandler(async (req, res) => {
    const sub = req.query.sub ? String(req.query.sub) : null;
    res.json(await getTransfer(req.params.id, sub));
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
    filename: (req, file, cb) => {
      try {
        const dirRel = String(req.query.dir || req.body?.dir || '.');
        const { full } = resolveSessionPath(req.params.id, dirRel);
        cb(null, uniqueName(full, file.originalname));
      } catch (err) {
        cb(err as Error, undefined);
      }
    },
  }),
  limits: { fileSize: FILE_UPLOAD_MAX_BYTES },
});

filesRouter.post(
  '/upload',
  upload.array('files', 50),
  asyncHandler((req, res) => {
    const files = ((req.files as Express.Multer.File[]) || []).map((f, index) => {
      const mtimes = req.body?.lastModified;
      const stamp = Array.isArray(mtimes) ? mtimes[index] : mtimes;
      applyUploadMtime(f.path, stamp);
      const dirRel = String(req.query.dir || req.body?.dir || '.');
      const rel = dirRel && dirRel !== '.' ? `${String(dirRel).replace(/\/$/, '')}/${f.filename}` : f.filename;
      recordUpload(req.params.id, {
        name: f.filename,
        path: rel,
        size: f.size,
        mtime: new Date().toISOString(),
      });
      return { name: f.filename, path: rel, size: f.size };
    });
    chownSessionFiles(req.params.id);
    res.json({ ok: true, files });
  }),
);

filesRouter.get(
  '/download',
  asyncHandler((req, res) => {
    const rel = String(req.query.path || '');
    const { full } = resolveSessionPath(req.params.id, rel);
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      return res.status(404).json({ error: 'File not found' });
    }
    const name = path.basename(full);
    const jobId = String(req.query.job || '').trim();
    if (jobId) {
      const st = fs.statSync(full);
      startLocalJob(req.params.id, jobId, rel, name, st.size);
      const done = () => finishLocalJob(req.params.id, jobId, res.writableEnded ? 'completed' : 'cancelled');
      res.once('finish', done);
      res.once('close', done);
    }
    res.download(full, name);
  }),
);
