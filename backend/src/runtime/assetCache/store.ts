import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  ASSET_CACHE_DEFAULTS,
  type AssetCacheConfig,
  type AssetCacheEntrySummary,
  type AssetCacheHostStat,
  type AssetCacheStats,
} from '@nya/shared';
import { DATA_DIR } from '../../config.js';
import { sqlite } from '../../db/client.js';
import { logger } from '../../logger.js';
import { normalizePattern, type HeaderEntry } from './policy.js';

const SETTINGS_KEY = 'asset_cache_config';
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const HIT_FLUSH_INTERVAL_MS = 2000;
const DISK_READ_TIMEOUT_MS = 400;

export type CachedPayload = {
  cacheKey: string;
  url: string;
  host: string;
  originBucket: string;
  varyLang: string;
  resourceType: string;
  contentType: string;
  headers: HeaderEntry[];
  bodyBase64: string;
  sizeBytes: number;
  immutable: boolean;
  softExpiresAt: number;
  expiresAt: number;
};

type MemoryItem = CachedPayload & {
  memBytes: number;
};

type DbEntryRow = {
  cache_key: string;
  url: string;
  host: string;
  origin_bucket: string;
  vary_lang: string;
  resource_type: string;
  content_type: string;
  response_headers: string;
  size_bytes: number;
  immutable: number;
  hits: number;
  saved_bytes: number;
  created_at: number;
  updated_at: number;
  last_hit_at: number;
  soft_expires_at: number;
  expires_at: number;
};

export type LookupResult =
  | { hit: true; tier: 'memory' | 'disk'; payload: CachedPayload }
  | { hit: false; staleKey?: string };

export type PutAssetInput = {
  cacheKey: string;
  url: string;
  host: string;
  originBucket: string;
  varyLang: string;
  resourceType: string;
  contentType: string;
  headers: HeaderEntry[];
  bodyBuf: Buffer;
  immutable: boolean;
  softTtlSec: number;
  hardTtlSec: number;
  isRefresh?: boolean;
};

type ConfigListener = (config: AssetCacheConfig) => void;

function defaultConfig(): AssetCacheConfig {
  return {
    enabled: ASSET_CACHE_DEFAULTS.enabled,
    cacheImages: ASSET_CACHE_DEFAULTS.cacheImages,
    maxMemoryBytes: ASSET_CACHE_DEFAULTS.maxMemoryBytes,
    maxDiskBytes: ASSET_CACHE_DEFAULTS.maxDiskBytes,
    maxEntryBytes: ASSET_CACHE_DEFAULTS.maxEntryBytes,
    defaultTtlSec: ASSET_CACHE_DEFAULTS.defaultTtlSec,
    immutableTtlSec: ASSET_CACHE_DEFAULTS.immutableTtlSec,
    builtinBlacklistEnabled: ASSET_CACHE_DEFAULTS.builtinBlacklistEnabled,
    blacklist: [...ASSET_CACHE_DEFAULTS.blacklist],
  };
}

