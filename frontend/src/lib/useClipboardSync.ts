import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClipboardKind } from '@nya/shared';
import { api } from '../api/client';
import {
  BINARY_HOLD_MS,
  EMPTY_SETTLE_MS,
  clipText,
  keepPendingOnSkip,
  normalizeClip,
  shouldApplyRemote,
  shouldPushLocalText,
  type GateState,
} from './clipboardGate';

async function readLocalClipboard() {
  if (!navigator.clipboard?.readText) throw new Error('unsupported');
  return clipText(await navigator.clipboard.readText());
}

async function writeLocalClipboard(text: string) {
  if (!navigator.clipboard?.writeText) return false;
  await navigator.clipboard.writeText(text);
  return true;
}

function sameSub(a?: string | null, b?: string | null) {
  return (a || null) === (b || null);
}

export function useClipboardSync(opts: {
  sessionId?: string;
  subId?: string | null;
  enabled: boolean;
}) {
  const { sessionId, subId = null, enabled } = opts;
  const [text, setText] = useState('');
  const [auto, setAuto] = useState(true);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [status, setStatus] = useState('未同步');

  const lastRef = useRef('');
  const lastLocalReadRef = useRef<string | null>(null);
  const textRef = useRef('');
  const autoRef = useRef(true);
  const permissionRef = useRef<'unknown' | 'granted' | 'denied'>('unknown');
  const localReadDisabledRef = useRef(false);
  const typingRef = useRef(false);
  const pushTimer = useRef(0);
  const unlockTimer = useRef(0);
  const sessionRef = useRef(sessionId);
  const subRef = useRef(subId);
  const remoteKindRef = useRef<ClipboardKind>('text');
  const binaryUntilRef = useRef(0);
  const emptySettleUntilRef = useRef(0);
  // cancelEpoch invalidates queued text pushes (session switch or binary write).
  const cancelEpochRef = useRef(0);
  // syncEpoch invalidates in-flight GET responses whenever any write or reset occurs.
  const syncEpochRef = useRef(0);
  const pendingLocalRef = useRef<string | null>(null);
  const pushChain = useRef(Promise.resolve());

  sessionRef.current = sessionId;
  subRef.current = subId;
  autoRef.current = auto;
  textRef.current = text;
  permissionRef.current = permission;

  const updatePermission = useCallback((next: 'unknown' | 'granted' | 'denied') => {
    permissionRef.current = next;
    setPermission(next);
  }, []);

  const gateState = (): GateState => ({
    lastText: lastRef.current,
    remoteKind: remoteKindRef.current,
    binaryUntil: binaryUntilRef.current,
    emptySettleUntil: emptySettleUntilRef.current,
  });

  const applyText = useCallback((next: string, markSynced = true) => {
    const value = clipText(next);
    textRef.current = value;
    setText(value);
    if (markSynced) lastRef.current = value;
  }, []);

  const onLockExpiredRef = useRef<() => Promise<void>>(async () => {});

  const scheduleUnlock = useCallback(() => {
    window.clearTimeout(unlockTimer.current);
    // Add a small slack so Date.now() >= binaryUntil when the timer fires.
    const wait = Math.max(0, binaryUntilRef.current - Date.now()) + 20;
    unlockTimer.current = window.setTimeout(() => {
      void onLockExpiredRef.current().catch(() => undefined);
    }, wait);
  }, []);

  const markRemoteKind = useCallback(
    (kind: ClipboardKind, sid?: string, sub?: string | null) => {
      if (sid && sid !== sessionRef.current) return;
      if (sub !== undefined && !sameSub(sub, subRef.current)) return;
      remoteKindRef.current = kind;
      if (kind === 'image' || kind === 'files') {
        binaryUntilRef.current = Date.now() + BINARY_HOLD_MS;
        cancelEpochRef.current += 1;
        syncEpochRef.current += 1;
        pendingLocalRef.current = null;
        setStatus(kind === 'image' ? '远程剪贴板：图片' : '远程剪贴板：文件');
        scheduleUnlock();
      }
    },
    [scheduleUnlock],
  );

  const pushRemote = useCallback(
    (value: string, mode: 'auto' | 'manual', opts?: { pendingFlush?: boolean }) => {
      const queuedSid = sessionRef.current;
      const queuedSub = subRef.current;
      const queuedCancelEpoch = cancelEpochRef.current;
      const run = async () => {
        if (!queuedSid) return;
        if (sessionRef.current !== queuedSid || !sameSub(subRef.current, queuedSub)) return;
        if (cancelEpochRef.current !== queuedCancelEpoch) return;
        const next = normalizeClip(value, lastRef.current);
        if (next == null) return;
        const state = gateState();
        const now = Date.now();
        const decision = shouldPushLocalText(state, next, mode, now, opts);
        if (decision === 'skip') {
          if (keepPendingOnSkip(state, next, now, opts)) pendingLocalRef.current = next;
          else if (pendingLocalRef.current === next) pendingLocalRef.current = null;
          return;
        }
        pendingLocalRef.current = next;
        syncEpochRef.current += 1;
        let data: { kind?: string; text?: string };
        try {
          data = await api.setClipboard(queuedSid, next, queuedSub);
        } catch (err) {
          if (pendingLocalRef.current === next) pendingLocalRef.current = null;
          throw err;
        }
        if (sessionRef.current !== queuedSid || !sameSub(subRef.current, queuedSub)) return;
        if (cancelEpochRef.current !== queuedCancelEpoch) {
          if (pendingLocalRef.current === next) pendingLocalRef.current = null;
          return;
        }
        if (pendingLocalRef.current !== next) return;
        if (data.kind && data.kind !== 'text') {
          const kind = (data.kind === 'files' ? 'files' : 'image') as ClipboardKind;
          remoteKindRef.current = kind;
          setStatus(kind === 'image' ? '远程剪贴板：图片' : '远程剪贴板：文件');
          if (mode === 'manual') {
            pendingLocalRef.current = null;
          } else if (binaryUntilRef.current <= Date.now()) {
            binaryUntilRef.current = Date.now() + BINARY_HOLD_MS;
            scheduleUnlock();
          }
          return;
        }
        lastRef.current = next;
        remoteKindRef.current = 'text';
        binaryUntilRef.current = 0;
        pendingLocalRef.current = null;
        emptySettleUntilRef.current = Date.now() + EMPTY_SETTLE_MS;
        applyText(next, true);
        try {
          if (await writeLocalClipboard(next)) {
            lastLocalReadRef.current = next;
          }
        } catch {
          /* local write optional after a successful remote text apply */
        }
        setStatus('已同步到远程');
      };
      const queued = pushChain.current.then(run, run);
      pushChain.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    [applyText, scheduleUnlock, updatePermission],
  );

  const ingestRemote = useCallback(
    async (
      remote: { kind?: string; text?: string },
      source: 'auto' | 'manual',
      epoch: number,
      sid: string,
      sub: string | null,
    ) => {
      if (sessionRef.current !== sid || !sameSub(subRef.current, sub)) return;
      const action = shouldApplyRemote(gateState(), remote, source);
      if (action === 'ignore-stale') return;
      if (action === 'apply-binary') {
        const kind = (remote.kind === 'files' ? 'files' : 'image') as ClipboardKind;
        remoteKindRef.current = kind;
        setStatus(kind === 'image' ? '远程剪贴板：图片' : '远程剪贴板：文件');
        return;
      }
      if (source === 'auto') {
        if (syncEpochRef.current !== epoch) return;
        if (pendingLocalRef.current) return;
      } else {
        pendingLocalRef.current = null;
      }
      const next = normalizeClip(remote.text, lastRef.current);
      if (next == null) {
        remoteKindRef.current = 'text';
        binaryUntilRef.current = 0;
        if (source === 'manual') setStatus('已读取远程');
        return;
      }
      const unchanged = next === lastRef.current;
      lastRef.current = next;
      remoteKindRef.current = 'text';
      binaryUntilRef.current = 0;
      if (unchanged && source === 'auto') return;
      if (!typingRef.current || source === 'manual') applyText(next, true);
      try {
        if (await writeLocalClipboard(next)) {
          lastLocalReadRef.current = next;
          setStatus('已同步到本地');
          return;
        }
      } catch {
        /* fall through to read-only status */
      }
      setStatus('已读取远程');
    },
    [applyText],
  );

  const flushRemote = useCallback(
    async (source: 'auto' | 'manual') => {
      const sid = sessionRef.current;
      const sub = subRef.current;
      const epoch = syncEpochRef.current;
      if (!sid) return;
      const data = await api.getClipboard(sid, sub);
      await ingestRemote(data, source, epoch, sid, sub || null);
    },
    [ingestRemote],
  );

  const flushLocal = useCallback(
    async (opts?: { forceRead?: boolean; ignoreLastLocal?: boolean }) => {
      if (!sessionRef.current) return;
      if (pendingLocalRef.current) {
        await pushRemote(pendingLocalRef.current, autoRef.current ? 'auto' : 'manual', {
          pendingFlush: true,
        });
        return;
      }
      if (!autoRef.current) return;
      if (localReadDisabledRef.current && !opts?.forceRead) return;
      try {
        const local = await readLocalClipboard();
        localReadDisabledRef.current = false;
        updatePermission('granted');
        // Ignore unchanged OS clipboard on polls/focus so failed local writeback never overwrites a manual remote write.
        if (!opts?.ignoreLastLocal && lastLocalReadRef.current === local) return;
        lastLocalReadRef.current = local;
        const next = normalizeClip(local, lastRef.current);
        if (next == null || next === lastRef.current) return;
        applyText(next, false);
        await pushRemote(next, 'auto');
      } catch {
        localReadDisabledRef.current = true;
        if (permissionRef.current === 'unknown') updatePermission('denied');
      }
    },
    [applyText, pushRemote, updatePermission],
  );

  const onLockExpired = useCallback(async () => {
    await flushRemote('auto');
    if (pendingLocalRef.current) {
      await pushRemote(pendingLocalRef.current, autoRef.current ? 'auto' : 'manual', {
        pendingFlush: true,
      });
      return;
    }
    if (autoRef.current) await flushLocal();
  }, [flushLocal, flushRemote, pushRemote]);
  onLockExpiredRef.current = onLockExpired;

  const pull = useCallback(async () => {
    if (!sessionRef.current) return;
    setBusy(true);
    try {
      await flushRemote('manual');
    } finally {
      setBusy(false);
    }
  }, [flushRemote]);

  const push = useCallback(async () => {
    if (!sessionRef.current) return;
    setBusy(true);
    try {
      await pushRemote(textRef.current, 'manual');
    } finally {
      setBusy(false);
    }
  }, [pushRemote]);

  const requestPermission = useCallback(async () => {
    try {
      const local = await readLocalClipboard();
      localReadDisabledRef.current = false;
      updatePermission('granted');
      lastLocalReadRef.current = local;
      if (autoRef.current) {
        const next = normalizeClip(local, lastRef.current);
        if (next == null) return;
        applyText(next, false);
        await pushRemote(next, 'auto');
      }
    } catch {
      localReadDisabledRef.current = true;
      updatePermission('denied');
    }
  }, [applyText, pushRemote, updatePermission]);

  const onTextChange = useCallback(
    (next: string) => {
      typingRef.current = true;
      applyText(next, false);
      window.clearTimeout(pushTimer.current);
      pushTimer.current = window.setTimeout(() => {
        typingRef.current = false;
        if (!autoRef.current) return;
        void pushRemote(next, 'auto').catch(() => undefined);
      }, 280);
    },
    [applyText, pushRemote],
  );

  useEffect(() => {
    lastRef.current = '';
    lastLocalReadRef.current = null;
    localReadDisabledRef.current = false;
    typingRef.current = false;
    remoteKindRef.current = 'text';
    binaryUntilRef.current = 0;
    emptySettleUntilRef.current = 0;
    pendingLocalRef.current = null;
    cancelEpochRef.current += 1;
    syncEpochRef.current += 1;
    window.clearTimeout(pushTimer.current);
    window.clearTimeout(unlockTimer.current);
    applyText('', false);
    setStatus(enabled ? '等待同步' : '未同步');
    updatePermission('unknown');
  }, [applyText, enabled, sessionId, subId, updatePermission]);

  useEffect(() => {
    if (!enabled || !sessionId || !auto) return undefined;
    let cancelled = false;

    const tickRemote = async () => {
      if (cancelled || document.visibilityState !== 'visible' || typingRef.current) return;
      try {
        await flushRemote('auto');
      } catch {
        /* session may have stopped */
      }
    };

    const tickLocal = () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      void flushLocal().catch(() => undefined);
    };

    void tickRemote();
    void flushLocal({ forceRead: true }).catch(() => undefined);
    const remoteTimer = window.setInterval(() => void tickRemote(), 700);
    const localTimer = window.setInterval(tickLocal, 450);

    const onCopy = (event: ClipboardEvent) => {
      const copied = clipText(event.clipboardData?.getData('text/plain') || '');
      if (!copied) {
        window.setTimeout(
          () => void flushLocal({ forceRead: true, ignoreLastLocal: true }).catch(() => undefined),
          40,
        );
        return;
      }
      lastLocalReadRef.current = copied;
      const next = normalizeClip(copied, lastRef.current);
      if (next == null) return;
      applyText(next, false);
      void pushRemote(next, 'auto').catch(() => undefined);
    };
    const onFocus = () => {
      if (document.visibilityState !== 'visible') return;
      void flushLocal({ forceRead: true }).catch(() => undefined);
    };

    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCopy);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(remoteTimer);
      window.clearInterval(localTimer);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCopy);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [applyText, auto, enabled, flushLocal, flushRemote, pushRemote, sessionId, subId]);

  useEffect(
    () => () => {
      window.clearTimeout(pushTimer.current);
      window.clearTimeout(unlockTimer.current);
    },
    [],
  );

  const pushFromPaste = useCallback(
    async (value: string) => {
      const next = normalizeClip(value, lastRef.current);
      if (next == null) return;
      applyText(next, false);
      await pushRemote(next, 'manual');
    },
    [applyText, pushRemote],
  );

  return {
    text,
    auto,
    setAuto,
    busy,
    permission,
    status,
    flushLocal,
    flushRemote,
    pull,
    push,
    pushFromPaste,
    onTextChange,
    requestPermission,
    markRemoteKind,
  };
}
