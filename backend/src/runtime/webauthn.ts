// Server-held WebAuthn virtual authenticators.
//
// Chrome keeps a virtual authenticator environment per tab (FrameTreeNode), and
// any DevTools session that detaches from the tab tears it down, even one that
// never touched WebAuthn. The database is therefore the source of truth: every
// credential is stored the moment a page creates it, and each tab's authenticator
// is rebuilt from the database whenever a probe finds it gone.
import { defaultWebAuthnConfig, type Passkey, type WebAuthnConfig } from '@nya/shared';
import { logger } from '../logger.js';
import { getSession } from '../store.js';
import {
  activePasskeys,
  appendPasskeyEvent,
  findPasskeyByCredential,
  passkeyFromCdp,
  passkeyToCdp,
  replaceSiblings,
  stdBase64,
  updatePasskey,
  upsertPasskey,
  type CdpCredential,
} from '../modules/passkeys/store.js';

export type WebAuthnCdp = {
  call: (
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
    timeoutMs?: number,
  ) => Promise<Record<string, unknown> | undefined>;
};

type Tab = {
  targetId: string;
  cdpSessionId: string;
  url: string;
  authenticatorId: string | null;
  arming: Promise<void> | null;
};

const PROBE_INTERVAL_MS = 5000;
const NUDGE_DELAY_MS = 300;
const ARM_TIMEOUT_MS = 5000;
/** A resident registration first deletes the user's previous credential; wait for the add. */
const DELETE_SETTLE_MS = 800;

const ENV_GONE_RE = /has not been enabled|Could not find a Virtual Authenticator|not attached to a frame/i;
const INTERNAL_TAKEN_RE = /only supports one internal authenticator/i;
const RESIDENT_UNSUPPORTED_RE = /does not support Resident Credentials/i;

function originOf(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : '';
  } catch {
    return '';
  }
}