function dedupeBlacklist(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const norm = normalizePattern(raw);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

function estimateMemBytes(base64Len: number): number {
  // Base64 ASCII string + JS object/header overhead
  return Math.ceil(base64Len * 1.1) + 2048;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('disk-read-timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

class AssetCacheStore {
  private config: AssetCacheConfig = defaultConfig();
  private readonly listeners = new Set<ConfigListener>();
  private readonly mem = new Map<string, MemoryItem>();
  private memBytes = 0;
  private readonly pendingHits = new Map<string, { hits: number; savedBytes: number; lastHitAt: number }>();

  private requestsIntercepted = 0;
  private hits = 0;
  private memoryHits = 0;
  private diskHits = 0;
  private misses = 0;
  private refreshes = 0;
  private stores = 0;
  private bypasses = 0;
  private errors = 0;
  private savedBytes = 0;
  private startedAt = new Date().toISOString();
  private bypassReasons = new Map<string, number>();

  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private hitFlushTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;
  private evictingDisk = false;

  private blobsRoot(): string {
    return path.join(DATA_DIR, 'asset-cache', 'blobs');
  }

  private blobPath(cacheKey: string): string {
    const prefix = cacheKey.slice(0, 2);
    return path.join(this.blobsRoot(), prefix, `${cacheKey}.bin`);
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;
    fs.mkdirSync(this.blobsRoot(), { recursive: true });
    this.loadConfig();
    this.cleanupOrphanTmpFiles();
    this.sweepExpired();
    this.enforceDiskQuota();

    this.sweepTimer = setInterval(() => {
      try {
        this.flushPendingHits();
        this.sweepExpired();
        this.enforceDiskQuota();
      } catch (err) {
        logger.warn({ err }, 'asset-cache sweep failed');
      }
    }, SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();

    this.hitFlushTimer = setInterval(() => {
      try {
        this.flushPendingHits();
      } catch {
        /* ignore */
      }
    }, HIT_FLUSH_INTERVAL_MS);
    this.hitFlushTimer.unref?.();
  }

  shutdown() {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    if (this.hitFlushTimer) {
      clearInterval(this.hitFlushTimer);
      this.hitFlushTimer = null;
    }
    try {
      this.flushPendingHits();
    } catch {
      /* ignore */
    }
  }

  private loadConfig() {
    try {
      const row = sqlite
        .prepare('SELECT value FROM app_settings WHERE key = ?')
        .get(SETTINGS_KEY) as { value: string } | undefined;
      if (!row?.value) return;
      const parsed = JSON.parse(row.value) as Partial<AssetCacheConfig>;
      this.config = {
        ...defaultConfig(),
        ...parsed,
        blacklist: Array.isArray(parsed.blacklist) ? dedupeBlacklist(parsed.blacklist) : [],
      };
    } catch (err) {
      logger.warn({ err }, 'asset-cache loadConfig fallback to defaults');
      this.config = defaultConfig();
    }
  }

  private saveConfig() {
    sqlite
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(SETTINGS_KEY, JSON.stringify(this.config), new Date().toISOString());
  }

  getConfig(): AssetCacheConfig {
    return {
      ...this.config,
      blacklist: [...this.config.blacklist],
    };
  }

  updateConfig(patch: Partial<AssetCacheConfig>): AssetCacheConfig {
    const prev = this.config;
    const next: AssetCacheConfig = {
      enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : prev.enabled,
      cacheImages: patch.cacheImages !== undefined ? Boolean(patch.cacheImages) : prev.cacheImages,
      maxMemoryBytes: patch.maxMemoryBytes ?? prev.maxMemoryBytes,
      maxDiskBytes: patch.maxDiskBytes ?? prev.maxDiskBytes,
      maxEntryBytes: patch.maxEntryBytes ?? prev.maxEntryBytes,
      defaultTtlSec: patch.defaultTtlSec ?? prev.defaultTtlSec,
      immutableTtlSec: patch.immutableTtlSec ?? prev.immutableTtlSec,
      builtinBlacklistEnabled:
        patch.builtinBlacklistEnabled !== undefined
          ? Boolean(patch.builtinBlacklistEnabled)
          : prev.builtinBlacklistEnabled,
      blacklist: patch.blacklist !== undefined ? dedupeBlacklist(patch.blacklist) : [...prev.blacklist],
    };
    this.config = next;
    this.saveConfig();
    this.enforceMemoryQuota();
    this.enforceDiskQuota();
    for (const fn of this.listeners) {
      try {
        fn(this.getConfig());
      } catch {
        /* ignore */
      }
    }
    return this.getConfig();
  }

  onConfigChange(fn: ConfigListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  recordIntercepted() {
    this.requestsIntercepted += 1;
  }

  recordBypass(reason: string) {
    this.bypasses += 1;
    this.bypassReasons.set(reason, (this.bypassReasons.get(reason) || 0) + 1);
  }

  recordMiss() {
    this.misses += 1;
  }

  recordError() {
    this.errors += 1;
  }

  private recordHit(cacheKey: string, sizeBytes: number, tier: 'memory' | 'disk', nowMs: number) {
    this.hits += 1;
    if (tier === 'memory') this.memoryHits += 1;
    else this.diskHits += 1;
    this.savedBytes += sizeBytes;

    const prev = this.pendingHits.get(cacheKey);
    if (prev) {
      prev.hits += 1;
      prev.savedBytes += sizeBytes;
      prev.lastHitAt = nowMs;
    } else {
      this.pendingHits.set(cacheKey, { hits: 1, savedBytes: sizeBytes, lastHitAt: nowMs });
    }
  }

  flushPendingHits() {
    if (!this.pendingHits.size) return;
    const batch = Array.from(this.pendingHits.entries());
    this.pendingHits.clear();
    const stmt = sqlite.prepare(
      `UPDATE asset_cache_entries
       SET hits = hits + ?, saved_bytes = saved_bytes + ?, last_hit_at = MAX(last_hit_at, ?)
       WHERE cache_key = ?`,
    );
    const tx = sqlite.transaction((items: typeof batch) => {
      for (const [key, delta] of items) {
        stmt.run(delta.hits, delta.savedBytes, delta.lastHitAt, key);
      }
    });
    tx(batch);
  }

  private touchMemory(item: MemoryItem) {
    this.mem.delete(item.cacheKey);
    this.mem.set(item.cacheKey, item);
  }

  private putMemory(payload: CachedPayload) {
    const maxMem = this.config.maxMemoryBytes;
    const memBytes = estimateMemBytes(payload.bodyBase64.length);
    if (memBytes > maxMem) return;
    const existing = this.mem.get(payload.cacheKey);
    if (existing) {
      this.memBytes -= existing.memBytes;
      this.mem.delete(payload.cacheKey);
    }
    this.mem.set(payload.cacheKey, { ...payload, memBytes });
    this.memBytes += memBytes;
    this.enforceMemoryQuota();
  }

  private deleteMemory(cacheKey: string) {
    const existing = this.mem.get(cacheKey);
    if (!existing) return;
    this.memBytes -= existing.memBytes;
    this.mem.delete(cacheKey);
  }

  private enforceMemoryQuota() {
    const maxMem = this.config.maxMemoryBytes;
    while (this.memBytes > maxMem && this.mem.size > 0) {
      const oldestKey = this.mem.keys().next().value;
      if (!oldestKey) break;
      this.deleteMemory(oldestKey);
    }
    if (this.mem.size === 0) this.memBytes = 0;
  }

  async lookup(candidateKeys: string[], nowMs = Date.now()): Promise<LookupResult> {
    let staleKey: string | undefined;

    // 1. Check L1 Memory
    for (const key of candidateKeys) {
      const item = this.mem.get(key);
      if (!item) continue;
      if (nowMs >= item.expiresAt) {
        this.deleteMemory(key);
        staleKey = staleKey || key;
        continue;
      }
      if (nowMs >= item.softExpiresAt) {
        staleKey = staleKey || key;
        continue;
      }
      this.touchMemory(item);
      this.recordHit(key, item.sizeBytes, 'memory', nowMs);
      return { hit: true, tier: 'memory', payload: item };
    }

    // 2. Check L2 SQLite + Disk
    const stmt = sqlite.prepare('SELECT * FROM asset_cache_entries WHERE cache_key = ?');
    for (const key of candidateKeys) {
      const row = stmt.get(key) as DbEntryRow | undefined;
      if (!row) continue;
      if (nowMs >= row.expires_at) {
        this.deleteRowAndBlob(key);
        staleKey = staleKey || key;
        continue;
      }
      if (nowMs >= row.soft_expires_at) {
        staleKey = staleKey || key;
        continue;
      }

      const filePath = this.blobPath(key);
      let buf: Buffer;
      try {
        buf = await withTimeout(fs.promises.readFile(filePath), DISK_READ_TIMEOUT_MS);
      } catch {
        // Missing or unreadable blob -> self-heal row and fail-open as miss
        this.deleteRowAndBlob(key);
        continue;
      }

      let headers: HeaderEntry[] = [];
      try {
        headers = JSON.parse(row.response_headers) as HeaderEntry[];
      } catch {
        headers = [{ name: 'content-type', value: row.content_type }];
      }

      const payload: CachedPayload = {
        cacheKey: row.cache_key,
        url: row.url,
        host: row.host,
        originBucket: row.origin_bucket,
        varyLang: row.vary_lang,
        resourceType: row.resource_type,
        contentType: row.content_type,
        headers,
        bodyBase64: buf.toString('base64'),
        sizeBytes: buf.length,
        immutable: Boolean(row.immutable),
        softExpiresAt: row.soft_expires_at,
        expiresAt: row.expires_at,
      };
      this.putMemory(payload);
      this.recordHit(key, payload.sizeBytes, 'disk', nowMs);
      return { hit: true, tier: 'disk', payload };
    }

    return staleKey ? { hit: false, staleKey } : { hit: false };
  }

  async put(input: PutAssetInput): Promise<void> {
    const nowMs = Date.now();
    const softExpiresAt = nowMs + input.softTtlSec * 1000;
    const expiresAt = nowMs + input.hardTtlSec * 1000;
    const sizeBytes = input.bodyBuf.length;

    const finalHeaders: HeaderEntry[] = [
      ...input.headers.filter((h) => h.name.toLowerCase() !== 'content-length'),
      { name: 'content-length', value: String(sizeBytes) },
    ];

    const filePath = this.blobPath(input.cacheKey);
    const dir = path.dirname(filePath);
    const tmpPath = `${filePath}.tmp.${crypto.randomBytes(4).toString('hex')}`;
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(tmpPath, input.bodyBuf);
    try {
      await fs.promises.rename(tmpPath, filePath);
    } catch (err) {
      await fs.promises.unlink(tmpPath).catch(() => undefined);
      throw err;
    }

    const existing = sqlite
      .prepare('SELECT cache_key FROM asset_cache_entries WHERE cache_key = ?')
      .get(input.cacheKey) as { cache_key: string } | undefined;

    sqlite
      .prepare(
        `INSERT INTO asset_cache_entries (
          cache_key, url, host, origin_bucket, vary_lang, resource_type, content_type,
          response_headers, size_bytes, immutable, hits, saved_bytes,
          created_at, updated_at, last_hit_at, soft_expires_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          url = excluded.url,
          host = excluded.host,
          origin_bucket = excluded.origin_bucket,
          vary_lang = excluded.vary_lang,
          resource_type = excluded.resource_type,
          content_type = excluded.content_type,
          response_headers = excluded.response_headers,
          size_bytes = excluded.size_bytes,
          immutable = excluded.immutable,
          updated_at = excluded.updated_at,
          last_hit_at = excluded.last_hit_at,
          soft_expires_at = excluded.soft_expires_at,
          expires_at = excluded.expires_at`,
      )
      .run(
        input.cacheKey,
        input.url,
        input.host,
        input.originBucket,
        input.varyLang,
        input.resourceType,
        input.contentType,
        JSON.stringify(finalHeaders),
        sizeBytes,
        input.immutable ? 1 : 0,
        nowMs,
        nowMs,
        nowMs,
        softExpiresAt,
        expiresAt,
      );

    const payload: CachedPayload = {
      cacheKey: input.cacheKey,
      url: input.url,
      host: input.host,
      originBucket: input.originBucket,
      varyLang: input.varyLang,
      resourceType: input.resourceType,
      contentType: input.contentType,
      headers: finalHeaders,
      bodyBase64: input.bodyBuf.toString('base64'),
      sizeBytes,
      immutable: input.immutable,
      softExpiresAt,
      expiresAt,
    };
    this.putMemory(payload);

    if (input.isRefresh || existing) this.refreshes += 1;
    else this.stores += 1;

    this.enforceDiskQuota();
  }

  private unlinkQuiet(filePath: string) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* ignore */
    }
  }

  private deleteRowAndBlob(cacheKey: string) {
    this.deleteMemory(cacheKey);
    this.pendingHits.delete(cacheKey);
    try {
      sqlite.prepare('DELETE FROM asset_cache_entries WHERE cache_key = ?').run(cacheKey);
    } catch {
      /* ignore */
    }
    this.unlinkQuiet(this.blobPath(cacheKey));
  }

  private cleanupOrphanTmpFiles() {
    const root = this.blobsRoot();
    if (!fs.existsSync(root)) return;
    try {
      for (const sub of fs.readdirSync(root, { withFileTypes: true })) {
        if (!sub.isDirectory()) continue;
        const subDir = path.join(root, sub.name);
        for (const f of fs.readdirSync(subDir)) {
          if (f.includes('.tmp.')) this.unlinkQuiet(path.join(subDir, f));
        }
      }
    } catch {
      /* ignore */
    }
  }

  sweepExpired(nowMs = Date.now()) {
    const rows = sqlite
      .prepare('SELECT cache_key FROM asset_cache_entries WHERE expires_at <= ?')
      .all(nowMs) as { cache_key: string }[];
    if (!rows.length) return 0;
    const del = sqlite.prepare('DELETE FROM asset_cache_entries WHERE cache_key = ?');
    const tx = sqlite.transaction((keys: { cache_key: string }[]) => {
      for (const r of keys) del.run(r.cache_key);
    });
    tx(rows);
    for (const r of rows) {
      this.deleteMemory(r.cache_key);
      this.pendingHits.delete(r.cache_key);
      this.unlinkQuiet(this.blobPath(r.cache_key));
    }
    return rows.length;
  }

  enforceDiskQuota() {
    if (this.evictingDisk) return;
    this.evictingDisk = true;
    try {
      const maxDisk = this.config.maxDiskBytes;
      const agg = sqlite
        .prepare('SELECT COALESCE(SUM(size_bytes), 0) AS total FROM asset_cache_entries')
        .get() as { total: number };
      let total = Number(agg?.total || 0);
      if (total <= maxDisk) return;

      const target = Math.floor(maxDisk * 0.92);
      const victims = sqlite
        .prepare(
          'SELECT cache_key, size_bytes FROM asset_cache_entries ORDER BY last_hit_at ASC LIMIT 2000',
        )
        .all() as { cache_key: string; size_bytes: number }[];

      const toDelete: string[] = [];
      for (const v of victims) {
        if (total <= target) break;
        toDelete.push(v.cache_key);
        total -= v.size_bytes;
      }
      if (!toDelete.length) return;
      const del = sqlite.prepare('DELETE FROM asset_cache_entries WHERE cache_key = ?');
      const tx = sqlite.transaction((keys: string[]) => {
        for (const k of keys) del.run(k);
      });
      tx(toDelete);
      for (const k of toDelete) {
        this.deleteMemory(k);
        this.pendingHits.delete(k);
        this.unlinkQuiet(this.blobPath(k));
      }
    } finally {
      this.evictingDisk = false;
    }
  }

  refreshScope(scope: 'all' | 'host' | 'key', target?: string): number {
    this.flushPendingHits();
    if (scope === 'all') {
      const res = sqlite.prepare('UPDATE asset_cache_entries SET soft_expires_at = 0').run();
      for (const item of this.mem.values()) item.softExpiresAt = 0;
      return res.changes;
    }
    if (scope === 'host' && target) {
      const host = target.trim().toLowerCase();
      const res = sqlite
        .prepare('UPDATE asset_cache_entries SET soft_expires_at = 0 WHERE host = ?')
        .run(host);
      for (const item of this.mem.values()) {
        if (item.host === host) item.softExpiresAt = 0;
      }
      return res.changes;
    }
    if (scope === 'key' && target) {
      const res = sqlite
        .prepare('UPDATE asset_cache_entries SET soft_expires_at = 0 WHERE cache_key = ?')
        .run(target);
      const item = this.mem.get(target);
      if (item) item.softExpiresAt = 0;
      return res.changes;
    }
    return 0;
  }

  purgeScope(scope: 'all' | 'host' | 'key', target?: string): number {
    this.flushPendingHits();
    if (scope === 'all') {
      const rows = sqlite.prepare('SELECT cache_key FROM asset_cache_entries').all() as {
        cache_key: string;
      }[];
      sqlite.prepare('DELETE FROM asset_cache_entries').run();
      this.mem.clear();
      this.memBytes = 0;
      this.pendingHits.clear();
      for (const r of rows) this.unlinkQuiet(this.blobPath(r.cache_key));
      return rows.length;
    }
    if (scope === 'host' && target) {
      const host = target.trim().toLowerCase();
      const rows = sqlite
        .prepare('SELECT cache_key FROM asset_cache_entries WHERE host = ?')
        .all(host) as { cache_key: string }[];
      sqlite.prepare('DELETE FROM asset_cache_entries WHERE host = ?').run(host);
      for (const r of rows) {
        this.deleteMemory(r.cache_key);
        this.pendingHits.delete(r.cache_key);
        this.unlinkQuiet(this.blobPath(r.cache_key));
      }
      return rows.length;
    }
    if (scope === 'key' && target) {
      const existing = sqlite
        .prepare('SELECT cache_key FROM asset_cache_entries WHERE cache_key = ?')
        .get(target) as { cache_key: string } | undefined;
      if (!existing) {
        this.deleteMemory(target);
        return 0;
      }
      this.deleteRowAndBlob(target);
      return 1;
    }
    return 0;
  }

  resetStats() {
    this.requestsIntercepted = 0;
    this.hits = 0;
    this.memoryHits = 0;
    this.diskHits = 0;
    this.misses = 0;
    this.refreshes = 0;
    this.stores = 0;
    this.bypasses = 0;
    this.errors = 0;
    this.savedBytes = 0;
    this.bypassReasons.clear();
    this.startedAt = new Date().toISOString();
  }

  getStats(activeSessions: number, inflightReads: number): AssetCacheStats {
    this.flushPendingHits();
    const agg = sqlite
      .prepare('SELECT COUNT(*) AS cnt, COALESCE(SUM(size_bytes), 0) AS bytes FROM asset_cache_entries')
      .get() as { cnt: number; bytes: number };
    const topRows = sqlite
      .prepare(
        `SELECT host, COUNT(*) AS entries, COALESCE(SUM(size_bytes), 0) AS disk_bytes,
                COALESCE(SUM(hits), 0) AS hits, COALESCE(SUM(saved_bytes), 0) AS saved_bytes
         FROM asset_cache_entries
         GROUP BY host
         ORDER BY hits DESC, disk_bytes DESC
         LIMIT 30`,
      )
      .all() as {
      host: string;
      entries: number;
      disk_bytes: number;
      hits: number;
      saved_bytes: number;
    }[];

    const topHosts: AssetCacheHostStat[] = topRows.map((r) => ({
      host: r.host,
      entries: Number(r.entries || 0),
      diskBytes: Number(r.disk_bytes || 0),
      hits: Number(r.hits || 0),
      savedBytes: Number(r.saved_bytes || 0),
    }));

    const totalLookups = this.hits + this.misses;
    const bypassObj: Record<string, number> = {};
    for (const [k, v] of Array.from(this.bypassReasons.entries()).sort((a, b) => b[1] - a[1])) {
      bypassObj[k] = v;
    }

    return {
      enabled: this.config.enabled,
      requestsIntercepted: this.requestsIntercepted,
      hits: this.hits,
      memoryHits: this.memoryHits,
      diskHits: this.diskHits,
      misses: this.misses,
      refreshes: this.refreshes,
      stores: this.stores,
      bypasses: this.bypasses,
      errors: this.errors,
      hitRate: totalLookups > 0 ? this.hits / totalLookups : 0,
      savedBytes: this.savedBytes,
      memoryBytes: this.memBytes,
      memoryMaxBytes: this.config.maxMemoryBytes,
      memoryEntries: this.mem.size,
      diskBytes: Number(agg?.bytes || 0),
      diskMaxBytes: this.config.maxDiskBytes,
      diskEntries: Number(agg?.cnt || 0),
      activeSessions,
      inflightReads,
      startedAt: this.startedAt,
      bypassReasons: bypassObj,
      topHosts,
    };
  }

  listEntries(opts: {
    q?: string;
    host?: string;
    sort?: 'hits' | 'size' | 'updated' | 'ttl';
    limit?: number;
    offset?: number;
  }): { entries: AssetCacheEntrySummary[]; total: number } {
    this.flushPendingHits();
    const where: string[] = [];
    const params: unknown[] = [];

    if (opts.host) {
      where.push('host = ?');
      params.push(opts.host.trim().toLowerCase());
    }
    if (opts.q) {
      const like = `%${opts.q.trim().toLowerCase()}%`;
      where.push('(LOWER(url) LIKE ? OR LOWER(host) LIKE ?)');
      params.push(like, like);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderMap: Record<string, string> = {
      hits: 'hits DESC, updated_at DESC',
      size: 'size_bytes DESC, hits DESC',
      updated: 'updated_at DESC',
      ttl: 'soft_expires_at ASC',
    };
    const orderSql = orderMap[opts.sort || 'hits'] || orderMap.hits;
    const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50));
    const offset = Math.max(0, Number(opts.offset) || 0);

    const totalRow = sqlite
      .prepare(`SELECT COUNT(*) AS cnt FROM asset_cache_entries ${whereSql}`)
      .get(...params) as { cnt: number };

    const rows = sqlite
      .prepare(
        `SELECT * FROM asset_cache_entries ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as DbEntryRow[];

    const nowMs = Date.now();
    const entries: AssetCacheEntrySummary[] = rows.map((r) => {
      const ttlRemainingSec = Math.max(0, Math.floor((r.soft_expires_at - nowMs) / 1000));
      return {
        key: r.cache_key,
        url: r.url,
        host: r.host,
        originBucket: r.origin_bucket,
        varyLang: r.vary_lang,
        resourceType: r.resource_type,
        contentType: r.content_type,
        sizeBytes: r.size_bytes,
        inMemory: this.mem.has(r.cache_key),
        hits: r.hits,
        savedBytes: r.saved_bytes,
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
        lastHitAt: r.last_hit_at ? new Date(r.last_hit_at).toISOString() : null,
        softExpiresAt: new Date(r.soft_expires_at).toISOString(),
        expiresAt: new Date(r.expires_at).toISOString(),
        ttlRemainingSec,
        immutable: Boolean(r.immutable),
        stale: nowMs >= r.soft_expires_at,
      };
    });

    return { entries, total: Number(totalRow?.cnt || 0) };
  }
}

export const assetCacheStore = new AssetCacheStore();
