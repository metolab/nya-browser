import type {
  AuditLog,
  FileEntry,
  LiveSession,
  MonitorSnapshot,
  ProxyConfig,
  ProxyRecord,
  ProxyTestResult,
  Session,
  AccessGrant,
  SessionGroup,
  SessionWindow,
  UserPublic,
} from '@nya/shared';

export type { FileEntry, ProxyConfig, Session, UserPublic };

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init?.headers || {}),
    },
  });
  if (res.status === 204) return {} as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      (data as { error?: string }).error || `HTTP ${res.status}`,
      res.status,
      (data as { code?: string }).code,
    );
  }
  return data as T;
}

export const api = {
  me: () => request<{ user: UserPublic }>('/api/me'),
  login: (username: string, password: string) =>
    request<{ ok: boolean; user: UserPublic }>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/logout', { method: 'POST' }),

  listSessions: () => request<{ sessions: Session[] }>('/api/sessions'),
  createSession: (payload: {
    name: string;
    description?: string;
    groupId?: string | null;
    proxyId?: string | null;
    timezone?: string;
    homeUrl?: string;
  }) =>
    request<{ session: Session }>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSession: (
    id: string,
    payload: Partial<{
      name: string;
      description: string;
      groupId: string | null;
      proxyId: string | null;
      timezone: string;
      homeUrl: string;
    }>,
  ) =>
    request<{ session: Session }>(`/api/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteSession: (id: string) =>
    request<{ ok: boolean }>(`/api/sessions/${id}`, { method: 'DELETE' }),
  listGroups: () => request<{ groups: SessionGroup[] }>('/api/groups'),
  createGroup: (payload: { name: string; parentId?: string | null }) =>
    request<{ group: SessionGroup }>('/api/groups', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateGroup: (id: string, payload: { name?: string; parentId?: string | null }) =>
    request<{ group: SessionGroup }>(`/api/groups/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteGroup: (id: string) => request<{ ok: boolean }>(`/api/groups/${id}`, { method: 'DELETE' }),
  getFolderGrants: (id: string) =>
    request<{ grants: AccessGrant[] }>(`/api/groups/${id}/grants`),
  setFolderGrants: (id: string, userIds: string[]) =>
    request<{ grants: AccessGrant[] }>(`/api/groups/${id}/grants`, {
      method: 'PUT',
      body: JSON.stringify({ userIds }),
    }),
  startSession: (id: string, url?: string) =>
    request<{ runtime: Session['runtime']; session: Session }>(`/api/sessions/${id}/start`, {
      method: 'POST',
      body: JSON.stringify(url ? { url } : {}),
    }),
  stopSession: (id: string) =>
    request<{ ok: boolean }>(`/api/sessions/${id}/stop`, { method: 'POST' }),
  restartSession: (id: string, url?: string) =>
    request<{ runtime: Session['runtime'] }>(`/api/sessions/${id}/restart`, {
      method: 'POST',
      body: JSON.stringify(url ? { url } : {}),
    }),
  regenerateFingerprint: (id: string) =>
    request<{ session: Session }>(`/api/sessions/${id}/fingerprint/regenerate`, {
      method: 'POST',
    }),
  setProxy: (id: string, proxyId: string | null) =>
    request<{ session: Session }>(`/api/sessions/${id}/proxy`, {
      method: 'PUT',
      body: JSON.stringify({ proxyId }),
    }),
  getSessionGrants: (id: string) =>
    request<{ grants: AccessGrant[] }>(`/api/sessions/${id}/grants`),
  setSessionGrants: (id: string, userIds: string[]) =>
    request<{ grants: AccessGrant[] }>(`/api/sessions/${id}/grants`, {
      method: 'PUT',
      body: JSON.stringify({ userIds }),
    }),
  createWindow: (id: string, payload?: { url?: string; takeover?: boolean }) =>
    request<{
      window: SessionWindow & { occupancyId?: string | null };
      takenOver?: boolean;
      runtime: Session['runtime'];
    }>(`/api/sessions/${id}/windows`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
  closeWindow: (id: string, windowId: string) =>
    request<{ ok: boolean }>(`/api/sessions/${id}/windows/${encodeURIComponent(windowId)}`, {
      method: 'DELETE',
    }),
  resizeDisplay: async (
    id: string,
    width: number,
    height: number,
    subId?: string | null,
  ): Promise<{ ok: true; geometry: { w: number; h: number } }> => {
    const path = subId
      ? `/api/sessions/${id}/subs/${encodeURIComponent(subId)}/display`
      : `/api/sessions/${id}/display`;
    const data = await request<{
      ok: boolean;
      geometry?: { w: number; h: number };
      error?: string;
    }>(path, {
      method: 'POST',
      body: JSON.stringify({ width, height }),
    });
    if (!data.ok || !data.geometry) {
      throw new Error(data.error || 'display resize failed');
    }
    return { ok: true, geometry: data.geometry };
  },
  getClipboard: (id: string, subId?: string | null) =>
    request<{ text: string }>(
      subId
        ? `/api/sessions/${id}/subs/${encodeURIComponent(subId)}/clipboard`
        : `/api/sessions/${id}/clipboard`,
    ),
  setClipboard: (id: string, text: string, subId?: string | null) =>
    request<{ ok: boolean }>(
      subId
        ? `/api/sessions/${id}/subs/${encodeURIComponent(subId)}/clipboard`
        : `/api/sessions/${id}/clipboard`,
      { method: 'PUT', body: JSON.stringify({ text }) },
    ),
  listSubs: (id: string) =>
    request<{ subs: { id: string; display: number; running: boolean }[] }>(`/api/sessions/${id}/subs`),
  createSub: (id: string, url?: string) =>
    request<{ sub: { id: string; display: number; running: boolean } }>(`/api/sessions/${id}/subs`, {
      method: 'POST',
      body: JSON.stringify(url ? { url } : {}),
    }),
  deleteSub: (id: string, subId: string) =>
    request<{ ok: boolean }>(`/api/sessions/${id}/subs/${encodeURIComponent(subId)}`, {
      method: 'DELETE',
    }),
  listFiles: (id: string, path = '.') =>
    request<{ path: string; entries: FileEntry[] }>(
      `/api/sessions/${id}/files?path=${encodeURIComponent(path)}`,
    ),
  mkdir: (id: string, path: string) =>
    request<{ ok: boolean }>(`/api/sessions/${id}/files/mkdir`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  removeFile: (id: string, path: string) =>
    request<{ ok: boolean }>(
      `/api/sessions/${id}/files?path=${encodeURIComponent(path)}`,
      { method: 'DELETE' },
    ),
  upload: async (id: string, dir: string, files: FileList | File[]) => {
    const form = new FormData();
    Array.from(files).forEach((f) => form.append('files', f));
    const res = await fetch(
      `/api/sessions/${id}/files/upload?dir=${encodeURIComponent(dir)}`,
      { method: 'POST', body: form, credentials: 'include' },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },
  downloadUrl: (id: string, path: string) =>
    `/api/sessions/${id}/files/download?path=${encodeURIComponent(path)}`,

  listUsers: () =>
    request<{ users: (UserPublic & { grants: AccessGrant[] })[] }>('/api/users'),
  createUser: (payload: { username: string; password: string; role: 'admin' | 'user' }) =>
    request<{ user: UserPublic }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateUser: (
    id: string,
    payload: Partial<{ password: string; role: 'admin' | 'user'; disabled: boolean }>,
  ) =>
    request<{ user: UserPublic }>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteUser: (id: string) => request<{ ok: boolean }>(`/api/users/${id}`, { method: 'DELETE' }),
  setUserGrants: (
    id: string,
    grants: { kind: 'session' | 'folder'; targetId: string }[],
  ) =>
    request<{ grants: AccessGrant[] }>(`/api/users/${id}/grants`, {
      method: 'PUT',
      body: JSON.stringify({ grants }),
    }),

  listProxies: () => request<{ proxies: ProxyRecord[] }>('/api/proxies'),
  createProxy: (payload: {
    name: string;
    type: 'http' | 'https' | 'socks5';
    host: string;
    port: number;
    username?: string;
    password?: string;
  }) =>
    request<{ proxy: ProxyRecord }>('/api/proxies', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateProxy: (id: string, payload: Record<string, unknown>) =>
    request<{ proxy: ProxyRecord }>(`/api/proxies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteProxy: (id: string) => request<{ ok: boolean }>(`/api/proxies/${id}`, { method: 'DELETE' }),
  testProxy: (id: string) => request<{ result: ProxyTestResult }>(`/api/proxies/${id}/test`, { method: 'POST' }),

  live: () => request<{ sessions: LiveSession[] }>('/api/live'),
  monitor: () => request<{ monitor: MonitorSnapshot }>('/api/monitor'),
  appLog: (tail = 200) => request<{ content: string }>(`/api/monitor/logs/app?tail=${tail}`),
  sessionLog: (id: string, file = 'chrome', tail = 200) =>
    request<{ content: string }>(
      `/api/monitor/sessions/${id}/logs?file=${encodeURIComponent(file)}&tail=${tail}`,
    ),
  audit: (query: Record<string, string> = {}) => {
    const q = new URLSearchParams(query).toString();
    return request<{ logs: AuditLog[] }>(`/api/audit${q ? `?${q}` : ''}`);
  },
  exportUrl: (id: string) => `/api/sessions/${id}/export`,
  importSession: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/sessions/import', {
      method: 'POST',
      body: form,
      credentials: 'include',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data as { session: Session; proxyMatched: boolean };
  },
};

export const emptyProxy = (): ProxyConfig => ({
  type: 'none',
  host: '',
  port: null,
  username: '',
  password: '',
});
