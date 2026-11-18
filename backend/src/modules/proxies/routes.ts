import { Router } from 'express';
import { AUDIT_ACTIONS, createProxySchema, proxyConfigSchema, updateProxySchema } from '@nya/shared';
import { asyncHandler, requireAdmin } from '../../http/util.js';
import { auditFromReq } from '../audit/service.js';
import {
  createProxyRecord,
  deleteProxyRecord,
  getProxy,
  getSession,
  listProxies,
  normalizeProxyConfig,
  sessionProxyChainIds,
  updateProxyRecord,
} from '../../store.js';
import { testProxy } from './tester.js';
import { applyProxy, listRunningIds, restartSessionsForProxyExitIp } from '../../runtime/sessionManager.js';
import { proxyTestPublicIpChanged } from '../../runtime/proxyLastTest.js';

export const proxiesRouter = Router();
proxiesRouter.use(requireAdmin);

function present(p: ReturnType<typeof getProxy>, withSecret = true) {
  if (!p) return null;
  return {
    ...p,
    password: withSecret ? p.password : p.password ? '***' : '',
  };
}

proxiesRouter.get(
  '/',
  asyncHandler((_req, res) => {
    res.json({ proxies: listProxies().map((p) => present(p)) });
  }),
);

proxiesRouter.post(
  '/',
  asyncHandler((req, res) => {
    const parsed = createProxySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid' });
    const proxy = createProxyRecord(parsed.data);
    auditFromReq(req, {
      action: AUDIT_ACTIONS.proxyCreate,
      resourceType: 'proxy',
      resourceId: proxy.id,
      success: true,
      detail: { name: proxy.name, type: proxy.type, host: proxy.host, port: proxy.port },
    });
    res.status(201).json({ proxy: present(proxy) });
  }),
);

proxiesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsed = updateProxySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid' });
    let proxy;
    try {
      proxy = updateProxyRecord(req.params.id, parsed.data);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
    if (!proxy) return res.status(404).json({ error: 'Not found' });
    // Running sessions whose traffic passes through this proxy, as exit or front, switch in place.
    for (const id of listRunningIds()) {
      const s = getSession(id);
      if (!s || !sessionProxyChainIds(s).includes(proxy.id)) continue;
      await applyProxy(s.id).catch((err) => {
        console.warn(`[proxy ${s.id}] apply after proxy ${proxy.id} update failed:`, err instanceof Error ? err.message : err);
      });
    }
    auditFromReq(req, {
      action: AUDIT_ACTIONS.proxyUpdate,
      resourceType: 'proxy',
      resourceId: proxy.id,
      success: true,
    });
    res.json({ proxy: present(proxy) });
  }),
);

proxiesRouter.delete(
  '/:id',
  asyncHandler((req, res) => {
    try {
      const ok = deleteProxyRecord(req.params.id);
      if (!ok) return res.status(404).json({ error: 'Not found' });
      auditFromReq(req, {
        action: AUDIT_ACTIONS.proxyDelete,
        resourceType: 'proxy',
        resourceId: req.params.id,
        success: true,
      });
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  }),
);

/** Probe an unsaved proxy (a form, or a session's own proxy before it is stored). */
proxiesRouter.post(
  '/probe',
  asyncHandler(async (req, res) => {
    const parsed = proxyConfigSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid' });
    let config;
    try {
      config = normalizeProxyConfig(parsed.data);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
    res.json({ result: await testProxy(config) });
  }),
);

proxiesRouter.post(
  '/:id/test',
  asyncHandler(async (req, res) => {
    const proxy = getProxy(req.params.id);
    if (!proxy) return res.status(404).json({ error: 'Not found' });
    const result = await testProxy(proxy);
    const previousTest = proxy.lastTest;
    updateProxyRecord(proxy.id, {
      lastTestAt: new Date().toISOString(),
      lastTest: result,
    });
    if (proxyTestPublicIpChanged(previousTest, result)) {
      await restartSessionsForProxyExitIp({ proxyId: proxy.id });
    }
    auditFromReq(req, {
      action: AUDIT_ACTIONS.proxyTest,
      resourceType: 'proxy',
      resourceId: proxy.id,
      success: result.ok,
      detail: {
        latencyMs: result.latencyMs,
        exitIp: result.exitIp,
        loc: result.loc,
        colo: result.colo,
        region: result.region,
        error: result.error,
      },
    });
    res.json({ result });
  }),
);
