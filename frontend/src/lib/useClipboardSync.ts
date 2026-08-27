import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { normalizeClipboardText } from '@nya/shared';

const CLIP_MAX = 1024 * 1024;

type Perm = 'unknown' | 'granted' | 'denied';

function clipText(value: unknown) {
  const text = String(value ?? '');
  return text.length > CLIP_MAX ? text.slice(0, CLIP_MAX) : text;
}

async function readLocalClipboard() {
  if (!navigator.clipboard?.readText) throw new Error('unsupported');
  return clipText(await navigator.clipboard.readText());
}

async function writeLocalClipboard(text: string) {
  if (!navigator.clipboard?.writeText) return false;
  await navigator.clipboard.writeText(text);
  return true;
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
  const [permission, setPermission] = useState<Perm>('unknown');
  const [status, setStatus] = useState('未同步');
  const lastRef = useRef('');
  const textRef = useRef('');
  const autoRef = useRef(true);
  const typingRef = useRef(false);
  const pushTimer = useRef(0);
  const sessionRef = useRef(sessionId);
  const subRef = useRef(subId);

  sessionRef.current = sessionId;
  subRef.current = subId;
  autoRef.current = auto;
  textRef.current = text;

  const applyText = useCallback((next: string, markSynced = true) => {
    const value = clipText(next);
    textRef.current = value;
    setText(value);
    if (markSynced) lastRef.current = value;
  }, []);

  const pushRemote = useCallback(async (value: string) => {
    const sid = sessionRef.current;
    if (!sid) return;
    const next = normalizeClipboardText(clipText(value), lastRef.current);
    if (next == null || next === lastRef.current) return;
    lastRef.current = next;
    await api.setClipboard(sid, next, subRef.current);
    setStatus('已同步到远程');
  }, []);

  const ingestRemote = useCallback(async (remote: string) => {
    const next = normalizeClipboardText(clipText(remote), lastRef.current);
    if (next == null || next === lastRef.current) return;
    lastRef.current = next;
    if (!typingRef.current) {
      textRef.current = next;
      setText(next);
    }
    try {
      await writeLocalClipboard(next);
      setPermission('granted');
      setStatus('已同步到本地');
    } catch {
      setStatus('已读取远程');
    }
  }, []);

  const flushLocal = useCallback(async () => {
    if (!autoRef.current || !sessionRef.current) return;
    try {
      const local = await readLocalClipboard();
      setPermission('granted');
      const next = normalizeClipboardText(local, lastRef.current);
      if (next == null || next === lastRef.current) return;
      applyText(next, false);
      await pushRemote(next);
    } catch {
      if (permission === 'unknown') setPermission('denied');
    }
  }, [applyText, permission, pushRemote]);

  const flushRemote = useCallback(async () => {
    const sid = sessionRef.current;
    if (!sid) return;
    const data = await api.getClipboard(sid, subRef.current);
    await ingestRemote(data.text);
  }, [ingestRemote]);

  const pull = useCallback(async () => {
    const sid = sessionRef.current;
    if (!sid) return;
    setBusy(true);
    try {
      await flushRemote();
    } finally {
      setBusy(false);
    }
  }, [flushRemote]);

  const push = useCallback(async () => {
    if (!sessionRef.current) return;
    setBusy(true);
    try {
      await pushRemote(textRef.current);
    } finally {
      setBusy(false);
    }
  }, [pushRemote]);

  const requestPermission = useCallback(async () => {
    try {
      const local = await readLocalClipboard();
      setPermission('granted');
      if (autoRef.current) {
        const next = normalizeClipboardText(local, lastRef.current);
        if (next == null) return;
        applyText(next, false);
        await pushRemote(next);
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
        void pushRemote(next).catch(() => undefined);
      }, 280);
    },
    [applyText, pushRemote],
  );

  useEffect(() => {
    lastRef.current = '';
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
        const data = await api.getClipboard(sessionId, subId);
        if (!cancelled) await ingestRemote(data.text);
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
      const next = normalizeClipboardText(copied, lastRef.current);
      if (next == null) return;
      applyText(next, false);
      void pushRemote(next).catch(() => undefined);
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
  }, [applyText, auto, enabled, flushLocal, ingestRemote, pushRemote, sessionId, subId]);

  useEffect(() => () => window.clearTimeout(pushTimer.current), []);

  return {
    text,
    auto,
    setAuto,
    busy,
    permission,
    status,
    ingestRemote,
    flushLocal,
    flushRemote,
    pull,
    push,
    onTextChange,
    requestPermission,
  };
}
