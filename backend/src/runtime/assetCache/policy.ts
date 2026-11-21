import crypto from 'crypto';
import type { AssetCacheConfig } from '@nya/shared';

export type HeaderEntry = { name: string; value: string };

export const MIN_ENTRY_BYTES = 512;

export const BUILTIN_BLACKLIST: readonly string[] = [
  // Anti-bot, WAF & Captcha
  'challenges.cloudflare.com',
  '*.cloudflare.com/cdn-cgi/*',
  'recaptcha.net',
  'www.google.com/recaptcha/*',
  'www.gstatic.com/recaptcha/*',
  'hcaptcha.com',
  'arkoselabs.com',
  'funcaptcha.com',
  'geetest.com',
  'captcha.gtimg.com',
  'turing.captcha.qcloud.com',
  't.captcha.qq.com',
  'ssl.captcha.qq.com',
  'g.alicdn.com/AWSC/*',
  'g.alicdn.com/sd/ncpc/*',
  'g.alicdn.com/sd/baxia/*',
  'o.alicdn.com/captcha-frontend/*',
  'datadome.co',
  'perimeterx.net',
  'px-cdn.net',
  'kasada.io',
  'fpjs.io',
  'fpcdn.io',
  // Payment & Auth widgets
  'js.stripe.com',
  'checkout.stripe.com',
  'paypal.com',
  'paypalobjects.com',
  'alipay.com',
  'alipayobjects.com',
  // Analytics, Telemetry & Ads
  'www.google-analytics.com',
  'www.googletagmanager.com',
  'pagead2.googlesyndication.com',
  'hm.baidu.com',
  'pos.baidu.com',
  'cpro.baidustatic.com',
  'connect.facebook.net',
  'bat.bing.com',
  'clarity.ms',
  'browser.sentry-cdn.com',
  'rum.browser-intake-datadoghq.com',
];

const SENSITIVE_PATH_RE =
  /\/(cdn-cgi|akam|captcha|recaptcha|turnstile|challenge|baxia|awsc|waf|csrf|xsrf|nonce|oauth|sso|logout|signin|signup|login|session|sessions|account|profile|avatar|avatars|user|users|userinfo|token|tokens|verify|verification|2fa|mfa|passkey|webauthn)(\/|$|\.)/i;

const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'access_token',
  'id_token',
  'refresh_token',
  'auth',
  'auth_token',
  'sig',
  'signature',
  'sign',
  'key',
  'apikey',
  'api_key',
  'secret',
  'session',
  'sessionid',
  'session_id',
  'sid',
  'sess',
  'uid',
  'userid',
  'user_id',
  'user',
  'username',
  'email',
  'account',
  'nonce',
  'csrf',
  'xsrf',
  'state',
  'code',
  'ticket',
  'st',
  'expires',
  'exp',
  'x-amz-signature',
  'x-amz-credential',
  'x-amz-security-token',
  'x-oss-signature',
  'x-cos-security-token',
  'ossaccesskeyid',
  'q-signature',
  'q-ak',
  'callback',
  'jsonp',
  '_',
  'rand',
  'random',
  't',
  'ts',
  'timestamp',
  'cachebust',
  'cb',
]);

const VERSION_QUERY_KEYS = new Set(['v', 'ver', 'version', 'hash', 'build', 'rev', 'release']);

const ALLOWED_RESOURCE_TYPES = new Set(['Script', 'Stylesheet', 'Font']);
const ALLOWED_CONTENT_TYPES: Record<string, Set<string>> = {
  Script: new Set([
    'text/javascript',
    'application/javascript',
    'application/x-javascript',
    'application/ecmascript',
    'text/ecmascript',
    'application/wasm',
  ]),
  Stylesheet: new Set(['text/css']),
  Font: new Set([
    'font/woff2',
    'font/woff',
    'font/ttf',
    'font/otf',
    'application/font-woff',
    'application/font-woff2',
    'application/x-font-woff',
    'application/x-font-ttf',
    'application/vnd.ms-fontobject',
  ]),
  Image: new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/avif',
    'image/gif',
    'image/x-icon',
    'image/vnd.microsoft.icon',
  ]),
};

const FONT_EXT_RE = /\.(woff2|woff|ttf|otf|eot)$/i;

const SAFE_VARY_TOKENS = new Set([
  'accept-encoding',
  'origin',
  'accept-language',
  'accept',
  'access-control-request-headers',
  'access-control-request-method',
]);

const SAFE_RESPONSE_HEADERS = new Set([
  'content-type',
  'cache-control',
  'access-control-allow-origin',
  'access-control-expose-headers',
  'timing-allow-origin',
  'cross-origin-resource-policy',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'x-content-type-options',
  'vary',
]);

