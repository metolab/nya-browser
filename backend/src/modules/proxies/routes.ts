import { Router } from 'express';
import { AUDIT_ACTIONS, createProxySchema, updateProxySchema } from '@nya/shared';
import { asyncHandler, requireAdmin } from '../../http/util.js';
import { auditFromReq } from '../audit/service.js';
import {
  createProxyRecord,
  deleteProxyRecord,
  getProxy,
  listProxies,
  updateProxyRecord,
} from '../../store.js';
import { testProxy } from './tester.js';
import { applyProxy } from '../../runtime/sessionManager.js';
import { listSessions } from '../../store.js';

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
    const proxy = updateProxyRecord(req.params.id, parsed.data);
    if (!proxy) return res.status(404).json({ error: 'Not found' });
    for (const s of listSessions()) {
      if (s.proxyId === proxy.id) {
        await applyProxy(s.id, s.proxy).catch(() => undefined);
      }
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

proxiesRouter.post(
  '/:id/test',
  asyncHandler(async (req, res) => {
    const proxy = getProxy(req.params.id);
    if (!proxy) return res.status(404).json({ error: 'Not found' });
    const result = await testProxy(proxy);
    updateProxyRecord(proxy.id, {
      lastTestAt: new Date().toISOString(),
      lastTest: result,
    });
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
