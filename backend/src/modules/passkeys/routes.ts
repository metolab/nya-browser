import { Router, type Request } from 'express';
import {
  AUDIT_ACTIONS,
  importPasskeySchema,
  patchPasskeySchema,
  putWebAuthnSchema,
  webauthnOptionsProblem,
  type PasskeyEventKind,
  type PasskeyStatus,
} from '@nya/shared';
import { z } from 'zod';
import { asyncHandler } from '../../http/util.js';
import { HttpError, assertSessionAccess, handleHttpError } from '../../http/access.js';
import { auditFromReq } from '../audit/service.js';
import { getSession, mergeWebAuthn, updateSession } from '../../store.js';
import { applyWebAuthn, getRuntimePublic, restartBrowser } from '../../runtime/sessionManager.js';
import { webauthnPasskeyRemoved, webauthnPasskeyUpserted, webauthnStatus } from '../../runtime/webauthn.js';
import {
  appendPasskeyEvent,
  deletePasskey,
  getPasskey,
  latestPasskeyEventSeq,
  listPasskeyEvents,
  listPasskeys,
  replaceSiblings,
  updatePasskey,
  upsertPasskey,
  waitPasskeyEvent,
} from './store.js';

const STATUSES: PasskeyStatus[] = ['active', 'replaced', 'deleted_by_rp'];
const EVENT_KINDS: PasskeyEventKind[] = ['added', 'asserted', 'updated', 'deleted', 'replaced', 'imported', 'removed'];
const WAIT_MAX_SECONDS = 300;

export const passkeysRouter = Router({ mergeParams: true });

function sessionId(req: Request, opts: { manage?: boolean } = {}) {
  const id = String(req.params.id || '');
  assertSessionAccess(req, id, opts);
  return id;
}

function actorOf(req: Request) {
  return req.user?.username || 'api';
}

function csv<T extends string>(value: unknown, allowed: readonly T[], name: string): T[] | undefined {
  if (value == null || value === '' || value === 'all') return undefined;
  const items = String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const bad = items.find((v) => !allowed.includes(v as T));
  if (bad) throw new HttpError(400, `Invalid ${name}: ${bad}`);
  return items as T[];
}

function intParam(value: unknown, fallback: number) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'Invalid number');
  return Math.floor(n);
}

