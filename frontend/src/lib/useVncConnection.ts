import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import RFB from '@novnc/novnc';
import { withBase } from '../basePath';
import {
  attachVncSession,
  clearHold,
  hasHold,
  holdCanvas,
  isDocumentVisible,
  trackVncSocket,
  vncLog,
  withVncCanvasHints,
  type VncSession,
} from './vncSession';

const MAX_RECONNECTS = 3;
const TAKEN_OVER_CODE = 4000;
const TAKEN_OVER_REASON = 'taken_over';

function vncUrl(sessionId: string, subId: string | null, occupancyId: string | null) {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = subId
    ? `/ws/vnc/${encodeURIComponent(sessionId)}/${encodeURIComponent(subId)}`
    : `/ws/vnc/${encodeURIComponent(sessionId)}`;
  const occ = occupancyId ? `?occ=${encodeURIComponent(occupancyId)}` : '';
  return `${proto}//${window.location.host}${withBase(path)}${occ}`;
}

function isTakenOverClose(code: number, reason: string) {
  return code === TAKEN_OVER_CODE || reason === TAKEN_OVER_REASON;
}

type Slot = {
  rfb: RFB;
  mount: HTMLElement;
  session: VncSession;
};

export function useVncConnection(opts: {
  sessionId: string;
  subId: string | null;
  occupancyId: string | null;
  viewOnly: boolean;
  transferPaused: boolean;
  wrapRef: RefObject<HTMLDivElement | null>;
  hostRef: RefObject<HTMLDivElement | null>;
  rfbRef: RefObject<RFB | null>;
  sessionRef: RefObject<VncSession | null>;
  onConnected: () => void;
  onVisibleRestore: () => void;
  onRemoteClipboard?: () => void;
  onInteractiveResume: () => void;
}) {
  const {
    sessionId,
    subId,
    occupancyId,
    viewOnly,
    transferPaused,
    wrapRef,
    hostRef,
    rfbRef,
    sessionRef,
    onConnected,
    onVisibleRestore,
    onRemoteClipboard,
    onInteractiveResume,
  } = opts;

  const [error, setError] = useState<string | null>(null);

  const viewOnlyRef = useRef(viewOnly || transferPaused);
  const transferPausedRef = useRef(transferPaused);
  const onConnectedRef = useRef(onConnected);
  const onVisibleRestoreRef = useRef(onVisibleRestore);
  const onRemoteClipboardRef = useRef(onRemoteClipboard);
  const onInteractiveResumeRef = useRef(onInteractiveResume);

  viewOnlyRef.current = viewOnly || transferPaused;
  transferPausedRef.current = transferPaused;
  onConnectedRef.current = onConnected;
  onVisibleRestoreRef.current = onVisibleRestore;
  onRemoteClipboardRef.current = onRemoteClipboard;
  onInteractiveResumeRef.current = onInteractiveResume;

  const activeCanvas = useCallback((): HTMLCanvasElement | null => {
    const direct = sessionRef.current?.canvas;
    if (direct) return direct;
    const host = hostRef.current;
    if (!host) return null;
    const live = host.querySelector('.vnc-mount:not(.is-pending) canvas');
    if (live instanceof HTMLCanvasElement) return live;
    const any = host.querySelector('canvas:not(.vnc-hold)');
    return any instanceof HTMLCanvasElement ? any : null;
  }, [hostRef, sessionRef]);

  useEffect(() => {
    const host = hostRef.current;
    const wrap = wrapRef.current;
    if (!host || !wrap) return undefined;

    let disposed = false;
    let retries = 0;
    let retryTimer: number | null = null;
    let layoutRaf: number | null = null;
    let takenOver = false;
    let reconnectOnFocus = false;
    let live: Slot | null = null;
    let pending: Slot | null = null;
    const ignoreDisconnect = new WeakSet<RFB>();

    const cancelLayoutRaf = () => {
      if (layoutRaf !== null) {
        window.cancelAnimationFrame(layoutRaf);
        layoutRaf = null;
      }
    };

    const drop = (slot: Slot | null) => {
      if (!slot) return;
      ignoreDisconnect.add(slot.rfb);
      slot.session.dispose();
      try {
        slot.rfb.disconnect();
      } catch {
        /* ignore */
      }
      slot.mount.remove();
      if (rfbRef.current === slot.rfb) rfbRef.current = null;
      if (sessionRef.current === slot.session) sessionRef.current = null;
    };

    const bindCanvasRestore = (session: VncSession) => {
      const canvas = session.canvas;
      if (!canvas) return;
      const restore = () => {
        if (disposed) return;
        session.restoreSurface();
        session.setVisible(isDocumentVisible());
      };
      canvas.addEventListener('contextlost', restore);
      canvas.addEventListener('contextrestored', restore);
    };

    const clearRetryTimer = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const failReconnect = () => {
      reconnectOnFocus = false;
      clearRetryTimer();
      setError('画面连接中断，请刷新');
    };

    const scheduleReconnect = (immediate = false) => {
      if (disposed || takenOver || pending || live) return;
      if (retries >= MAX_RECONNECTS) {
        failReconnect();
        return;
      }
      if (!isDocumentVisible()) {
        reconnectOnFocus = true;
        clearRetryTimer();
        return;
      }
      reconnectOnFocus = false;
      clearRetryTimer();
      const delay = immediate ? 0 : 400 * (retries + 1);
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        if (disposed || takenOver || pending || live) return;
        if (!isDocumentVisible()) {
          reconnectOnFocus = true;
          return;
        }
        if (retries >= MAX_RECONNECTS) {
          failReconnect();
          return;
        }
        retries += 1;
        connect('retry');
      }, delay);
    };

    const connect = (reason: 'mount' | 'retry') => {
      cancelLayoutRaf();
      if (disposed || takenOver || !hostRef.current || !wrapRef.current) return;
      if (wrapRef.current.clientWidth < 40 || wrapRef.current.clientHeight < 40) {
        layoutRaf = window.requestAnimationFrame(() => {
          layoutRaf = null;
          connect(reason);
        });
        return;
      }

      setError(null);
      if (pending) {
        drop(pending);
        pending = null;
      }

      try {
        const hide = Boolean(live) || hasHold(hostRef.current);
        const mount = document.createElement('div');
        mount.className = hide ? 'vnc-mount is-pending' : 'vnc-mount';
        hostRef.current.appendChild(mount);

        const ws = new WebSocket(vncUrl(sessionId, subId, occupancyId));
        ws.binaryType = 'arraybuffer';
        trackVncSocket(ws);
        vncLog('construct', { reason, sessionId, hide });

        const rfb = withVncCanvasHints(() => new RFB(mount, ws, { shared: true }));
        rfb.scaleViewport = true;
        rfb.clipViewport = false;
        rfb.resizeSession = false;
        rfb.focusOnClick = false;
        rfb.viewOnly = viewOnlyRef.current;
        rfb.qualityLevel = 8;
        rfb.compressionLevel = 0;

        const session = attachVncSession(rfb, ws, {
          wrap: () => wrapRef.current,
          onSettledFrame: () => {
            if (disposed) return;
            if (live && live.rfb !== rfb) drop(live);
            live = { rfb, mount, session };
            if (pending?.rfb === rfb) pending = null;
            mount.classList.remove('is-pending');
            rfbRef.current = rfb;
            sessionRef.current = session;
            if (hostRef.current) clearHold(hostRef.current);
            vncLog('swap', { sessionId });
          },
        });

        let wsClose = { code: 0, reason: '' };
        ws.addEventListener(
          'close',
          (ev) => {
            wsClose = { code: ev.code, reason: String(ev.reason || '') };
            vncLog('disconnect', { clean: ev.wasClean, code: ev.code, reason: ev.reason });
            if (!session.hasCommitted) return;
            const canvas = session.canvas;
            if (canvas && hostRef.current) holdCanvas(hostRef.current, canvas);
          },
          true,
        );

        pending = { rfb, mount, session };
        session.setVisible(isDocumentVisible());

        rfb.addEventListener('connect', () => {
          if (disposed) return;
          retries = 0;
          reconnectOnFocus = false;
          session.onConnected();
          session.setTransferPaused(transferPausedRef.current);
          if (!live) {
            rfbRef.current = rfb;
            sessionRef.current = session;
          }
          bindCanvasRestore(session);
          onConnectedRef.current();
        });

        rfb.addEventListener('disconnect', () => {
          if (disposed || ignoreDisconnect.has(rfb)) return;
          session.dispose();
          if (pending?.rfb === rfb) {
            pending.mount.remove();
            pending = null;
          }
          if (live?.rfb === rfb) {
            const canvas = session.canvas;
            if (canvas && hostRef.current) holdCanvas(hostRef.current, canvas);
            live.mount.remove();
            live = null;
          }
          if (sessionRef.current === session) sessionRef.current = null;
          if (rfbRef.current === rfb) rfbRef.current = null;

          if (occupancyId && isTakenOverClose(wsClose.code, wsClose.reason)) {
            takenOver = true;
            reconnectOnFocus = false;
            clearRetryTimer();
            setError('会话已被接管');
            return;
          }
          scheduleReconnect();
        });

        rfb.addEventListener('credentialsrequired', () => {
          rfb.sendCredentials({ password: '' });
        });

        rfb.addEventListener('clipboard', () => {
          onRemoteClipboardRef.current?.();
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : '画面连接失败');
      }
    };

    connect('mount');

    const flushReconnectOnFocus = () => {
      if (!reconnectOnFocus || takenOver || !isDocumentVisible()) return;
      scheduleReconnect(true);
    };

    const onVisibility = () => {
      if (disposed) return;
      const visible = isDocumentVisible();
      sessionRef.current?.setVisible(visible);
      pending?.session.setVisible(visible);
      if (visible) onVisibleRestoreRef.current();
      if (!visible && retryTimer !== null && !pending && !live) {
        clearRetryTimer();
        reconnectOnFocus = true;
        return;
      }
      flushReconnectOnFocus();
    };

    const onPageShow = () => {
      if (disposed) return;
      sessionRef.current?.restoreSurface();
      sessionRef.current?.setVisible(isDocumentVisible());
      if (isDocumentVisible()) onVisibleRestoreRef.current();
      flushReconnectOnFocus();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onPageShow);

    return () => {
      disposed = true;
      cancelLayoutRaf();
      clearRetryTimer();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onPageShow);
      drop(pending);
      drop(live);
      pending = null;
      live = null;
      rfbRef.current = null;
      sessionRef.current = null;
      if (hostRef.current) clearHold(hostRef.current);
    };
  }, [sessionId, subId, occupancyId, hostRef, wrapRef, rfbRef, sessionRef]);

  useEffect(() => {
    const session = sessionRef.current;
    session?.setTransferPaused(transferPaused);
    const host = hostRef.current;
    const canvas = activeCanvas();
    if (transferPaused && canvas && host) holdCanvas(host, canvas);
    if (!transferPaused && host) clearHold(host);
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.viewOnly = viewOnly || transferPaused;
    rfb.focusOnClick = false;
    if (!viewOnly && !transferPaused) onInteractiveResumeRef.current();
  }, [viewOnly, transferPaused, activeCanvas, hostRef, rfbRef, sessionRef]);

  return {
    error,
    activeCanvas,
  };
}
