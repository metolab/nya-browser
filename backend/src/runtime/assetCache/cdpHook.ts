import type { AssetCacheConfig } from '@nya/shared';
import { logger } from '../../logger.js';
import {
  candidateCacheKeys,
  computeCacheKey,
  evaluateRequest,
  evaluateResponse,
  validateBody,
  type HeaderEntry,
  type RequestCheckResult,
} from './policy.js';
import { assetCacheStore } from './store.js';

const MAX_CONCURRENT_BODY_READS = 24;
const READ_BODY_TIMEOUT_MS = 5000;
const PENDING_TTL_MS = 60_000;

export type AssetCacheCdpClient = {
  send: (method: string, params?: Record<string, unknown>) => void;
  call: (
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ) => Promise<Record<string, unknown> | undefined>;
};

type FetchPausedParams = {
  requestId?: string;
  request?: {
    url?: string;
    method?: string;
    headers?: Record<string, string>;
  };
  resourceType?: string;
  responseErrorReason?: string;
  responseStatusCode?: number;
  responseHeaders?: HeaderEntry[];
};

type PendingEntry = {
  req: Extract<RequestCheckResult, { ok: true }>;
  isRefresh: boolean;
  createdAt: number;
};

let inflightReads = 0;
const inflightKeys = new Set<string>();
const hooks = new Map<string, SessionAssetCacheHook>();

let configListenerBound = false;
function ensureConfigListener() {
  if (configListenerBound) return;
  configListenerBound = true;
  assetCacheStore.onConfigChange((cfg) => {
    for (const hook of hooks.values()) {
      hook.syncConfig(cfg);
    }
  });
}

function buildFetchPatterns(config: AssetCacheConfig) {
  const types = config.cacheImages
    ? ['Script', 'Stylesheet', 'Font', 'Image']
    : ['Script', 'Stylesheet', 'Font'];
  return types.flatMap((resourceType) => [
    { urlPattern: 'https://*', resourceType, requestStage: 'Request' },
    { urlPattern: 'https://*', resourceType, requestStage: 'Response' },
  ]);
}

export class SessionAssetCacheHook {
  private enabled = false;
  private cacheImages = false;
  private closed = false;
  private readonly pendingReq = new Map<string, PendingEntry>();
  private readonly skipResponseIds = new Map<string, number>();

  constructor(
    readonly sessionId: string,
    private readonly cdp: AssetCacheCdpClient,
  ) {}

  start() {
    ensureConfigListener();
    hooks.set(this.sessionId, this);
    this.syncConfig(assetCacheStore.getConfig());
  }

  detach() {
    this.closed = true;
    this.pendingReq.clear();
    this.skipResponseIds.clear();
    if (hooks.get(this.sessionId) === this) {
      hooks.delete(this.sessionId);
    }
  }

  syncConfig(config: AssetCacheConfig) {
    if (this.closed) return;
    if (!config.enabled) {
      if (this.enabled) {
        this.enabled = false;
        this.pendingReq.clear();
        this.skipResponseIds.clear();
        this.cdp.send('Fetch.disable');
      }
      return;
    }
    if (!this.enabled || this.cacheImages !== config.cacheImages) {
      this.enabled = true;
      this.cacheImages = config.cacheImages;
      this.cdp.send('Fetch.enable', {
        patterns: buildFetchPatterns(config),
      });
    }
  }

  private pruneMaps(now: number) {
    if (this.pendingReq.size > 200) {
      for (const [id, item] of this.pendingReq) {
        if (now - item.createdAt > PENDING_TTL_MS) this.pendingReq.delete(id);
      }
    }
    if (this.skipResponseIds.size > 400) {
      for (const [id, ts] of this.skipResponseIds) {
        if (now - ts > PENDING_TTL_MS) this.skipResponseIds.delete(id);
      }
    }
  }

  private continueRequest(requestId: string) {
    if (this.closed) return;
    this.cdp.send('Fetch.continueRequest', { requestId });
  }

  private continueResponse(requestId: string) {
    if (this.closed) return;
    this.cdp.send('Fetch.continueResponse', { requestId });
  }

  onEvent(method: string, params: Record<string, unknown>) {
    if (method !== 'Fetch.requestPaused' || this.closed) return;
    void this.handlePaused(params as FetchPausedParams).catch((err) => {
      assetCacheStore.recordError();
      logger.debug({ err, sessionId: this.sessionId }, 'asset-cache paused handler error');
      const requestId = String((params as FetchPausedParams).requestId || '');
      if (!requestId || this.closed) return;
      const isResponse =
        (params as FetchPausedParams).responseStatusCode !== undefined ||
        Boolean((params as FetchPausedParams).responseErrorReason);
      if (isResponse) this.continueResponse(requestId);
      else this.continueRequest(requestId);
    });
  }

  private async handlePaused(params: FetchPausedParams) {
    const requestId = params.requestId;
    if (!requestId) return;

    const isResponseStage =
      params.responseStatusCode !== undefined || Boolean(params.responseErrorReason);

    if (isResponseStage) {
      await this.handleResponseStage(requestId, params);
    } else {
      await this.handleRequestStage(requestId, params);
    }
  }

