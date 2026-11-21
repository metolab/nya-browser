import { Router } from 'express';
import {
  AUDIT_ACTIONS,
  assetCacheTargetSchema,
  updateAssetCacheConfigSchema,
} from '@nya/shared';
import { asyncHandler, requireAdmin } from '../../http/util.js';
import { auditFromReq } from '../audit/service.js';
import { BUILTIN_BLACKLIST } from '../../runtime/assetCache/policy.js';
import { assetCacheStore } from '../../runtime/assetCache/store.js';
import { getAssetCacheRuntimeCounts } from '../../runtime/assetCache/cdpHook.js';

export const cacheRouter = Router();
cacheRouter.use(requireAdmin);

function snapshot() {
  const { activeSessions, inflightReads } = getAssetCacheRuntimeCounts();
  return {
    config: assetCacheStore.getConfig(),
    stats: assetCacheStore.getStats(activeSessions, inflightReads),
    builtinBlacklist: [...BUILTIN_BLACKLIST],
  };
}

cacheRouter.get(
  '/',
  asyncHandler((_req, res) => {
    res.json(snapshot());
  }),
);

cacheRouter.put(
  '/config',
  asyncHandler((req, res) => {
    const parsed = updateAssetCacheConfigSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid config' });
    }
    const config = assetCacheStore.updateConfig(parsed.data);
    auditFromReq(req, {
      action: AUDIT_ACTIONS.cacheConfigUpdate,
      resourceType: 'cache',
      success: true,
      detail: {
        enabled: config.enabled,
        cacheImages: config.cacheImages,
        maxMemoryBytes: config.maxMemoryBytes,
        maxDiskBytes: config.maxDiskBytes,
        defaultTtlSec: config.defaultTtlSec,
        immutableTtlSec: config.immutableTtlSec,
        blacklistCount: config.blacklist.length,
      },
    });
    res.json(snapshot());
  }),
);

cacheRouter.get(
  '/entries',
  asyncHandler((req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const host = typeof req.query.host === 'string' ? req.query.host : undefined;
    const sortRaw = typeof req.query.sort === 'string' ? req.query.sort : 'hits';
    const sort =
      sortRaw === 'size' || sortRaw === 'updated' || sortRaw === 'ttl' ? sortRaw : 'hits';
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const result = assetCacheStore.listEntries({ q, host, sort, limit, offset });
    res.json({ ...result, limit, offset });
  }),
);

cacheRouter.post(
  '/refresh',
  asyncHandler((req, res) => {
    const parsed = assetCacheTargetSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request' });
    }
    const { scope, host, key } = parsed.data;
    if (scope === 'host' && !host) return res.status(400).json({ error: 'host is required' });
    if (scope === 'key' && !key) return res.status(400).json({ error: 'key is required' });

    const affected = assetCacheStore.refreshScope(scope, scope === 'host' ? host : key);
    auditFromReq(req, {
      action: AUDIT_ACTIONS.cacheRefresh,
      resourceType: 'cache',
      resourceId: scope === 'all' ? 'all' : scope === 'host' ? host : key,
      success: true,
      detail: { scope, host, key, affected },
    });
    res.json({ ok: true, affected, ...snapshot() });
  }),
);

cacheRouter.post(
  '/purge',
  asyncHandler((req, res) => {
    const parsed = assetCacheTargetSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request' });
    }
    const { scope, host, key } = parsed.data;
    if (scope === 'host' && !host) return res.status(400).json({ error: 'host is required' });
    if (scope === 'key' && !key) return res.status(400).json({ error: 'key is required' });

    const affected = assetCacheStore.purgeScope(scope, scope === 'host' ? host : key);
    auditFromReq(req, {
      action: AUDIT_ACTIONS.cachePurge,
      resourceType: 'cache',
      resourceId: scope === 'all' ? 'all' : scope === 'host' ? host : key,
      success: true,
      detail: { scope, host, key, affected },
    });
    res.json({ ok: true, affected, ...snapshot() });
  }),
);

cacheRouter.post(
  '/stats/reset',
  asyncHandler((_req, res) => {
    assetCacheStore.resetStats();
    res.json({ ok: true, ...snapshot() });
  }),
);
