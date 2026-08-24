const SAFE_BASE = /^\/[A-Za-z0-9/_-]*$/;

export function normalizeBasePath(raw?: string | null): string {
  if (raw == null) return '/';
  let p = String(raw).trim();
  if (!p || p === '/') return '/';
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, '');
  if (!p || p === '/') return '/';
  if (p.includes('..') || p.includes('//') || p.includes('\\') || !SAFE_BASE.test(p)) {
    return '/';
  }
  return p;
}

export function joinBasePath(base: string, path: string): string {
  const b = normalizeBasePath(base);
  if (!path) return b === '/' ? '/' : `${b}/`;
  if (/^https?:\/\//i.test(path) || path.startsWith('ws:') || path.startsWith('wss:')) {
    return path;
  }
  const p = path.startsWith('/') ? path : `/${path}`;
  if (b === '/') return p;
  return `${b}${p}`;
}

export function injectIndexHtml(html: string, basePath: string): string {
  const base = normalizeBasePath(basePath);
  const assetRoot = base === '/' ? '' : base;
  let out = html.replace(
    /(src|href)="(?:\.\/assets\/|\/assets\/)/g,
    `$1="${assetRoot}/assets/`,
  );
  const assignment = `window.__NYA_BASE_PATH__=${JSON.stringify(base)};`;
  if (/window\.__NYA_BASE_PATH__\s*=/.test(out)) {
    out = out.replace(/window\.__NYA_BASE_PATH__\s*=\s*[^;]*;/, assignment);
  } else {
    out = out.replace(/<head[^>]*>/i, (open) => `${open}\n    <script>${assignment}</script>`);
  }
  return out;
}