  private async handleRequestStage(requestId: string, params: FetchPausedParams) {
    const now = Date.now();
    this.pruneMaps(now);
    const config = assetCacheStore.getConfig();
    if (!config.enabled) {
      this.skipResponseIds.set(requestId, now);
      this.continueRequest(requestId);
      return;
    }

    assetCacheStore.recordIntercepted();

    const reqCheck = evaluateRequest(
      {
        url: params.request?.url || '',
        method: params.request?.method,
        resourceType: params.resourceType,
        headers: params.request?.headers,
      },
      config,
    );

    if (!reqCheck.ok) {
      assetCacheStore.recordBypass(reqCheck.reason);
      this.skipResponseIds.set(requestId, now);
      this.continueRequest(requestId);
      return;
    }

    if (reqCheck.forceReload) {
      this.pendingReq.set(requestId, { req: reqCheck, isRefresh: true, createdAt: now });
      this.continueRequest(requestId);
      return;
    }

    const keys = candidateCacheKeys(reqCheck.canonicalUrl, reqCheck.origin, reqCheck.primaryLang);
    let lookup;
    try {
      lookup = await assetCacheStore.lookup(keys, now);
    } catch {
      assetCacheStore.recordError();
      this.pendingReq.set(requestId, { req: reqCheck, isRefresh: false, createdAt: now });
      this.continueRequest(requestId);
      return;
    }

    if (lookup.hit) {
      try {
        await this.cdp.call(
          'Fetch.fulfillRequest',
          {
            requestId,
            responseCode: 200,
            responseHeaders: lookup.payload.headers,
            body: lookup.payload.bodyBase64,
          },
          3000,
        );
      } catch {
        assetCacheStore.recordError();
        this.continueRequest(requestId);
      }
      return;
    }

    this.pendingReq.set(requestId, {
      req: reqCheck,
      isRefresh: Boolean(lookup.staleKey),
      createdAt: now,
    });
    this.continueRequest(requestId);
  }

  private async handleResponseStage(requestId: string, params: FetchPausedParams) {
    const pending = this.pendingReq.get(requestId);
    if (pending) this.pendingReq.delete(requestId);

    if (this.skipResponseIds.delete(requestId)) {
      this.continueResponse(requestId);
      return;
    }

    const config = assetCacheStore.getConfig();
    if (!config.enabled) {
      this.continueResponse(requestId);
      return;
    }

    let reqInfo = pending?.req;
    let isRefresh = pending?.isRefresh || false;

    if (!reqInfo) {
      const check = evaluateRequest(
        {
          url: params.request?.url || '',
          method: params.request?.method,
          resourceType: params.resourceType,
          headers: params.request?.headers,
        },
        config,
      );
      if (!check.ok) {
        this.continueResponse(requestId);
        return;
      }
      reqInfo = check;
      isRefresh = check.forceReload;
    }

    const resCheck = evaluateResponse(
      reqInfo,
      {
        statusCode: params.responseStatusCode,
        errorReason: params.responseErrorReason,
        headers: params.responseHeaders,
      },
      config,
    );

    if (!resCheck.ok) {
      assetCacheStore.recordBypass(resCheck.reason);
      this.continueResponse(requestId);
      return;
    }

    const cacheKey = computeCacheKey(reqInfo.canonicalUrl, resCheck.originBucket, resCheck.varyLang);
    if (inflightReads >= MAX_CONCURRENT_BODY_READS || inflightKeys.has(cacheKey)) {
      assetCacheStore.recordMiss();
      assetCacheStore.recordBypass('concurrency-limit');
      this.continueResponse(requestId);
      return;
    }

    inflightReads += 1;
    inflightKeys.add(cacheKey);
    let continued = false;
    const ensureContinue = () => {
      if (continued) return;
      continued = true;
      this.continueResponse(requestId);
    };

    try {
      const bodyRes = await this.cdp.call(
        'Fetch.getResponseBody',
        { requestId },
        READ_BODY_TIMEOUT_MS,
      );
      // Release browser response immediately before validation & disk I/O
      ensureContinue();

      const bodyStr = typeof bodyRes?.body === 'string' ? bodyRes.body : '';
      const isBase64 = Boolean(bodyRes?.base64Encoded);
      if (!bodyStr) {
        assetCacheStore.recordBypass('empty-body');
        return;
      }
      const bodyBuf = isBase64 ? Buffer.from(bodyStr, 'base64') : Buffer.from(bodyStr, 'utf8');
      const bodyProblem = validateBody(bodyBuf, reqInfo.resourceType, config.maxEntryBytes);
      if (bodyProblem) {
        assetCacheStore.recordBypass(bodyProblem);
        return;
      }

      assetCacheStore.recordMiss();
      await assetCacheStore.put({
        cacheKey,
        url: reqInfo.canonicalUrl,
        host: reqInfo.host,
        originBucket: resCheck.originBucket,
        varyLang: resCheck.varyLang,
        resourceType: reqInfo.resourceType,
        contentType: resCheck.contentType,
        headers: resCheck.sanitizedHeaders,
        bodyBuf,
        immutable: resCheck.immutable,
        softTtlSec: resCheck.softTtlSec,
        hardTtlSec: resCheck.hardTtlSec,
        isRefresh,
      });
    } catch {
      ensureContinue();
      assetCacheStore.recordError();
    } finally {
      inflightReads = Math.max(0, inflightReads - 1);
      inflightKeys.delete(cacheKey);
    }
  }
}

export function attachSessionAssetCache(sessionId: string, cdp: AssetCacheCdpClient): SessionAssetCacheHook {
  const prev = hooks.get(sessionId);
  if (prev) prev.detach();
  const hook = new SessionAssetCacheHook(sessionId, cdp);
  hook.start();
  return hook;
}

export function getAssetCacheRuntimeCounts() {
  return {
    activeSessions: hooks.size,
    inflightReads,
  };
}