export function normalizeHeadersMap(headers?: Record<string, string> | HeaderEntry[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!headers) return map;
  if (Array.isArray(headers)) {
    for (const h of headers) {
      const k = String(h.name || '').toLowerCase().trim();
      if (!k) continue;
      let list = map.get(k);
      if (!list) map.set(k, (list = []));
      list.push(String(h.value ?? ''));
    }
  } else {
    for (const [name, value] of Object.entries(headers)) {
      const k = name.toLowerCase().trim();
      if (!k) continue;
      map.set(k, [String(value ?? '')]);
    }
  }
  return map;
}

export function firstHeader(map: Map<string, string[]>, name: string): string {
  const vals = map.get(name.toLowerCase());
  return vals && vals.length ? vals[0] : '';
}

export function joinedHeader(map: Map<string, string[]>, name: string): string {
  const vals = map.get(name.toLowerCase());
  return vals && vals.length ? vals.join(', ') : '';
}

export function isPrivateOrLoopbackHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1') {
    return true;
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31)
  );
}

export function normalizePattern(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/#.*$/, '');
}

export function matchesBlacklistPattern(urlObj: URL, rawPattern: string): boolean {
  const pattern = normalizePattern(rawPattern);
  if (!pattern) return false;
  const host = urlObj.hostname.toLowerCase();
  const pathWithQuery = `${urlObj.pathname}${urlObj.search}`.toLowerCase();

  if (pattern.startsWith('/')) {
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
    return pathWithQuery.startsWith(prefix);
  }

  const slashIdx = pattern.indexOf('/');
  const hostPart = slashIdx >= 0 ? pattern.slice(0, slashIdx) : pattern;
  const pathPart = slashIdx >= 0 ? pattern.slice(slashIdx) : '';

  const baseHost = hostPart.startsWith('*.') ? hostPart.slice(2) : hostPart;
  if (!baseHost) return false;
  const hostMatched = host === baseHost || host.endsWith(`.${baseHost}`);
  if (!hostMatched) return false;

  if (!pathPart || pathPart === '/' || pathPart === '/*') return true;
  const pathPrefix = pathPart.endsWith('*') ? pathPart.slice(0, -1) : pathPart;
  return pathWithQuery.startsWith(pathPrefix);
}

export function isBlacklisted(urlObj: URL, config: AssetCacheConfig): string | null {
  for (const pat of config.blacklist) {
    if (matchesBlacklistPattern(urlObj, pat)) return 'user-blacklist';
  }
  if (config.builtinBlacklistEnabled) {
    for (const pat of BUILTIN_BLACKLIST) {
      if (matchesBlacklistPattern(urlObj, pat)) return 'builtin-blacklist';
    }
  }
  if (SENSITIVE_PATH_RE.test(urlObj.pathname)) {
    return 'sensitive-path';
  }
  return null;
}

export function isVersionedUrl(urlObj: URL): boolean {
  const pathname = urlObj.pathname;
  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1] || '';

  // Filename hash token like app.8f9e1a2b.js, chunk-a1b2c3d4e5.css, bundle_3f4a5b6c.mjs
  const baseName = last.replace(/\.[a-z0-9]{1,8}$/i, '');
  const tokens = baseName.split(/[._-]/);
  for (const tok of tokens) {
    if (tok.length >= 8 && /^[0-9a-f]+$/i.test(tok) && /[0-9]/.test(tok)) {
      return true;
    }
    if (tok.length >= 8 && /^[0-9a-z]+$/i.test(tok) && /[0-9]/.test(tok) && /[a-z]/i.test(tok)) {
      // Avoid common words with single trailing digit like chunk1 / vendor2; require >= 2 digits
      const digits = tok.replace(/[^0-9]/g, '').length;
      if (digits >= 2) return true;
    }
  }

  // Path version segment like /v1/, /v2.3.4/, /1.23.4/, /20260401/ or long hash directory
  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = segments[i];
    if (/^v?\d+\.\d+(\.\d+)?$/i.test(seg)) return true;
    if (/^20\d{6,10}$/.test(seg)) return true;
    if (seg.length >= 12 && /^[0-9a-f]+$/i.test(seg) && /[0-9]/.test(seg)) return true;
  }

  // Safe version query parameter
  for (const [k, v] of urlObj.searchParams.entries()) {
    if (VERSION_QUERY_KEYS.has(k.toLowerCase()) && /^[a-z0-9._-]{1,64}$/i.test(v)) {
      return true;
    }
  }
  return false;
}

