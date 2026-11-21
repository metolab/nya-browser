import { z } from 'zod';

export const ASSET_CACHE_DEFAULTS = {
  enabled: true,
  cacheImages: false,
  maxMemoryBytes: 256 * 1024 * 1024, // 256 MiB
  maxDiskBytes: 5 * 1024 * 1024 * 1024, // 5 GiB
  maxEntryBytes: 4 * 1024 * 1024, // 4 MiB
  defaultTtlSec: 24 * 3600, // 24 hours
  immutableTtlSec: 7 * 24 * 3600, // 7 days
  builtinBlacklistEnabled: true,
  blacklist: [] as string[],
} as const;

export interface AssetCacheConfig {
  enabled: boolean;
  cacheImages: boolean;
  maxMemoryBytes: number;
  maxDiskBytes: number;
  maxEntryBytes: number;
  defaultTtlSec: number;
  immutableTtlSec: number;
  builtinBlacklistEnabled: boolean;
  blacklist: string[];
}

export interface AssetCacheHostStat {
  host: string;
  entries: number;
  diskBytes: number;
  hits: number;
  savedBytes: number;
}

export interface AssetCacheEntrySummary {
  key: string;
  url: string;
  host: string;
  originBucket: string;
  varyLang: string;
  resourceType: string;
  contentType: string;
  sizeBytes: number;
  inMemory: boolean;
  hits: number;
  savedBytes: number;
  createdAt: string;
  updatedAt: string;
  lastHitAt: string | null;
  softExpiresAt: string;
  expiresAt: string;
  ttlRemainingSec: number;
  immutable: boolean;
  stale: boolean;
}

export interface AssetCacheStats {
  enabled: boolean;
  requestsIntercepted: number;
  hits: number;
  memoryHits: number;
  diskHits: number;
  misses: number;
  refreshes: number;
  stores: number;
  bypasses: number;
  errors: number;
  hitRate: number;
  savedBytes: number;
  memoryBytes: number;
  memoryMaxBytes: number;
  memoryEntries: number;
  diskBytes: number;
  diskMaxBytes: number;
  diskEntries: number;
  activeSessions: number;
  inflightReads: number;
  startedAt: string;
  bypassReasons: Record<string, number>;
  topHosts: AssetCacheHostStat[];
}

export const updateAssetCacheConfigSchema = z.object({
  enabled: z.boolean().optional(),
  cacheImages: z.boolean().optional(),
  maxMemoryBytes: z
    .number()
    .int()
    .min(16 * 1024 * 1024)
    .max(2 * 1024 * 1024 * 1024)
    .optional(),
  maxDiskBytes: z
    .number()
    .int()
    .min(64 * 1024 * 1024)
    .max(100 * 1024 * 1024 * 1024)
    .optional(),
  maxEntryBytes: z
    .number()
    .int()
    .min(64 * 1024)
    .max(16 * 1024 * 1024)
    .optional(),
  defaultTtlSec: z.number().int().min(300).max(30 * 86400).optional(),
  immutableTtlSec: z.number().int().min(300).max(90 * 86400).optional(),
  builtinBlacklistEnabled: z.boolean().optional(),
  blacklist: z.array(z.string().trim().min(1).max(255)).max(500).optional(),
});

export const assetCacheTargetSchema = z.object({
  scope: z.enum(['all', 'host', 'key']),
  host: z.string().trim().min(1).max(255).optional(),
  key: z.string().trim().min(1).max(128).optional(),
});
