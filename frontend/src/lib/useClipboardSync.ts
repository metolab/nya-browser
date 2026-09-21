import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClipboardKind } from '@nya/shared';
import { api } from '../api/client';
import {
  BINARY_HOLD_MS,
  EMPTY_SETTLE_MS,
  clipText,
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
  const textRef = useRef('');
  const autoRef = useRef(true);
  const typingRef = useRef(false);
  const pushTimer = useRef(0);
  const unlockTimer = useRef(0);
  const sessionRef = useRef(sessionId);
  const subRef = useRef(subId);
  const remoteKindRef = useRef<ClipboardKind>('text');
  const binaryUntilRef = useRef(0);
  const emptySettleUntilRef = useRef(0);
  const writeEpochRef = useRef(0);
  const pendingLocalRef = useRef<string | null>(null);
  const pushChain = useRef(Promise.resolve());

  sessionRef.current = sessionId;
  subRef.current = subId;
  autoRef.current = auto;
  textRef.current = text;

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
    const wait = Math.max(0, binaryUntilRef.current - Date.now());
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
        writeEpochRef.current += 1;
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
      const queuedEpoch = writeEpochRef.current;
      const run = async () => {
        if (!queuedSid) return;
        if (sessionRef.current !== queuedSid || !sameSub(subRef.current, queuedSub)) return;
        if (writeEpochRef.current !== queuedEpoch) return;
        const next = normalizeClip(value, lastRef.current);
        if (next == null) return;
        const decision = shouldPushLocalText(gateState(), next, mode, Date.now(), opts);
        if (decision === 'skip') {
          if (next && (Date.now() < binaryUntilRef.current || opts?.pendingFlush)) {
            pendingLocalRef.current = next;
          }
          return;
        }
        pendingLocalRef.current = next;
        const data = await api.setClipboard(queuedSid, next, queuedSub);
        if (sessionRef.current !== queuedSid || !sameSub(subRef.current, queuedSub)) return;
        if (writeEpochRef.current !== queuedEpoch) return;
        if (pendingLocalRef.current !== next) return;
        if (data.kind !== 'text') return;
        lastRef.current = next;
        remoteKindRef.current = 'text';
        binaryUntilRef.current = 0;
        pendingLocalRef.current = null;
        emptySettleUntilRef.current = Date.now() + EMPTY_SETTLE_MS;
        applyText(next, true);
        try {
          await writeLocalClipboard(next);
          setPermission('granted');
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
    [applyText],
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
      if (writeEpochRef.current !== epoch) return;
      if (pendingLocalRef.current) return;
      const next = normalizeClip(remote.text, lastRef.current);
      if (next == null || next === lastRef.current) {
        remoteKindRef.current = 'text';
        binaryUntilRef.current = 0;
        return;
      }
      lastRef.current = next;
      remoteKindRef.current = 'text';
      binaryUntilRef.current = 0;
      if (!typingRef.current) applyText(next, true);
      try {
        await writeLocalClipboard(next);
        setPermission('granted');
        setStatus('已同步到本地');
      } catch {
        setStatus('已读取远程');
      }
    },
    [applyText],
  );

  const flushRemote = useCallback(
    async (source: 'auto' | 'manual') => {
      const sid = sessionRef.current;
      const sub = subRef.current;
      const epoch = writeEpochRef.current;
      if (!sid) return;
      const data = await api.getClipboard(sid, sub);
      await ingestRemote(data, source, epoch, sid, sub || null);
    },
    [ingestRemote],
  );

  const flushLocal = useCallback(async () => {
    if (!sessionRef.current) return;
    if (pendingLocalRef.current) {
      await pushRemote(pendingLocalRef.current, autoRef.current ? 'auto' : 'manual', {
        pendingFlush: true,
      });
      return;
    }
    if (!autoRef.current) return;
    try {
      const local = await readLocalClipboard();
      setPermission('granted');
      const next = normalizeClip(local, lastRef.current);
      if (next == null) return;
      applyText(next, false);
      await pushRemote(next, 'auto');
    } catch {
      if (permission === 'unknown') setPermission('denied');
    }
  }, [applyText, permission, pushRemote]);

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
      setPermission('granted');
      if (autoRef.current) {
        const next = normalizeClip(local, lastRef.current);
        if (next == null) return;
        applyText(next, false);
        await pushRemote(next, 'auto');
      }
    } catch {
      setPermission('denied');
    }
  }, [applyText, pushRemote]);

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
    remoteKindRef.current = 'text';
    binaryUntilRef.current = 0;
    emptySettleUntilRef.current = 0;
    pendingLocalRef.current = null;
    writeEpochRef.current += 1;
    window.clearTimeout(unlockTimer.current);
    applyText('', false);
    setStatus(enabled ? '等待同步' : '未同步');
    setPermission('unknown');
  }, [applyText, enabled, sessionId, subId]);

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
      void flushLocal();
    };

    void tickRemote();
    void flushLocal();
    const remoteTimer = window.setInterval(() => void tickRemote(), 700);
    const localTimer = window.setInterval(tickLocal, 450);

    const onCopy = (event: ClipboardEvent) => {
      const copied = clipText(event.clipboardData?.getData('text/plain') || '');
      if (!copied) {
        window.setTimeout(() => void flushLocal(), 40);
        return;
      }
      const next = normalizeClip(copied, lastRef.current);
      if (next == null) return;
      applyText(next, false);
      void pushRemote(next, 'auto').catch(() => undefined);
    };
    const onFocus = () => void flushLocal();

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