export function primaryLanguage(acceptLang: string): string {
  const first = String(acceptLang || '')
    .split(',')[0]
    ?.split(';')[0]
    ?.trim()
    .toLowerCase();
  if (!first || first.length > 24 || !/^[a-z0-9-]+$/.test(first)) return '';
  return first;
}

function hostFromUrl(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export type RequestCheckResult =
  | {
      ok: true;
      canonicalUrl: string;
      urlObj: URL;
      host: string;
      resourceType: string;
      origin: string;
      primaryLang: string;
      forceReload: boolean;
      crossHost: boolean;
      versioned: boolean;
      hasCookie: boolean;
    }
  | {
      ok: false;
      reason: string;
    };

export function evaluateRequest(
  input: {
    url: string;
    method?: string;
    resourceType?: string;
    headers?: Record<string, string>;
  },
  config: AssetCacheConfig,
): RequestCheckResult {
  if (!config.enabled) return { ok: false, reason: 'disabled' };
  const method = String(input.method || 'GET').toUpperCase();
  if (method !== 'GET') return { ok: false, reason: 'non-get' };

  const resourceType = String(input.resourceType || '');
  const typeAllowed =
    ALLOWED_RESOURCE_TYPES.has(resourceType) || (config.cacheImages && resourceType === 'Image');
  if (!typeAllowed) return { ok: false, reason: 'resource-type' };

  let urlObj: URL;
  try {
    urlObj = new URL(input.url);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (urlObj.protocol !== 'https:') return { ok: false, reason: 'non-https' };
  if (urlObj.username || urlObj.password) return { ok: false, reason: 'url-credentials' };

  const host = urlObj.hostname.toLowerCase();
  if (isPrivateOrLoopbackHost(host)) return { ok: false, reason: 'private-host' };

  const blReason = isBlacklisted(urlObj, config);
  if (blReason) return { ok: false, reason: blReason };

  for (const key of urlObj.searchParams.keys()) {
    const lk = key.toLowerCase();
    if (SENSITIVE_QUERY_KEYS.has(lk)) {
      return { ok: false, reason: 'sensitive-query' };
    }
  }

  const headers = normalizeHeadersMap(input.headers);
  if (headers.has('authorization') || headers.has('proxy-authorization')) {
    return { ok: false, reason: 'auth-header' };
  }
  if (headers.has('range')) {
    return { ok: false, reason: 'range-request' };
  }
  const hasCookie = headers.has('cookie');

  const reqCc = joinedHeader(headers, 'cache-control').toLowerCase();
  const reqPragma = joinedHeader(headers, 'pragma').toLowerCase();
  const forceReload =
    reqCc.includes('no-cache') ||
    reqCc.includes('no-store') ||
    /(^|[,\s])max-age\s*=\s*0($|[,\s])/.test(reqCc) ||
    reqPragma.includes('no-cache');

  urlObj.hash = '';
  const canonicalUrl = urlObj.toString();

  const origin = firstHeader(headers, 'origin').trim();
  const referer = firstHeader(headers, 'referer').trim();
  const callerHost = hostFromUrl(origin) || hostFromUrl(referer);
  const crossHost = Boolean(callerHost && callerHost !== host);

  return {
    ok: true,
    canonicalUrl,
    urlObj,
    host,
    resourceType,
    origin,
    primaryLang: primaryLanguage(firstHeader(headers, 'accept-language')),
    forceReload,
    crossHost,
    versioned: isVersionedUrl(urlObj),
    hasCookie,
  };
}

export type ParsedCacheControl = {
  isPrivate: boolean;
  noStore: boolean;
  noCache: boolean;
  isPublic: boolean;
  immutable: boolean;
  maxAge: number | null;
};

export function parseCacheControl(header: string): ParsedCacheControl {
  const out: ParsedCacheControl = {
    isPrivate: false,
    noStore: false,
    noCache: false,
    isPublic: false,
    immutable: false,
    maxAge: null,
  };
  if (!header) return out;
  const parts = header.toLowerCase().split(',');
  let maxAge: number | null = null;
  let sMaxAge: number | null = null;
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq >= 0 ? part.slice(0, eq).trim() : part;
    const val = eq >= 0 ? part.slice(eq + 1).trim().replace(/^"|"$/g, '') : '';
    if (key === 'private') out.isPrivate = true;
    else if (key === 'no-store') out.noStore = true;
    else if (key === 'no-cache') out.noCache = true;
    else if (key === 'public') out.isPublic = true;
    else if (key === 'immutable') out.immutable = true;
    else if (key === 'max-age') {
      const n = Number(val);
      if (Number.isFinite(n) && n >= 0) maxAge = Math.floor(n);
    } else if (key === 's-maxage') {
      const n = Number(val);
      if (Number.isFinite(n) && n >= 0) sMaxAge = Math.floor(n);
    }
  }
  out.maxAge = sMaxAge !== null ? sMaxAge : maxAge;
  return out;
}

export type ResponseCheckResult =
  | {
      ok: true;
      contentType: string;
      originBucket: string;
      varyLang: string;
      immutable: boolean;
      softTtlSec: number;
      hardTtlSec: number;
      sanitizedHeaders: HeaderEntry[];
    }
  | {
      ok: false;
      reason: string;
    };

export function evaluateResponse(
  req: Extract<RequestCheckResult, { ok: true }>,
  res: {
    statusCode?: number;
    errorReason?: string;
    headers?: HeaderEntry[];
  },
  config: AssetCacheConfig,
  nowMs = Date.now(),
): ResponseCheckResult {
  if (res.errorReason) return { ok: false, reason: 'response-error' };
  if (res.statusCode !== 200) return { ok: false, reason: 'non-200' };

  const map = normalizeHeadersMap(res.headers);
  if (map.has('set-cookie')) return { ok: false, reason: 'set-cookie' };
  if (map.has('www-authenticate') || map.has('proxy-authenticate')) {
    return { ok: false, reason: 'auth-challenge' };
  }
  if (firstHeader(map, 'access-control-allow-credentials').trim().toLowerCase() === 'true') {
    return { ok: false, reason: 'cors-credentials' };
  }

  const contentLengthRaw = firstHeader(map, 'content-length').trim();
  if (contentLengthRaw) {
    const cl = Number(contentLengthRaw);
    if (Number.isFinite(cl)) {
      if (cl > config.maxEntryBytes) return { ok: false, reason: 'too-large' };
      // Note: compressed Content-Length can be < MIN_ENTRY_BYTES while uncompressed is larger;
      // only reject truly empty 0-byte responses here, full check runs on decoded body.
      if (cl <= 0) return { ok: false, reason: 'empty-body' };
    }
  }

  // Strict Content-Type check
  const rawCt = firstHeader(map, 'content-type').trim();
  const mediaType = rawCt.split(';')[0]?.trim().toLowerCase() || '';
  const allowedSet = ALLOWED_CONTENT_TYPES[req.resourceType];
  const fontOctetOk =
    req.resourceType === 'Font' &&
    mediaType === 'application/octet-stream' &&
    FONT_EXT_RE.test(req.urlObj.pathname);
  if (!allowedSet || (!allowedSet.has(mediaType) && !fontOctetOk)) {
    return { ok: false, reason: 'content-type' };
  }

  // Cache-Control & Expires
  const pragma = joinedHeader(map, 'pragma').toLowerCase();
  if (pragma.includes('no-cache')) return { ok: false, reason: 'pragma-no-cache' };
  const cc = parseCacheControl(joinedHeader(map, 'cache-control'));
  if (cc.isPrivate) return { ok: false, reason: 'cc-private' };
  if (cc.noStore) return { ok: false, reason: 'cc-no-store' };
  if (cc.noCache) return { ok: false, reason: 'cc-no-cache' };
  if (cc.maxAge === 0) return { ok: false, reason: 'cc-max-age-0' };

  let effectiveMaxAge = cc.maxAge;
  if (effectiveMaxAge === null) {
    const expiresRaw = firstHeader(map, 'expires').trim();
    if (expiresRaw) {
      const expMs = Date.parse(expiresRaw);
      if (Number.isFinite(expMs)) {
        const delta = Math.floor((expMs - nowMs) / 1000);
        if (delta <= 0) return { ok: false, reason: 'already-expired' };
        effectiveMaxAge = delta;
      }
    }
  }

  // Strict Vary check
  const varyRaw = joinedHeader(map, 'vary');
  const varyTokens = varyRaw
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  let variesOnLang = false;
  let variesOnOrigin = false;
  for (const tok of varyTokens) {
    if (!SAFE_VARY_TOKENS.has(tok)) {
      return { ok: false, reason: `unsafe-vary:${tok.slice(0, 24)}` };
    }
    if (tok === 'accept-language') variesOnLang = true;
    if (tok === 'origin') variesOnOrigin = true;
  }

  // Strong positive eligibility signal (prevents caching unversioned same-origin dynamic JS)
  const immutable = cc.immutable;
  const minTtl = 3600; // 1 hour minimum upstream max-age
  if (req.hasCookie) {
    // When browser attached cookies (e.g. same-site static bundle), require explicit
    // RFC shared-cache opt-in (immutable, or public + versioned/hashed URL + >= 1h TTL).
    const cookieEligible =
      (immutable && (effectiveMaxAge === null || effectiveMaxAge >= 300)) ||
      (cc.isPublic && req.versioned && effectiveMaxAge !== null && effectiveMaxAge >= minTtl);
    if (!cookieEligible) {
      return { ok: false, reason: 'cookie-not-public' };
    }
  } else {
    const eligible =
      (immutable && (effectiveMaxAge === null || effectiveMaxAge >= 300)) ||
      (req.versioned && effectiveMaxAge !== null && effectiveMaxAge >= minTtl) ||
      (cc.isPublic && effectiveMaxAge !== null && effectiveMaxAge >= minTtl) ||
      (req.crossHost && effectiveMaxAge !== null && effectiveMaxAge >= minTtl);

    if (!eligible) {
      return { ok: false, reason: 'not-eligible' };
    }
  }

  // CORS origin bucket
  const acao = firstHeader(map, 'access-control-allow-origin').trim();
  let originBucket = 'none';
  if (acao === '*' && !variesOnOrigin) {
    originBucket = '*';
  } else if (req.origin) {
    if (acao === req.origin || acao === '*') {
      originBucket = acao === '*' ? '*' : req.origin;
    } else {
      return { ok: false, reason: 'cors-mismatch' };
    }
  } else if (acao === '*') {
    originBucket = '*';
  }

  const varyLang = variesOnLang ? req.primaryLang : '';

  // Compute soft & hard TTLs
  const upstreamTtl = effectiveMaxAge ?? (immutable ? config.immutableTtlSec : config.defaultTtlSec);
  const capSoft = immutable || req.versioned ? config.immutableTtlSec : config.defaultTtlSec;
  const softTtlSec = Math.max(300, Math.min(capSoft, upstreamTtl));
  const hardMax = immutable || req.versioned ? 30 * 86400 : 14 * 86400;
  const hardTtlSec = Math.max(softTtlSec, Math.min(hardMax, softTtlSec * 2));

  // Sanitize headers (allowlist only, strip ETag / Set-Cookie / Content-Encoding / Trace IDs)
  const sanitizedHeaders: HeaderEntry[] = [];
  for (const [name, values] of map.entries()) {
    if (!SAFE_RESPONSE_HEADERS.has(name)) continue;
    for (const value of values) {
      if (name === 'vary') {
        const cleaned = value
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t && t.toLowerCase() !== 'accept-encoding')
          .join(', ');
        if (cleaned) sanitizedHeaders.push({ name: 'vary', value: cleaned });
      } else {
        sanitizedHeaders.push({ name, value });
      }
    }
  }

  return {
    ok: true,
    contentType: rawCt,
    originBucket,
    varyLang,
    immutable,
    softTtlSec,
    hardTtlSec,
    sanitizedHeaders,
  };
}