function errMsg(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function cdpOptions(config: WebAuthnConfig) {
  const o = config.options;
  if (o.protocol === 'u2f') {
    return { protocol: 'u2f', transport: o.transport, automaticPresenceSimulation: o.automaticPresenceSimulation };
  }
  return { ...o };
}

class SessionWebAuthn {
  readonly tabs = new Map<string, Tab>();
  private readonly cdpToTarget = new Map<string, string>();
  /** Spare page sessions per target, promoted when the owning one detaches. */
  private readonly spare = new Map<string, Set<string>>();
  private readonly urls = new Map<string, string>();
  /** Deletions this server caused, keyed by `${cdpSessionId}:${credentialId}`. */
  private readonly ownDeletes = new Set<string>();
  /** Credentials removed through the API; never re-imported from a lagging tab. */
  private readonly tombstones = new Set<string>();
  private readonly pendingDeletes = new Map<string, ReturnType<typeof setTimeout>>();
  /** Bumped on every stored change, so a tab armed meanwhile knows to reconcile. */
  private version = 0;
  private queue: Promise<void> = Promise.resolve();
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  config: WebAuthnConfig;
  closed = false;

  constructor(
    readonly sessionId: string,
    readonly cdp: WebAuthnCdp,
  ) {
    this.config = getSession(sessionId)?.webauthn || defaultWebAuthnConfig();
    this.syncProbe();
  }

  get enabled() {
    return this.config.enabled && !this.closed;
  }

  private enqueue(task: () => Promise<void> | void) {
    this.queue = this.queue.then(task).catch((err) => {
      logger.warn({ err: errMsg(err), sessionId: this.sessionId }, 'webauthn task failed');
    });
    return this.queue;
  }

  private syncProbe() {
    if (this.enabled && !this.probeTimer) {
      this.probeTimer = setInterval(() => void this.probeAll(), PROBE_INTERVAL_MS);
    } else if (!this.enabled && this.probeTimer) {
      clearInterval(this.probeTimer);
      this.probeTimer = null;
    }
  }

  close() {
    this.closed = true;
    this.syncProbe();
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
    for (const timer of this.pendingDeletes.values()) clearTimeout(timer);
    this.pendingDeletes.clear();
    this.tabs.clear();
    this.cdpToTarget.clear();
    this.spare.clear();
  }

  // ---- target tracking -------------------------------------------------

  /** Called for every attached page target; resolves once the tab is armed (or arming gave up). */
  async pageAttached(targetId: string, cdpSessionId: string, url: string) {
    this.urls.set(targetId, url);
    const existing = this.tabs.get(targetId);
    if (existing && existing.cdpSessionId !== cdpSessionId) {
      let set = this.spare.get(targetId);
      if (!set) this.spare.set(targetId, (set = new Set()));
      set.add(cdpSessionId);
      this.cdpToTarget.set(cdpSessionId, targetId);
      return;
    }
    const tab: Tab = existing || { targetId, cdpSessionId, url, authenticatorId: null, arming: null };
    this.tabs.set(targetId, tab);
    this.cdpToTarget.set(cdpSessionId, targetId);
    if (!this.enabled) return;
    await this.withTimeout(this.arm(tab), ARM_TIMEOUT_MS);
  }

  detached(cdpSessionId: string) {
    const targetId = this.cdpToTarget.get(cdpSessionId);
    if (!targetId) return;
    this.cdpToTarget.delete(cdpSessionId);
    const spare = this.spare.get(targetId);
    spare?.delete(cdpSessionId);
    const tab = this.tabs.get(targetId);
    if (!tab || tab.cdpSessionId !== cdpSessionId) return;
    const next = spare && [...spare][0];
    if (next) {
      spare!.delete(next);
      tab.cdpSessionId = next;
      tab.authenticatorId = null;
      if (this.enabled) void this.arm(tab);
      return;
    }
    this.tabs.delete(targetId);
    this.spare.delete(targetId);
    this.urls.delete(targetId);
  }

  urlChanged(targetId: string, url: string) {
    this.urls.set(targetId, url);
    const tab = this.tabs.get(targetId);
    if (tab) tab.url = url;
  }

  private async withTimeout(p: Promise<void>, ms: number) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    await Promise.race([p.catch(() => undefined), new Promise<void>((r) => (timer = setTimeout(r, ms)))]);
    if (timer) clearTimeout(timer);
  }

  // ---- arming ----------------------------------------------------------

  arm(tab: Tab): Promise<void> {
    if (tab.arming) return tab.arming;
    tab.arming = this.doArm(tab)
      .catch((err) => {
        tab.authenticatorId = null;
        const gone = !this.tabs.has(tab.targetId) || /Session with given id not found/i.test(errMsg(err));
        logger[gone ? 'debug' : 'warn']({ err: errMsg(err), sessionId: this.sessionId, url: tab.url }, 'webauthn arm failed');
      })
      .finally(() => {
        tab.arming = null;
      });
    return tab.arming;
  }

  private async addAuthenticator(sid: string) {
    const options = cdpOptions(this.config);
    const r = await this.cdp.call('WebAuthn.addVirtualAuthenticator', { options }, sid);
    return String(r?.authenticatorId || '');
  }

  private async doArm(tab: Tab) {
    const sid = tab.cdpSessionId;
    if (tab.authenticatorId) {
      await this.cdp.call('WebAuthn.removeVirtualAuthenticator', { authenticatorId: tab.authenticatorId }, sid).catch(() => undefined);
      tab.authenticatorId = null;
    }
    await this.cdp.call('WebAuthn.enable', { enableUI: false }, sid);
    let authenticatorId: string;
    try {
      authenticatorId = await this.addAuthenticator(sid);
    } catch (err) {
      if (!INTERNAL_TAKEN_RE.test(errMsg(err))) throw err;
      // Another client's internal authenticator holds the tab; start the environment over.
      await this.cdp.call('WebAuthn.disable', {}, sid).catch(() => undefined);
      await this.cdp.call('WebAuthn.enable', { enableUI: false }, sid);
      authenticatorId = await this.addAuthenticator(sid);
    }
    if (!authenticatorId) throw new Error('no authenticatorId');
    tab.authenticatorId = authenticatorId;
    const version = this.version;
    for (const passkey of activePasskeys(this.sessionId)) {
      await this.load(tab, passkey);
    }
    // Broadcasts skip tabs that are still arming; catch up on what changed during the load.
    if (this.version !== version) {
      const r = await this.cdp.call('WebAuthn.getCredentials', { authenticatorId }, sid, 3000);
      await this.reconcile(tab, (r?.credentials as CdpCredential[]) || []);
    }
  }

  private async disarm(tab: Tab) {
    const sid = tab.cdpSessionId;
    if (tab.authenticatorId) {
      await this.cdp.call('WebAuthn.removeVirtualAuthenticator', { authenticatorId: tab.authenticatorId }, sid).catch(() => undefined);
    }
    tab.authenticatorId = null;
    await this.cdp.call('WebAuthn.disable', {}, sid).catch(() => undefined);
  }

  private async load(tab: Tab, passkey: Passkey) {
    if (!tab.authenticatorId) return;
    const credential = passkeyToCdp(passkey);
    try {
      await this.cdp.call('WebAuthn.addCredential', { authenticatorId: tab.authenticatorId, credential }, tab.cdpSessionId);
    } catch (err) {
      if (!credential.isResidentCredential || !RESIDENT_UNSUPPORTED_RE.test(errMsg(err))) {
        logger.warn({ err: errMsg(err), sessionId: this.sessionId, rpId: passkey.rpId }, 'webauthn addCredential failed');
        return;
      }
      const { largeBlob: _blob, ...rest } = credential;
      await this.cdp
        .call('WebAuthn.addCredential', { authenticatorId: tab.authenticatorId, credential: { ...rest, isResidentCredential: false } }, tab.cdpSessionId)
        .catch(() => undefined);
    }
  }

  private async unload(tab: Tab, credentialId: string) {
    if (!tab.authenticatorId) return;
    const key = `${tab.cdpSessionId}:${credentialId}`;
    this.ownDeletes.add(key);
    try {
      await this.cdp.call('WebAuthn.removeCredential', { authenticatorId: tab.authenticatorId, credentialId }, tab.cdpSessionId);
    } catch {
      this.ownDeletes.delete(key);
    }
  }

  private async reload(tab: Tab, passkey: Passkey) {
    await this.unload(tab, passkey.credentialId);
    await this.load(tab, passkey);
  }

  /** Bring a tab's copy to the stored counter; older Chrome lacks `signCount` here, so fall back to a reload. */
  private async syncCount(tab: Tab, passkey: Passkey) {
    if (!tab.authenticatorId) return;
    try {
      await this.cdp.call(
        'WebAuthn.setCredentialProperties',
        { authenticatorId: tab.authenticatorId, credentialId: passkey.credentialId, signCount: passkey.signCount },
        tab.cdpSessionId,
      );
    } catch {
      await this.reload(tab, passkey);
    }
  }

  private others(source: Tab | null) {
    return [...this.tabs.values()].filter((t) => t !== source && t.authenticatorId && !t.arming);
  }

  // ---- browser events --------------------------------------------------

  event(cdpSessionId: string, method: string, params: Record<string, unknown>) {
    const targetId = this.cdpToTarget.get(cdpSessionId);
    const tab = targetId ? this.tabs.get(targetId) : undefined;
    if (!tab || tab.cdpSessionId !== cdpSessionId) return;
    if (params.authenticatorId && params.authenticatorId !== tab.authenticatorId) return;
    const credential = params.credential as CdpCredential | undefined;
    switch (method) {
      case 'WebAuthn.credentialAdded':
        if (credential) void this.enqueue(() => this.onAdded(tab, credential));
        return;
      case 'WebAuthn.credentialAsserted':
        if (credential) void this.enqueue(() => this.onAsserted(tab, credential));
        return;
      case 'WebAuthn.credentialUpdated':
        if (credential) void this.enqueue(() => this.onUpdated(tab, credential));
        return;
      case 'WebAuthn.credentialDeleted': {
        const credentialId = stdBase64(String(params.credentialId || ''));
        const key = `${cdpSessionId}:${credentialId}`;
        if (this.ownDeletes.delete(key)) return;
        void this.enqueue(() => this.onDeleted(tab, credentialId));
        return;
      }
      default:
    }
  }

  private async onAdded(tab: Tab, cred: CdpCredential) {
    this.version++;
    const { passkey } = upsertPasskey(this.sessionId, { ...passkeyFromCdp(cred, originOf(tab.url)), status: 'active' });
    this.tombstones.delete(passkey.credentialId);
    const replaced = replaceSiblings(this.sessionId, passkey);
    appendPasskeyEvent({ sessionId: this.sessionId, kind: 'added', passkey, url: tab.url, actor: 'browser' });
    for (const old of replaced) {
      const timer = this.pendingDeletes.get(old.credentialId);
      if (timer) clearTimeout(timer);
      this.pendingDeletes.delete(old.credentialId);
      appendPasskeyEvent({ sessionId: this.sessionId, kind: 'replaced', passkey: old, url: tab.url, actor: 'browser' });
    }
    for (const other of this.others(tab)) {
      for (const old of replaced) await this.unload(other, old.credentialId);
      await this.load(other, passkey);
    }
  }

  private async onAsserted(tab: Tab, cred: CdpCredential) {
    this.version++;
    let passkey = findPasskeyByCredential(this.sessionId, cred.credentialId);
    if (!passkey) {
      passkey = upsertPasskey(this.sessionId, { ...passkeyFromCdp(cred, originOf(tab.url)), status: 'active' }).passkey;
      appendPasskeyEvent({ sessionId: this.sessionId, kind: 'added', passkey, url: tab.url, actor: 'browser' });
    }
    // An assertion may also write the credential's large blob.
    const largeBlob = cred.largeBlob ? stdBase64(cred.largeBlob) : passkey.largeBlob;
    const blobChanged = largeBlob !== passkey.largeBlob;
    passkey =
      updatePasskey(this.sessionId, passkey.id, {
        signCount: Math.max(passkey.signCount, cred.signCount),
        lastUsedAt: new Date().toISOString(),
        ...(blobChanged ? { largeBlob } : {}),
      }) || passkey;
    appendPasskeyEvent({ sessionId: this.sessionId, kind: 'asserted', passkey, url: tab.url, actor: 'browser' });
    for (const other of this.others(tab)) {
      if (blobChanged) await this.reload(other, passkey);
      else await this.syncCount(other, passkey);
    }
  }

  private async onUpdated(tab: Tab, cred: CdpCredential) {
    const current = findPasskeyByCredential(this.sessionId, cred.credentialId);
    if (!current) return this.onAdded(tab, cred);
    this.version++;
    const passkey =
      updatePasskey(this.sessionId, current.id, {
        userName: cred.userName ?? current.userName,
        userDisplayName: cred.userDisplayName ?? current.userDisplayName,
      }) || current;
    appendPasskeyEvent({ sessionId: this.sessionId, kind: 'updated', passkey, url: tab.url, actor: 'browser' });
    for (const other of this.others(tab)) await this.reload(other, passkey);
  }

  private onDeleted(tab: Tab, credentialId: string) {
    if (this.pendingDeletes.has(credentialId)) return;
    const url = tab.url;
    this.pendingDeletes.set(
      credentialId,
      setTimeout(() => {
        this.pendingDeletes.delete(credentialId);
        void this.enqueue(async () => {
          const current = findPasskeyByCredential(this.sessionId, credentialId);
          if (!current || current.status !== 'active') return;
          this.version++;
          const passkey = updatePasskey(this.sessionId, current.id, { status: 'deleted_by_rp' }) || current;
          appendPasskeyEvent({ sessionId: this.sessionId, kind: 'deleted', passkey, url, actor: 'browser' });
          for (const other of this.others(tab)) await this.unload(other, credentialId);
        });
      }, DELETE_SETTLE_MS),
    );
  }

  // ---- reconciliation --------------------------------------------------

  nudge() {
    if (!this.enabled) return;
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
    this.nudgeTimer = setTimeout(() => {
      this.nudgeTimer = null;
      void this.probeAll();
    }, NUDGE_DELAY_MS);
  }

  private probing = false;

  private async probeAll() {
    if (!this.enabled || this.probing) return;
    this.probing = true;
    try {
      await this.enqueue(async () => {
        for (const tab of [...this.tabs.values()]) {
          if (this.closed || !this.enabled) return;
          if (tab.arming) continue;
          await this.probe(tab);
        }
      });
    } finally {
      this.probing = false;
    }
  }

  private async probe(tab: Tab) {
    if (!tab.authenticatorId) {
      await this.arm(tab);
      return;
    }
    let creds: CdpCredential[];
    try {
      const r = await this.cdp.call('WebAuthn.getCredentials', { authenticatorId: tab.authenticatorId }, tab.cdpSessionId, 3000);
      creds = (r?.credentials as CdpCredential[]) || [];
    } catch (err) {
      if (ENV_GONE_RE.test(errMsg(err))) {
        logger.info({ sessionId: this.sessionId, url: tab.url }, 'webauthn environment lost; re-arming');
        tab.authenticatorId = null;
        await this.arm(tab);
      }
      return;
    }
    await this.reconcile(tab, creds);
  }

  /** Make one tab's credentials match the active passkeys, keeping ones the server never saw. */
  private async reconcile(tab: Tab, creds: CdpCredential[]) {
    const inTab = new Map(creds.map((c) => [stdBase64(c.credentialId), c]));
    const active = activePasskeys(this.sessionId);
    const activeIds = new Set(active.map((p) => p.credentialId));
    for (const [credentialId, cred] of inTab) {
      if (activeIds.has(credentialId) || this.pendingDeletes.has(credentialId)) continue;
      const stored = findPasskeyByCredential(this.sessionId, credentialId);
      if (stored || this.tombstones.has(credentialId)) {
        await this.unload(tab, credentialId);
        continue;
      }
      // Created while this server missed the event: keep it.
      this.version++;
      const { passkey } = upsertPasskey(this.sessionId, { ...passkeyFromCdp(cred, originOf(tab.url)), status: 'active' });
      appendPasskeyEvent({ sessionId: this.sessionId, kind: 'added', passkey, url: tab.url, actor: 'browser' });
      for (const other of this.others(tab)) await this.load(other, passkey);
    }
    for (const passkey of active) {
      if (this.pendingDeletes.has(passkey.credentialId)) continue;
      const cred = inTab.get(passkey.credentialId);
      if (!cred) {
        await this.load(tab, passkey);
      } else if (cred.signCount > passkey.signCount) {
        updatePasskey(this.sessionId, passkey.id, { signCount: cred.signCount });
      } else if (cred.signCount < passkey.signCount) {
        await this.syncCount(tab, passkey);
      }
    }
  }

  // ---- API-driven changes ----------------------------------------------

  async applyConfig(config: WebAuthnConfig) {
    const was = this.config;
    this.config = config;
    this.syncProbe();
    const optionsChanged = JSON.stringify(was.options) !== JSON.stringify(config.options);
    await this.enqueue(async () => {
      for (const tab of this.tabs.values()) {
        if (!config.enabled) await this.disarm(tab);
        else if (!was.enabled || optionsChanged || !tab.authenticatorId) await this.arm(tab);
      }
    });
  }

  upserted(passkey: Passkey) {
    this.version++;
    this.tombstones.delete(passkey.credentialId);
    return this.enqueue(async () => {
      for (const tab of this.others(null)) {
        if (passkey.status === 'active') await this.reload(tab, passkey);
        else await this.unload(tab, passkey.credentialId);
      }
    });
  }

  removed(credentialId: string) {
    this.version++;
    this.tombstones.add(credentialId);
    return this.enqueue(async () => {
      for (const tab of this.others(null)) await this.unload(tab, credentialId);
    });
  }
}

