import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import RFB from '@novnc/novnc';
import { api } from '../api/client';
import { withBase } from '../basePath';
import { snapEven } from '../desk/display';
import {
  advanceTrapX,
  canTakeImeFocus,
  clampTrapPos,
  commitTextFromEvents,
  isFallbackInsert,
  keyboardEventInit,
  shouldForwardKey,
  shouldPreventDefaultKey,
  shouldSendCommit,
  TRAP_H,
  TRAP_MIN_W,
} from '../lib/imeInput';
import {
  attachVncSession,
  clearHold,
  hasHold,
  holdCanvas,
  hushNovncTlsWarning,
  isDocumentVisible,
  trackVncSocket,
  VncSession,
  vncLog,
  withVncCanvasHints,
} from '../lib/vncSession';

let metricsCtx: CanvasRenderingContext2D | null = null;

function measureTrapText(text: string) {
  if (!text) return 0;
  if (!metricsCtx) {
    metricsCtx = document.createElement('canvas').getContext('2d');
  }
  if (!metricsCtx) return text.length * 8;
  metricsCtx.font = '16px system-ui, sans-serif';
  return metricsCtx.measureText(text).width;
}

hushNovncTlsWarning();

type Props = {
  sessionId: string;
  subId?: string | null;
  focused: boolean;
  title: string;
  remoteWidth: number;
  remoteHeight: number;
  sizeTick?: number;
  viewOnly?: boolean;
  resizeRemote?: boolean;
  occupancyId?: string | null;
  onFocus: () => void;
  onRemoteClipboard?: (text: string) => void;
};

function vncUrl(sessionId: string, subId: string | null, occupancyId: string | null) {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = subId
    ? `/ws/vnc/${encodeURIComponent(sessionId)}/${encodeURIComponent(subId)}`
    : `/ws/vnc/${encodeURIComponent(sessionId)}`;
  const occ = occupancyId ? `?occ=${encodeURIComponent(occupancyId)}` : '';
  return `${proto}//${window.location.host}${withBase(path)}${occ}`;
}

function mountCanvas(mount: HTMLElement): HTMLCanvasElement | null {
  const el = mount.querySelector('canvas:not(.vnc-hold)');
  return el instanceof HTMLCanvasElement ? el : null;
}