passkeysRouter.get(
  '/webauthn',
  asyncHandler((req, res) => {
    try {
      const id = sessionId(req);
      res.json({ webauthn: getSession(id)!.webauthn, runtime: webauthnStatus(id) });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

passkeysRouter.put(
  '/webauthn',
  asyncHandler(async (req, res) => {
    try {
      // Same bar as PATCH /sessions/:id: it changes the session's fingerprint surface.
      const id = sessionId(req, { manage: true });
      const parsed = putWebAuthnSchema.safeParse(req.body || {});
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid');
      const current = getSession(id)!.webauthn;
      const next = mergeWebAuthn(current, parsed.data);
      const problem = webauthnOptionsProblem(next.options);
      if (problem) throw new HttpError(400, problem);
      const session = updateSession(id, { webauthn: next })!;
      let restarted = false;
      if (current.provider !== session.webauthn.provider && getRuntimePublic(id)) {
        await restartBrowser(id);
        restarted = true;
      } else {
        await applyWebAuthn(id);
      }
      auditFromReq(req, {
        action: AUDIT_ACTIONS.webauthnUpdate,
        resourceType: 'session',
        resourceId: id,
        success: true,
        detail: { enabled: session.webauthn.enabled, provider: session.webauthn.provider },
      });
      res.json({ webauthn: session.webauthn, runtime: webauthnStatus(id), restarted });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

passkeysRouter.get(
  '/passkeys',
  asyncHandler((req, res) => {
    try {
      const id = sessionId(req);
      const status = csv(req.query.status, STATUSES, 'status');
      const rpId = typeof req.query.rpId === 'string' && req.query.rpId ? req.query.rpId : undefined;
      res.json({ passkeys: listPasskeys(id, { rpId, status }), cursor: latestPasskeyEventSeq(id) });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

passkeysRouter.get(
  '/passkeys/cursor',
  asyncHandler((req, res) => {
    try {
      res.json({ cursor: latestPasskeyEventSeq(sessionId(req)) });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

passkeysRouter.get(
  '/passkeys/events',
  asyncHandler((req, res) => {
    try {
      const id = sessionId(req);
      const after = intParam(req.query.after, 0);
      const limit = Math.min(intParam(req.query.limit, 200), 1000);
      const events = listPasskeyEvents(id, after, limit);
      res.json({ events, cursor: events.length ? events[events.length - 1].seq : after });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

/** Long-poll for the first event after `after` (already stored ones count). */
passkeysRouter.get(
  '/passkeys/wait',
  asyncHandler(async (req, res) => {
    try {
      const id = sessionId(req);
      const kinds = csv(req.query.kind, EVENT_KINDS, 'kind');
      const rpId = typeof req.query.rpId === 'string' && req.query.rpId ? req.query.rpId : undefined;
      const after = req.query.after != null && req.query.after !== '' ? intParam(req.query.after, 0) : latestPasskeyEventSeq(id);
      const timeout = Math.min(intParam(req.query.timeout, 60), WAIT_MAX_SECONDS);
      const abort = new AbortController();
      res.on('close', () => abort.abort());
      const event = await waitPasskeyEvent(id, { kinds, rpId, after }, timeout * 1000, abort.signal);
      if (res.writableEnded || res.destroyed) return;
      const passkey = event?.passkeyId ? getPasskey(id, event.passkeyId) : null;
      res.json({ event, passkey, timedOut: !event, cursor: event ? event.seq : latestPasskeyEventSeq(id) });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

passkeysRouter.get(
  '/passkeys/:pid',
  asyncHandler((req, res) => {
    try {
      const passkey = getPasskey(sessionId(req), req.params.pid);
      if (!passkey) throw new HttpError(404, 'Not found');
      res.json({ passkey });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

const importBodySchema = z.union([
  importPasskeySchema,
  z.array(importPasskeySchema).min(1).max(500),
  z.object({ passkeys: z.array(importPasskeySchema).min(1).max(500) }),
]);

passkeysRouter.post(
  '/passkeys',
  asyncHandler(async (req, res) => {
    try {
      const id = sessionId(req);
      const parsed = importBodySchema.safeParse(req.body);
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid');
      const items = Array.isArray(parsed.data) ? parsed.data : 'passkeys' in parsed.data ? parsed.data.passkeys : [parsed.data];
      const passkeys = [];
      for (const item of items) {
        let result;
        try {
          result = upsertPasskey(id, { ...item, status: 'active' });
        } catch (err) {
          throw new HttpError(400, err instanceof Error ? err.message : String(err));
        }
        const actor = actorOf(req);
        appendPasskeyEvent({ sessionId: id, kind: 'imported', passkey: result.passkey, actor });
        // An authenticator keeps one resident credential per account; older ones would shadow it.
        for (const old of replaceSiblings(id, result.passkey)) {
          appendPasskeyEvent({ sessionId: id, kind: 'replaced', passkey: old, actor });
          await webauthnPasskeyUpserted(id, old);
        }
        await webauthnPasskeyUpserted(id, result.passkey);
        passkeys.push(result.passkey);
      }
      auditFromReq(req, {
        action: AUDIT_ACTIONS.passkeyImport,
        resourceType: 'session',
        resourceId: id,
        success: true,
        detail: { count: passkeys.length, rpIds: [...new Set(passkeys.map((p) => p.rpId))] },
      });
      if (Array.isArray(parsed.data) || 'passkeys' in parsed.data) res.status(201).json({ passkeys });
      else res.status(201).json({ passkey: passkeys[0] });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

passkeysRouter.patch(
  '/passkeys/:pid',
  asyncHandler(async (req, res) => {
    try {
      const id = sessionId(req);
      const parsed = patchPasskeySchema.safeParse(req.body || {});
      if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid');
      const before = getPasskey(id, req.params.pid);
      if (!before) throw new HttpError(404, 'Not found');
      const passkey = updatePasskey(id, before.id, parsed.data)!;
      if (parsed.data.signCount !== undefined && parsed.data.signCount !== before.signCount) {
        await webauthnPasskeyUpserted(id, passkey);
      }
      auditFromReq(req, {
        action: AUDIT_ACTIONS.passkeyUpdate,
        resourceType: 'passkey',
        resourceId: `${id}/${passkey.id}`,
        success: true,
        detail: parsed.data,
      });
      res.json({ passkey });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);

passkeysRouter.delete(
  '/passkeys/:pid',
  asyncHandler(async (req, res) => {
    try {
      const id = sessionId(req);
      const passkey = deletePasskey(id, req.params.pid);
      if (!passkey) throw new HttpError(404, 'Not found');
      appendPasskeyEvent({ sessionId: id, kind: 'removed', passkey, actor: actorOf(req) });
      await webauthnPasskeyRemoved(id, passkey.credentialId);
      auditFromReq(req, {
        action: AUDIT_ACTIONS.passkeyDelete,
        resourceType: 'passkey',
        resourceId: `${id}/${passkey.id}`,
        success: true,
        detail: { rpId: passkey.rpId, userName: passkey.userName },
      });
      res.json({ ok: true, passkey });
    } catch (err) {
      handleHttpError(err, res);
    }
  }),
);
