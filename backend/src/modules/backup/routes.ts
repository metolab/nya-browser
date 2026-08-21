import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Router } from 'express';
import multer from 'multer';
import { AUDIT_ACTIONS, type BackupManifest } from '@nya/shared';
import { asyncHandler, requireAdmin } from '../../http/util.js';
import { auditFromReq } from '../audit/service.js';
import {
  chromeProfileDir,
  createSession,
  getProxy,
  getSession,
  listProxies,
  sessionDir,
} from '../../store.js';
import { getRuntimePublic, stopSession } from '../../runtime/sessionManager.js';
import { presentSession } from '../sessions/present.js';

fs.mkdirSync(path.join(os.tmpdir(), 'nya-import'), { recursive: true });

const upload = multer({
  dest: path.join(os.tmpdir(), 'nya-import'),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },
});

function extractArgs(archive: string, dest: string) {
  const fd = fs.openSync(archive, 'r');
  const buf = Buffer.alloc(4);
  fs.readSync(fd, buf, 0, 4, 0);
  fs.closeSync(fd);
  if (buf[0] === 0x28 && buf[1] === 0xb5 && buf[2] === 0x2f && buf[3] === 0xfd) {
    return ['-I', 'zstd', '-xf', archive, '-C', dest];
  }
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    return ['-z', '-xf', archive, '-C', dest];
  }
  return ['-xf', archive, '-C', dest];
}

function compressor() {
  try {
    fs.accessSync('/usr/bin/zstd');
    return { ext: 'tar.zst', extra: ['-I', 'zstd -T0'] };
  } catch {
    return { ext: 'tar.gz', extra: ['-z'] };
  }
}

const EXCLUDES = [
  '--exclude=chrome/Default/Cache',
  '--exclude=chrome/Default/Code Cache',
  '--exclude=chrome/Default/GPUCache',
  '--exclude=chrome/GrShaderCache',
  '--exclude=chrome/ShaderCache',
  '--exclude=chrome/Default/Service Worker/CacheStorage',
  '--exclude=chrome/Crash Reports',
  '--exclude=chrome/BrowserMetrics',
  '--exclude=chrome/optimization_guide_hint_cache_store',
  '--exclude=chrome/DawnGraphiteCache',
  '--exclude=chrome/DawnWebGPUCache',
  '--exclude=chrome/component_crx_cache',
  '--exclude=chrome/extensions_crx_cache',
];

export const backupRouter = Router();

backupRouter.get(
  '/sessions/:id/export',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Not found' });
    if (getRuntimePublic(session.id)) {
      await stopSession(session.id);
    }
    const proxy = getProxy(session.proxyId);
    const manifest: BackupManifest = {
      version: 1,
      exportedAt: new Date().toISOString(),
      name: session.name,
      description: session.description,
      timezone: session.timezone,
      homeUrl: session.homeUrl,
      idleTimeoutMinutes: session.idleTimeoutMinutes,
      fingerprint: session.fingerprint,
      proxy: {
        id: session.proxyId,
        name: proxy?.name || null,
        type: session.proxy.type,
        host: session.proxy.host,
        port: session.proxy.port,
        username: session.proxy.username,
      },
    };
    const home = sessionDir(session.id);
    const manifestPath = path.join(home, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const { ext, extra } = compressor();
    const filename = `${session.name.replace(/[^\w.-]+/g, '_') || 'session'}.nya-session.${ext}`;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const child = spawn(
      'tar',
      [...extra, '-C', home, '-cf', '-', ...EXCLUDES, 'manifest.json', 'chrome'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child.stdout.pipe(res);
    child.stderr.on('data', () => undefined);
    const cleanup = () => {
      try {
        fs.unlinkSync(manifestPath);
      } catch {
        /* ignore */
      }
    };
    child.on('close', cleanup);
    req.on('close', () => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    });
    auditFromReq(req, {
      action: AUDIT_ACTIONS.backupExport,
      resourceType: 'session',
      resourceId: session.id,
      success: true,
    });
  }),
);

backupRouter.post(
  '/sessions/import',
  requireAdmin,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'file required' });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nya-restore-'));
    await new Promise<void>((resolve, reject) => {
      const child = spawn('tar', extractArgs(file.path, tmp), {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error('Failed to extract archive'));
      });
    });
    const manifestPath = path.join(tmp, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return res.status(400).json({ error: 'Invalid archive: missing manifest' });
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as BackupManifest;
    let proxyId: string | null = null;
    let proxyMatched = false;
    if (manifest.proxy?.type && manifest.proxy.type !== 'none') {
      const found = listProxies().find(
        (p) =>
          p.type === manifest.proxy.type &&
          p.host === manifest.proxy.host &&
          p.port === manifest.proxy.port,
      );
      if (found) {
        proxyId = found.id;
        proxyMatched = true;
      }
    }
    const session = createSession({
      name: manifest.name,
      description: manifest.description,
      timezone: manifest.timezone,
      homeUrl: manifest.homeUrl,
      idleTimeoutMinutes: manifest.idleTimeoutMinutes,
      fingerprint: manifest.fingerprint,
      proxyId,
    });
    const dest = chromeProfileDir(session.id);
    fs.rmSync(dest, { recursive: true, force: true });
    const srcChrome = path.join(tmp, 'chrome');
    if (fs.existsSync(srcChrome)) {
      fs.cpSync(srcChrome, dest, { recursive: true });
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    try {
      fs.unlinkSync(file.path);
    } catch {
      /* ignore */
    }
    auditFromReq(req, {
      action: AUDIT_ACTIONS.backupImport,
      resourceType: 'session',
      resourceId: session.id,
      success: true,
      detail: { name: session.name, proxyMatched },
    });
    res.status(201).json({
      session: presentSession(session, req.user),
      proxyMatched,
    });
  }),
);