const registry = new Map<string, SessionWebAuthn>();

export function webauthnAttachBrowser(sessionId: string, cdp: WebAuthnCdp) {
  registry.get(sessionId)?.close();
  const state = new SessionWebAuthn(sessionId, cdp);
  registry.set(sessionId, state);
  return state;
}

export function webauthnDetachBrowser(sessionId: string, state?: SessionWebAuthn) {
  const current = registry.get(sessionId);
  if (!current || (state && current !== state)) return;
  current.close();
  registry.delete(sessionId);
}

export function webauthnWantsPause(sessionId: string) {
  return Boolean(getSession(sessionId)?.webauthn.enabled);
}

/** Session config changed (enable, disable, options). */
export async function applyWebAuthnConfig(sessionId: string) {
  const state = registry.get(sessionId);
  const config = getSession(sessionId)?.webauthn;
  if (!state || !config) return;
  await state.applyConfig(config);
}

export function webauthnPasskeyUpserted(sessionId: string, passkey: Passkey) {
  return registry.get(sessionId)?.upserted(passkey);
}

export function webauthnPasskeyRemoved(sessionId: string, credentialId: string) {
  return registry.get(sessionId)?.removed(credentialId);
}

/** A CDP client detached somewhere in this session; check the tabs soon. */
export function nudgeWebAuthn(sessionId: string) {
  registry.get(sessionId)?.nudge();
}

export function webauthnStatus(sessionId: string) {
  const state = registry.get(sessionId);
  if (!state) return { attached: false, tabs: 0, armedTabs: 0 };
  const tabs = [...state.tabs.values()];
  return { attached: true, tabs: tabs.length, armedTabs: tabs.filter((t) => t.authenticatorId).length };
}

export type { SessionWebAuthn };