export default function VncViewer({
  sessionId,
  subId = null,
  focused,
  title,
  remoteWidth,
  remoteHeight,
  sizeTick = 0,
  viewOnly = false,
  resizeRemote = true,
  occupancyId = null,
  onFocus,
  onRemoteClipboard,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const trapRef = useRef<HTMLTextAreaElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const sessionRef = useRef<VncSession | null>(null);
  const imeRef = useRef({
    composing: false,
    lastCommitAt: 0,
    lastSent: null as { text: string; at: number } | null,
    x: 8,
    y: 8,
  });
  const typeChain = useRef(Promise.resolve());
  const [imeUi, setImeUi] = useState({ composing: false, x: 8, y: 8, width: TRAP_MIN_W });
  const applied = useRef({ w: 0, h: 0 });
  const genRef = useRef(0);
  const remoteRef = useRef({ w: remoteWidth, h: remoteHeight });
  const sessionIdRef = useRef(sessionId);
  const subRef = useRef(subId);
  const timerRef = useRef<number | null>(null);
  const inflightRef = useRef(false);
  const queuedRef = useRef(false);
  const pendingSizeRef = useRef(false);
  const viewOnlyRef = useRef(viewOnly);
  const resizeRemoteRef = useRef(resizeRemote);
  const [error, setError] = useState<string | null>(null);
  const onRemoteClipboardRef = useRef(onRemoteClipboard);
  onRemoteClipboardRef.current = onRemoteClipboard;

  remoteRef.current = { w: remoteWidth, h: remoteHeight };
  sessionIdRef.current = sessionId;
  subRef.current = subId;
  viewOnlyRef.current = viewOnly;
  resizeRemoteRef.current = resizeRemote;

  const autoscale = useCallback(() => {
    sessionRef.current?.autoscale();
  }, []);

  const focusTrap = useCallback((force = false) => {
    if (viewOnlyRef.current) return;
    const trap = trapRef.current;
    const wrap = wrapRef.current;
    if (!trap || !wrap) return;
    if (!force && !canTakeImeFocus(wrap, trap)) return;
    try {
      trap.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }, []);

  const sendCommit = useCallback((text: string) => {
    const wrap = wrapRef.current;
    const ime = imeRef.current;
    if (viewOnlyRef.current) {
      if (!ime.composing) setImeUi({ composing: false, x: ime.x, y: ime.y, width: TRAP_MIN_W });
      return;
    }
    const now = performance.now();
    if (!shouldSendCommit(text, now, ime.lastSent)) {
      if (!ime.composing) setImeUi({ composing: false, x: ime.x, y: ime.y, width: TRAP_MIN_W });
      return;
    }
    ime.lastSent = { text, at: now };
    ime.lastCommitAt = now;
    if (!ime.composing) {
      ime.x = advanceTrapX(ime.x, measureTrapText(text), wrap?.clientWidth || 0);
      setImeUi({ composing: false, x: ime.x, y: ime.y, width: TRAP_MIN_W });
    }
    typeChain.current = typeChain.current
      .then(() => api.typeText(sessionId, text, subId))
      .catch(() => undefined);
  }, [sessionId, subId]);

  const pushSize = useCallback((force = false) => {
    if (!resizeRemoteRef.current) return;
    if (!isDocumentVisible()) {
      pendingSizeRef.current = true;
      return;
    }
    const w = snapEven(remoteRef.current.w);
    const h = snapEven(remoteRef.current.h);
    if (w < 40 || h < 40) return;
    if (!force && w === applied.current.w && h === applied.current.h) {
      autoscale();
      return;
    }
    if (inflightRef.current) {
      queuedRef.current = true;
      return;
    }
    const sid = sessionIdRef.current;
    const extra = subRef.current;
    const gen = (genRef.current += 1);
    inflightRef.current = true;
    pendingSizeRef.current = false;
    vncLog('resize-push', { force, wanted: { w, h }, applied: { ...applied.current } });
    void api
      .resizeDisplay(sid, w, h, extra)
      .then((res) => {
        if (queuedRef.current) return;
        if (gen !== genRef.current) return;
        applied.current = res.geometry;
        autoscale();
      })
      .catch(() => {
        if (gen !== genRef.current) return;
        applied.current = { w: 0, h: 0 };
      })
      .finally(() => {
        inflightRef.current = false;
        if (queuedRef.current) {
          queuedRef.current = false;
          pushSize(true);
        }
      });
  }, [autoscale]);

  const schedulePush = useCallback(
    (immediate = false) => {
      if (!isDocumentVisible()) {
        pendingSizeRef.current = true;
        return;
      }
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (immediate) {
        pushSize(true);
        return;
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        pushSize(false);
      }, 180);
    },
    [pushSize],
  );
  const schedulePushRef = useRef(schedulePush);
  schedulePushRef.current = schedulePush;

  const syncRemoteSize = () => {
    if (!resizeRemoteRef.current) {
      sessionRef.current?.autoscale();
      return;
    }
    const w = snapEven(remoteRef.current.w);
    const h = snapEven(remoteRef.current.h);
    if (w === applied.current.w && h === applied.current.h) {
      sessionRef.current?.autoscale();
      return;
    }
    schedulePushRef.current(true);
  };
  const syncRemoteSizeRef = useRef(syncRemoteSize);
  syncRemoteSizeRef.current = syncRemoteSize;

  useEffect(() => {
    const host = hostRef.current;
    const wrap = wrapRef.current;
    if (!host || !wrap) return undefined;

    applied.current = { w: 0, h: 0 };
    let disposed = false;
    let retries = 0;
    let retryTimer: number | null = null;
    let live: { rfb: RFB; mount: HTMLElement; session: VncSession } | null = null;
    let pending: { rfb: RFB; mount: HTMLElement; session: VncSession } | null = null;
    const ignoreDisconnect = new WeakSet<RFB>();

    const drop = (slot: { rfb: RFB; mount: HTMLElement; session: VncSession } | null) => {
      if (!slot) return;
      ignoreDisconnect.add(slot.rfb);
      slot.session.dispose();
      try {
        slot.rfb.disconnect();
      } catch {
        /* ignore */
      }
      slot.mount.remove();
    };

    const bindCanvasRestore = (mount: HTMLElement, session: VncSession) => {
      const canvas = mountCanvas(mount);
      if (!canvas) return;
      const restore = () => {
        if (disposed) return;
        session.restoreSurface();
        session.setVisible(isDocumentVisible());
      };
      canvas.addEventListener('contextlost', restore);
      canvas.addEventListener('contextrestored', restore);
    };

    const connect = (reason: 'mount' | 'retry') => {
      if (disposed || !hostRef.current || !wrapRef.current) return;
      if (wrapRef.current.clientWidth < 40 || wrapRef.current.clientHeight < 40) {
        requestAnimationFrame(() => connect(reason));
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
        ws.addEventListener(
          'close',
          (ev) => {
            vncLog('disconnect', { clean: ev.wasClean, code: ev.code, reason: ev.reason });
            if (pending?.mount === mount && live) return;
            const canvas = mountCanvas(mount);
            if (canvas && hostRef.current) holdCanvas(hostRef.current, canvas);
          },
          true,
        );

        const rfb = withVncCanvasHints(() => new RFB(mount, ws, { shared: true }));
        rfb.scaleViewport = resizeRemoteRef.current;
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
            pending = pending?.rfb === rfb ? null : pending;
            mount.classList.remove('is-pending');
            rfbRef.current = rfb;
            sessionRef.current = session;
            if (hostRef.current) clearHold(hostRef.current);
            vncLog('swap', { sessionId });
          },
        });
        pending = { rfb, mount, session };
        session.setVisible(isDocumentVisible());

        rfb.addEventListener('connect', () => {
          if (disposed) return;
          retries = 0;
          session.onConnected();
          if (!live) {
            rfbRef.current = rfb;
            sessionRef.current = session;
          }
          bindCanvasRestore(mount, session);
          syncRemoteSizeRef.current();
        });
        rfb.addEventListener('disconnect', (e: { detail?: { clean?: boolean } }) => {
          if (disposed || ignoreDisconnect.has(rfb)) return;
          session.dispose();
          if (pending?.rfb === rfb) pending = null;
          if (live?.rfb === rfb) {
            const canvas = mountCanvas(live.mount);
            if (canvas && hostRef.current) holdCanvas(hostRef.current, canvas);
            live.mount.remove();
            live = null;
            if (sessionRef.current === session) sessionRef.current = null;
            if (rfbRef.current === rfb) rfbRef.current = null;
          }
          if (retries < (occupancyId ? 1 : 8)) {
            retries += 1;
            retryTimer = window.setTimeout(() => connect('retry'), 400 * retries);
            return;
          }
          if (!e?.detail?.clean) setError(occupancyId ? '会话已被接管' : '画面连接中断');
        });
        rfb.addEventListener('credentialsrequired', () => {
          rfb.sendCredentials({ password: '' });
        });
        rfb.addEventListener('clipboard', (e: { detail?: { text?: string } }) => {
          const next = String(e?.detail?.text ?? '');
          onRemoteClipboardRef.current?.(next);
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : '画面连接失败');
      }
    };

    connect('mount');

    const onVisibility = () => {
      if (disposed) return;
      const visible = isDocumentVisible();
      sessionRef.current?.setVisible(visible);
      pending?.session.setVisible(visible);
      if (visible && pendingSizeRef.current) schedulePushRef.current(true);
    };
    const onPageShow = () => {
      if (disposed) return;
      sessionRef.current?.restoreSurface();
      sessionRef.current?.setVisible(isDocumentVisible());
      if (isDocumentVisible() && pendingSizeRef.current) schedulePushRef.current(true);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onPageShow);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onPageShow);
      if (retryTimer) window.clearTimeout(retryTimer);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      drop(pending);
      drop(live);
      pending = null;
      live = null;
      rfbRef.current = null;
      sessionRef.current = null;
    };
  }, [sessionId, subId, occupancyId]);

  useEffect(() => {
    schedulePush(false);
  }, [remoteWidth, remoteHeight, schedulePush]);

  useEffect(() => {
    if (!sizeTick) return;
    applied.current = { w: 0, h: 0 };
    schedulePush(true);
  }, [sizeTick, schedulePush]);

  useEffect(() => {
    const trap = trapRef.current;
    if (!trap) return undefined;

    const canvas = () => {
      const host = hostRef.current;
      return host ? mountCanvas(host) : null;
    };

    const onKey = (e: KeyboardEvent) => {
      if (viewOnlyRef.current) return;
      const ime = imeRef.current;
      const now = performance.now();
      if (shouldPreventDefaultKey(e, ime.composing)) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (!shouldForwardKey(e, ime.composing, now, ime.lastCommitAt)) return;
      const target = canvas();
      if (!target) return;
      target.dispatchEvent(new KeyboardEvent(e.type, keyboardEventInit(e)));
    };

    const grow = () => {
      const w = Math.max(TRAP_MIN_W, measureTrapText(trap.value) + 8);
      setImeUi((ui) => ({ ...ui, composing: true, width: w }));
    };

    const onCompositionStart = () => {
      imeRef.current.composing = true;
      setImeUi((ui) => ({ ...ui, composing: true }));
    };

    const onCompositionUpdate = () => {
      grow();
    };

    const onCompositionEnd = (e: CompositionEvent) => {
      const snapshot = { data: e.data, value: trap.value };
      imeRef.current.composing = false;
      window.queueMicrotask(() => {
        const chained = imeRef.current.composing;
        const text = commitTextFromEvents(snapshot.data, snapshot.value, chained);
        if (!chained) trap.value = '';
        if (text) sendCommit(text);
        else if (!chained) {
          setImeUi({
            composing: false,
            x: imeRef.current.x,
            y: imeRef.current.y,
            width: TRAP_MIN_W,
          });
        }
      });
    };

    const onInput = (e: Event) => {
      const ime = imeRef.current;
      if (ime.composing) {
        grow();
        return;
      }
      const inputType = e instanceof InputEvent ? e.inputType : '';
      if (!isFallbackInsert(inputType, false, trap.value)) return;
      const text = trap.value;
      trap.value = '';
      sendCommit(text);
    };

    const onClipboard = (e: Event) => {
      if (viewOnlyRef.current) return;
      e.preventDefault();
    };

    trap.addEventListener('keydown', onKey);
    trap.addEventListener('keyup', onKey);
    trap.addEventListener('compositionstart', onCompositionStart);
    trap.addEventListener('compositionupdate', onCompositionUpdate);
    trap.addEventListener('compositionend', onCompositionEnd);
    trap.addEventListener('input', onInput);
    trap.addEventListener('copy', onClipboard);
    trap.addEventListener('cut', onClipboard);
    trap.addEventListener('paste', onClipboard);
    return () => {
      trap.removeEventListener('keydown', onKey);
      trap.removeEventListener('keyup', onKey);
      trap.removeEventListener('compositionstart', onCompositionStart);
      trap.removeEventListener('compositionupdate', onCompositionUpdate);
      trap.removeEventListener('compositionend', onCompositionEnd);
      trap.removeEventListener('input', onInput);
      trap.removeEventListener('copy', onClipboard);
      trap.removeEventListener('cut', onClipboard);
      trap.removeEventListener('paste', onClipboard);
    };
  }, [sendCommit]);

  useEffect(() => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.viewOnly = viewOnly;
    rfb.focusOnClick = false;
    if (!viewOnly) focusTrap(false);
  }, [viewOnly, focusTrap]);

  useEffect(() => {
    if (!focused || viewOnly) return;
    focusTrap(false);
  }, [focused, viewOnly, focusTrap]);

  const placeTrap = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || viewOnlyRef.current) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const next = clampTrapPos(
      e.clientX - rect.left,
      e.clientY - rect.top,
      wrap.clientWidth,
      wrap.clientHeight,
    );
    imeRef.current.x = next.x;
    imeRef.current.y = next.y;
    setImeUi((ui) => ({ ...ui, x: next.x, y: next.y, width: ui.composing ? ui.width : TRAP_MIN_W }));
    focusTrap(true);
  };

  return (
    <div
      ref={wrapRef}
      className={`vnc-root ${focused ? 'is-focused' : ''}`}
      aria-label={title}
      onPointerDownCapture={(e) => {
        if (!focused && e.button === 0) onFocus();
        const rfb = rfbRef.current;
        if (!rfb || viewOnlyRef.current || !navigator.clipboard?.readText) return;
        void navigator.clipboard
          .readText()
          .then((text) => {
            try {
              rfb.clipboardPasteFrom(text);
            } catch {
              /* ignore */
            }
          })
          .catch(() => undefined);
      }}
      onPointerDown={placeTrap}
      onPointerUp={(e) => {
        if (e.button !== 0 || viewOnlyRef.current) return;
        focusTrap(true);
      }}
    >
      <div ref={hostRef} className="vnc-host" />
      <textarea
        ref={trapRef}
        className={`vnc-ime-trap ${imeUi.composing ? 'is-composing' : ''}`}
        rows={1}
        wrap="off"
        tabIndex={-1}
        aria-hidden="true"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        disabled={viewOnly}
        style={{ left: imeUi.x, top: imeUi.y, width: imeUi.width, height: TRAP_H }}
      />
      {error && (
        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-lg border bg-popover px-3 py-2 text-sm">
          {error}
          <Button size="sm" onClick={() => window.location.reload()}>
            刷新
          </Button>
        </div>
      )}
    </div>
  );
}