export function validateBody(buf: Buffer, resourceType: string, maxEntryBytes: number): string | null {
  if (buf.length < MIN_ENTRY_BYTES) return 'body-too-small';
  if (buf.length > maxEntryBytes) return 'too-large';

  // Reject HTML/XML error pages or captive portals disguised as 200 JS/CSS/Font/Image
  const head = buf.subarray(0, Math.min(buf.length, 256)).toString('utf8').trimStart().toLowerCase();
  if (
    head.startsWith('<!doctype') ||
    head.startsWith('<html') ||
    head.startsWith('<head') ||
    head.startsWith('<body') ||
    head.startsWith('<?xml')
  ) {
    return 'html-body-sniff';
  }
  if (resourceType === 'Script' && buf.length < 2048 && /^\{\s*"(error|errcode|code|message|status)"\s*:/.test(head)) {
    return 'json-error-sniff';
  }
  return null;
}

export function computeCacheKey(canonicalUrl: string, originBucket: string, varyLang: string): string {
  return crypto
    .createHash('sha256')
    .update(`${canonicalUrl}\0${originBucket}\0${varyLang}`)
    .digest('hex');
}

export function candidateCacheKeys(canonicalUrl: string, origin: string, primaryLang: string): string[] {
  const keys: string[] = [];
  const add = (ob: string, lang: string) => {
    const k = computeCacheKey(canonicalUrl, ob, lang);
    if (!keys.includes(k)) keys.push(k);
  };

  if (origin) {
    add('*', '');
    add(origin, '');
    if (primaryLang) {
      add('*', primaryLang);
      add(origin, primaryLang);
    }
  } else {
    add('*', '');
    add('none', '');
    if (primaryLang) {
      add('*', primaryLang);
      add('none', primaryLang);
    }
  }
  return keys;
}
