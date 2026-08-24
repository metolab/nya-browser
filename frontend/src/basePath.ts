import { joinBasePath, normalizeBasePath } from '@nya/shared';

export function getBasePath(): string {
  if (typeof window !== 'undefined' && typeof window.__NYA_BASE_PATH__ === 'string') {
    return normalizeBasePath(window.__NYA_BASE_PATH__);
  }
  return '/';
}

export function withBase(path: string): string {
  return joinBasePath(getBasePath(), path);
}
