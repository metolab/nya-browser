import { expect, test, type APIRequestContext } from '@playwright/test';
import { asAdmin, asUser, loginApi } from '../helpers';

type SessionRow = { id: string; groupId?: string | null; grants?: unknown; maxWindows?: unknown; proxy?: { password?: string } };

async function createUser(admin: APIRequestContext, stamp: string, suffix: string) {
  const res = await admin.post('/api/users', {
    data: { username: `g${suffix}${stamp}`, password: 'pass1234', role: 'user' },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).user as { id: string; username: string };
}

async function createSession(
  admin: APIRequestContext,
  name: string,
  extra: Record<string, unknown> = {},
) {
  const res = await admin.post('/api/sessions', { data: { name, ...extra } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).session as { id: string; groupId: string | null; proxy: { password?: string } };
}

async function createGroup(admin: APIRequestContext, name: string, parentId?: string) {
  const res = await admin.post('/api/groups', {
    data: parentId ? { name, parentId } : { name },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).group as { id: string };
}

async function sessionIds(ctx: APIRequestContext) {
  const res = await ctx.get('/api/sessions');
  expect(res.ok(), await res.text()).toBeTruthy();
  const sessions = (await res.json()).sessions as SessionRow[];
  return { sessions, ids: new Set(sessions.map((s) => s.id)) };
}

async function expectForbidden(res: { status(): number; text(): Promise<string> }, label: string) {
  expect(res.status(), `${label} ${await res.text()}`).toBe(403);
}

test.describe('permission system', () => {
  test('user is blocked from admin APIs and ungranted session actions', async () => {
    const admin = await asAdmin();
    const stamp = String(Date.now());
    const user = await createUser(admin, stamp, 'blk');
    const session = await createSession(admin, `blk${stamp}`);
    const member = await asUser(user.username, 'pass1234');
    try {
      const listed = await sessionIds(member);
      expect(listed.ids.has(session.id)).toBeFalsy();

      await expectForbidden(await member.post('/api/sessions', { data: { name: 'nope' } }), 'create session');
      await expectForbidden(await member.patch(`/api/sessions/${session.id}`, { data: { name: 'hack' } }), 'patch session');
      await expectForbidden(await member.delete(`/api/sessions/${session.id}`), 'delete session');
      await expectForbidden(await member.post(`/api/sessions/${session.id}/stop`), 'stop');
      await expectForbidden(await member.post(`/api/sessions/${session.id}/restart`), 'restart');
      await expectForbidden(
        await member.post(`/api/sessions/${session.id}/fingerprint/regenerate`),
        'fingerprint',
      );
      await expectForbidden(await member.put(`/api/sessions/${session.id}/proxy`, { data: { proxyId: null } }), 'proxy');
      await expectForbidden(await member.get(`/api/sessions/${session.id}/grants`), 'session grants get');
      await expectForbidden(
        await member.put(`/api/sessions/${session.id}/grants`, { data: { userIds: [user.id] } }),
        'session grants put',
      );
      await expectForbidden(await member.get('/api/users'), 'users');
      await expectForbidden(
        await member.post('/api/users', { data: { username: 'x', password: '1234', role: 'admin' } }),
        'create user',
      );
      await expectForbidden(await member.put(`/api/users/${user.id}/grants`, { data: { grants: [] } }), 'self grant');
      expect((await member.get('/api/groups')).ok()).toBeTruthy();
      await expectForbidden(await member.post('/api/groups', { data: { name: 'nope' } }), 'create group');
      await expectForbidden(await member.get('/api/proxies'), 'proxies');
      await expectForbidden(await member.get('/api/audit'), 'audit');
      await expectForbidden(await member.get('/api/monitor'), 'monitor');
      await expectForbidden(await member.get('/api/live'), 'live');
      await expectForbidden(await member.get(`/api/sessions/${session.id}/export`), 'export');

      await expectForbidden(await member.post(`/api/sessions/${session.id}/start`), 'start ungranted');
      await expectForbidden(await member.get(`/api/sessions/${session.id}/windows`), 'windows');
      await expectForbidden(await member.post(`/api/sessions/${session.id}/windows`, { data: {} }), 'create window');
      await expectForbidden(await member.get(`/api/sessions/${session.id}/files?path=.`), 'files');
      await expectForbidden(await member.post(`/api/sessions/${session.id}/files/mkdir`, { data: { path: 'x' } }), 'mkdir');
      await expectForbidden(await member.get(`/api/sessions/${session.id}/clipboard`), 'clipboard');
      await expectForbidden(
        await member.post(`/api/sessions/${session.id}/type`, { data: { text: '测' } }),
        'type',
      );
      await expectForbidden(
        await member.post(`/api/sessions/${session.id}/display`, { data: { width: 800, height: 600 } }),
        'display',
      );

      const missing = await member.post('/api/sessions/does-not-exist/start');
      expect(missing.status()).toBe(404);
    } finally {
      await admin.delete(`/api/sessions/${session.id}`).catch(() => undefined);
      await admin.delete(`/api/users/${user.id}`).catch(() => undefined);
      await member.dispose();
      await admin.dispose();
    }
  });

  test('direct session grant allows use and can be revoked', async () => {
    const admin = await asAdmin();
    const stamp = String(Date.now());
    const user = await createUser(admin, stamp, 'dir');
    const proxy = await admin.post('/api/proxies', {
      data: { name: `gp${stamp}`, type: 'http', host: '127.0.0.1', port: 9, username: 'u', password: 'secret' },
    });
    const proxyId = (await proxy.json()).proxy.id;
    const session = await createSession(admin, `dir${stamp}`, { proxyId });
    const other = await createSession(admin, `dirO${stamp}`);
    const member = await asUser(user.username, 'pass1234');
    try {
      await admin.put(`/api/sessions/${session.id}/grants`, { data: { userIds: [user.id, user.id] } });
      const grants = (await (await admin.get(`/api/sessions/${session.id}/grants`)).json()).grants;
      expect(grants).toHaveLength(1);
      expect(grants[0].kind).toBe('session');
      expect(grants[0].userId).toBe(user.id);

      const { sessions, ids } = await sessionIds(member);
      expect(ids.has(session.id)).toBeTruthy();
      expect(ids.has(other.id)).toBeFalsy();
      const mine = sessions.find((s) => s.id === session.id)!;
      expect(mine.grants).toBeUndefined();
      expect(mine.maxWindows).toBeUndefined();
      expect(mine.proxy?.password === '' || mine.proxy?.password === '***').toBeTruthy();

      const mkdir = await member.post(`/api/sessions/${session.id}/files/mkdir`, { data: { path: 'inbox' } });
      expect(mkdir.ok(), await mkdir.text()).toBeTruthy();
      const files = await member.get(`/api/sessions/${session.id}/files?path=.`);
      expect(files.ok()).toBeTruthy();
      expect((await files.json()).entries.some((e: { name: string }) => e.name === 'inbox')).toBeTruthy();
      await expectForbidden(await member.get(`/api/sessions/${other.id}/files?path=.`), 'other files');
      await expectForbidden(await member.post(`/api/sessions/${session.id}/stop`), 'granted user stop');

      await admin.put(`/api/sessions/${session.id}/grants`, { data: { userIds: [] } });
      const after = await sessionIds(member);
      expect(after.ids.has(session.id)).toBeFalsy();
      await expectForbidden(await member.get(`/api/sessions/${session.id}/files?path=.`), 'revoked files');
    } finally {
      await admin.delete(`/api/sessions/${session.id}`).catch(() => undefined);
      await admin.delete(`/api/sessions/${other.id}`).catch(() => undefined);
      await admin.delete(`/api/proxies/${proxyId}`).catch(() => undefined);
      await admin.delete(`/api/users/${user.id}`).catch(() => undefined);
      await member.dispose();
      await admin.dispose();
    }
  });

  test('folder grant covers subtree, later sessions, and is lost when moved out', async () => {
    const admin = await asAdmin();
    const stamp = String(Date.now());
    const user = await createUser(admin, stamp, 'fld');
    const root = await createGroup(admin, `客户${stamp}`);
    const child = await createGroup(admin, `日本${stamp}`, root.id);
    const grand = await createGroup(admin, `东京${stamp}`, child.id);
    const sibling = await createGroup(admin, `美国${stamp}`, root.id);

    const inGrand = await createSession(admin, `grand${stamp}`, { groupId: grand.id });
    const inChild = await createSession(admin, `child${stamp}`, { groupId: child.id });
    const inRoot = await createSession(admin, `root${stamp}`, { groupId: root.id });
    const inSibling = await createSession(admin, `sib${stamp}`, { groupId: sibling.id });
    const loose = await createSession(admin, `loose${stamp}`);

    const member = await asUser(user.username, 'pass1234');
    try {
      await admin.put(`/api/groups/${child.id}/grants`, { data: { userIds: [user.id] } });
      let ids = (await sessionIds(member)).ids;
      expect(ids.has(inGrand.id)).toBeTruthy();
      expect(ids.has(inChild.id)).toBeTruthy();
      expect(ids.has(inRoot.id)).toBeFalsy();
      expect(ids.has(inSibling.id)).toBeFalsy();
      expect(ids.has(loose.id)).toBeFalsy();
      await expectForbidden(await member.get(`/api/sessions/${inRoot.id}/files?path=.`), 'parent folder session');
      expect((await member.get(`/api/sessions/${inGrand.id}/files?path=.`)).ok()).toBeTruthy();

      const laterChild = await createSession(admin, `laterC${stamp}`, { groupId: child.id });
      const laterGrand = await createSession(admin, `laterG${stamp}`, { groupId: grand.id });
      ids = (await sessionIds(member)).ids;
      expect(ids.has(laterChild.id)).toBeTruthy();
      expect(ids.has(laterGrand.id)).toBeTruthy();

      await admin.patch(`/api/sessions/${inGrand.id}`, { data: { groupId: sibling.id } });
      ids = (await sessionIds(member)).ids;
      expect(ids.has(inGrand.id)).toBeFalsy();

      await admin.patch(`/api/sessions/${loose.id}`, { data: { groupId: child.id } });
      ids = (await sessionIds(member)).ids;
      expect(ids.has(loose.id)).toBeTruthy();

      await admin.put(`/api/groups/${root.id}/grants`, { data: { userIds: [user.id] } });
      ids = (await sessionIds(member)).ids;
      expect(ids.has(inRoot.id)).toBeTruthy();
      expect(ids.has(inSibling.id)).toBeTruthy();
      expect(ids.has(inGrand.id)).toBeTruthy();

      await admin.delete(`/api/groups/${child.id}`);
      ids = (await sessionIds(member)).ids;
      expect(ids.has(inChild.id)).toBeFalsy();
      expect(ids.has(laterChild.id)).toBeFalsy();
      expect((await admin.get(`/api/groups/${child.id}/grants`)).status()).toBe(404);

      await admin.delete(`/api/sessions/${laterChild.id}`).catch(() => undefined);
      await admin.delete(`/api/sessions/${laterGrand.id}`).catch(() => undefined);
    } finally {
      for (const id of [inGrand.id, inChild.id, inRoot.id, inSibling.id, loose.id]) {
        await admin.delete(`/api/sessions/${id}`).catch(() => undefined);
      }
      for (const id of [grand.id, sibling.id, child.id, root.id]) {
        await admin.delete(`/api/groups/${id}`).catch(() => undefined);
      }
      await admin.delete(`/api/users/${user.id}`).catch(() => undefined);
      await member.dispose();
      await admin.dispose();
    }
  });

  test('user grants replace all kinds; session grants do not wipe folder grants', async () => {
    const admin = await asAdmin();
    const stamp = String(Date.now());
    const user = await createUser(admin, stamp, 'rep');
    const folder = await createGroup(admin, `repF${stamp}`);
    const inFolder = await createSession(admin, `repIn${stamp}`, { groupId: folder.id });
    const extra = await createSession(admin, `repEx${stamp}`);
    const member = await asUser(user.username, 'pass1234');
    try {
      await admin.put(`/api/users/${user.id}/grants`, {
        data: {
          grants: [
            { kind: 'folder', targetId: folder.id },
            { kind: 'session', targetId: extra.id },
          ],
        },
      });
      let ids = (await sessionIds(member)).ids;
      expect(ids.has(inFolder.id)).toBeTruthy();
      expect(ids.has(extra.id)).toBeTruthy();

      await admin.put(`/api/sessions/${extra.id}/grants`, { data: { userIds: [] } });
      ids = (await sessionIds(member)).ids;
      expect(ids.has(extra.id)).toBeFalsy();
      expect(ids.has(inFolder.id)).toBeTruthy();

      await admin.put(`/api/sessions/${extra.id}/grants`, { data: { userIds: [user.id] } });
      const listed = (await (await admin.get('/api/users')).json()).users as {
        id: string;
        grants: { kind: string; targetId: string }[];
      }[];
      const row = listed.find((u) => u.id === user.id)!;
      expect(row.grants.some((g) => g.kind === 'folder' && g.targetId === folder.id)).toBeTruthy();
      expect(row.grants.some((g) => g.kind === 'session' && g.targetId === extra.id)).toBeTruthy();

      await admin.put(`/api/users/${user.id}/grants`, {
        data: { grants: [{ kind: 'session', targetId: extra.id }] },
      });
      ids = (await sessionIds(member)).ids;
      expect(ids.has(extra.id)).toBeTruthy();
      expect(ids.has(inFolder.id)).toBeFalsy();
    } finally {
      await admin.delete(`/api/sessions/${inFolder.id}`).catch(() => undefined);
      await admin.delete(`/api/sessions/${extra.id}`).catch(() => undefined);
      await admin.delete(`/api/groups/${folder.id}`).catch(() => undefined);
      await admin.delete(`/api/users/${user.id}`).catch(() => undefined);
      await member.dispose();
      await admin.dispose();
    }
  });

  test('users cannot see or touch each other sessions', async () => {
    const admin = await asAdmin();
    const stamp = String(Date.now());
    const ua = await createUser(admin, stamp, 'ua');
    const ub = await createUser(admin, stamp, 'ub');
    const sa = await createSession(admin, `sa${stamp}`);
    const sb = await createSession(admin, `sb${stamp}`);
    await admin.put(`/api/sessions/${sa.id}/grants`, { data: { userIds: [ua.id] } });
    await admin.put(`/api/sessions/${sb.id}/grants`, { data: { userIds: [ub.id] } });
    const a = await asUser(ua.username, 'pass1234');
    const b = await asUser(ub.username, 'pass1234');
    try {
      const aIds = (await sessionIds(a)).ids;
      const bIds = (await sessionIds(b)).ids;
      expect(aIds.has(sa.id)).toBeTruthy();
      expect(aIds.has(sb.id)).toBeFalsy();
      expect(bIds.has(sb.id)).toBeTruthy();
      expect(bIds.has(sa.id)).toBeFalsy();
      await expectForbidden(await a.get(`/api/sessions/${sb.id}/files?path=.`), 'a files on b');
      await expectForbidden(await b.post(`/api/sessions/${sa.id}/start`), 'b start a');
      await expectForbidden(
        await a.put(`/api/users/${ub.id}/grants`, { data: { grants: [{ kind: 'session', targetId: sa.id }] } }),
        'a grant b',
      );
    } finally {
      await admin.delete(`/api/sessions/${sa.id}`).catch(() => undefined);
      await admin.delete(`/api/sessions/${sb.id}`).catch(() => undefined);
      await admin.delete(`/api/users/${ua.id}`).catch(() => undefined);
      await admin.delete(`/api/users/${ub.id}`).catch(() => undefined);
      await a.dispose();
      await b.dispose();
      await admin.dispose();
    }
  });

  test('direct session grant works even when session sits in an ungranted folder', async () => {
    const admin = await asAdmin();
    const stamp = String(Date.now());
    const user = await createUser(admin, stamp, 'mix');
    const folder = await createGroup(admin, `mix${stamp}`);
    const session = await createSession(admin, `mixS${stamp}`, { groupId: folder.id });
    const other = await createSession(admin, `mixO${stamp}`, { groupId: folder.id });
    const member = await asUser(user.username, 'pass1234');
    try {
      await admin.put(`/api/sessions/${session.id}/grants`, { data: { userIds: [user.id] } });
      const ids = (await sessionIds(member)).ids;
      expect(ids.has(session.id)).toBeTruthy();
      expect(ids.has(other.id)).toBeFalsy();
    } finally {
      await admin.delete(`/api/sessions/${session.id}`).catch(() => undefined);
      await admin.delete(`/api/sessions/${other.id}`).catch(() => undefined);
      await admin.delete(`/api/groups/${folder.id}`).catch(() => undefined);
      await admin.delete(`/api/users/${user.id}`).catch(() => undefined);
      await member.dispose();
      await admin.dispose();
    }
  });

  test('grant APIs reject unknown targets and invalid payloads', async () => {
    const admin = await asAdmin();
    const stamp = String(Date.now());
    const user = await createUser(admin, stamp, 'bad');
    const session = await createSession(admin, `bad${stamp}`);
    const folder = await createGroup(admin, `badF${stamp}`);
    try {
      expect(
        (await admin.put(`/api/sessions/${session.id}/grants`, { data: { userIds: ['missing-user'] } })).status(),
      ).toBe(400);
      expect(
        (await admin.put(`/api/groups/${folder.id}/grants`, { data: { userIds: ['missing-user'] } })).status(),
      ).toBe(400);
      expect((await admin.put('/api/sessions/missing/grants', { data: { userIds: [user.id] } })).status()).toBe(404);
      expect((await admin.put('/api/groups/missing/grants', { data: { userIds: [user.id] } })).status()).toBe(404);
      expect(
        (
          await admin.put(`/api/users/${user.id}/grants`, {
            data: { grants: [{ kind: 'session', targetId: 'missing' }] },
          })
        ).status(),
      ).toBe(400);
      expect(
        (
          await admin.put(`/api/users/${user.id}/grants`, {
            data: { grants: [{ kind: 'folder', targetId: 'missing' }] },
          })
        ).status(),
      ).toBe(400);
      expect(
        (
          await admin.put(`/api/users/${user.id}/grants`, {
            data: { grants: [{ kind: 'window', targetId: session.id }] },
          })
        ).status(),
      ).toBe(400);
      expect((await admin.put(`/api/sessions/${session.id}/grants`, { data: { assignments: [] } })).status()).toBe(400);
    } finally {
      await admin.delete(`/api/sessions/${session.id}`).catch(() => undefined);
      await admin.delete(`/api/groups/${folder.id}`).catch(() => undefined);
      await admin.delete(`/api/users/${user.id}`).catch(() => undefined);
      await admin.dispose();
    }
  });

  test('deleting a user or session drops grants', async () => {
    const admin = await asAdmin();
    const stamp = String(Date.now());
    const user = await createUser(admin, stamp, 'del');
    const session = await createSession(admin, `del${stamp}`);
    await admin.put(`/api/sessions/${session.id}/grants`, { data: { userIds: [user.id] } });
    await admin.delete(`/api/users/${user.id}`);
    const grants = (await (await admin.get(`/api/sessions/${session.id}/grants`)).json()).grants;
    expect(grants).toEqual([]);

    const user2 = await createUser(admin, stamp, 'del2');
    await admin.put(`/api/sessions/${session.id}/grants`, { data: { userIds: [user2.id] } });
    await admin.delete(`/api/sessions/${session.id}`);
    const users = (await (await admin.get('/api/users')).json()).users as {
      id: string;
      grants: unknown[];
    }[];
    expect(users.find((u) => u.id === user2.id)?.grants || []).toEqual([]);
    await admin.delete(`/api/users/${user2.id}`).catch(() => undefined);
    await admin.dispose();
  });

  test('disabled user cannot keep using a granted session', async () => {
    const admin = await asAdmin();
    const stamp = String(Date.now());
    const user = await createUser(admin, stamp, 'dis');
    const session = await createSession(admin, `dis${stamp}`);
    await admin.put(`/api/sessions/${session.id}/grants`, { data: { userIds: [user.id] } });
    const member = await asUser(user.username, 'pass1234');
    try {
      expect((await sessionIds(member)).ids.has(session.id)).toBeTruthy();
      await admin.patch(`/api/users/${user.id}`, { data: { disabled: true } });
      expect((await member.get('/api/sessions')).status()).toBe(401);
      const { res, ctx } = await loginApi(user.username, 'pass1234');
      expect(res.status()).toBe(401);
      await ctx.dispose();
    } finally {
      await admin.delete(`/api/sessions/${session.id}`).catch(() => undefined);
      await admin.delete(`/api/users/${user.id}`).catch(() => undefined);
      await member.dispose();
      await admin.dispose();
    }
  });

  test('admin can use sessions without grants and sees grant metadata', async () => {
    const admin = await asAdmin();
    const stamp = String(Date.now());
    const session = await createSession(admin, `adm${stamp}`);
    try {
      const { sessions } = await sessionIds(admin);
      const row = sessions.find((s) => s.id === session.id)!;
      expect(row.grants).toEqual([]);
      expect((await admin.get(`/api/sessions/${session.id}/files?path=.`)).ok()).toBeTruthy();
      expect((await admin.post(`/api/sessions/${session.id}/files/mkdir`, { data: { path: 'a' } })).ok()).toBeTruthy();
    } finally {
      await admin.delete(`/api/sessions/${session.id}`).catch(() => undefined);
      await admin.dispose();
    }
  });
});
