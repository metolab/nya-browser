import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import RFB from '@novnc/novnc';
import { api } from '../api/client';
import { snapEven } from '../desk/display';

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
};

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
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const applied = useRef({ w: 0, h: 0 });
  const genRef = useRef(0);
  const remoteRef = useRef({ w: remoteWidth, h: remoteHeight });
  const sessionRef = useRef(sessionId);
  const subRef = useRef(subId);
  const timerRef = useRef<number | null>(null);
  const inflightRef = useRef(false);
  const queuedRef = useRef(false);
  const viewOnlyRef = useRef(viewOnly);
  const resizeRemoteRef = useRef(resizeRemote);
  const [error, setError] = useState<string | null>(null);

  remoteRef.current = { w: remoteWidth, h: remoteHeight };
  sessionRef.current = sessionId;
  subRef.current = subId;
  viewOnlyRef.current = viewOnly;
  resizeRemoteRef.current = resizeRemote;

  const forceScale = () => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.scaleViewport = false;
    rfb.scaleViewport = true;
  };

  const pushSize = useCallback((force = false) => {
    if (!resizeRemoteRef.current) return;
    const w = snapEven(remoteRef.current.w);
    const h = snapEven(remoteRef.current.h);
    if (w < 40 || h < 40) return;
    if (!force && w === applied.current.w && h === applied.current.h) {
      forceScale();
      return;
    }
    if (inflightRef.current) {
      queuedRef.current = true;
      return;
    }
    const sid = sessionRef.current;
    const extra = subRef.current;
    const gen = (genRef.current += 1);
    inflightRef.current = true;
    void api
      .resizeDisplay(sid, w, h, extra)
      .then((res) => {
        if (queuedRef.current) return;
        if (gen !== genRef.current) return;
        applied.current = res.geometry;
        forceScale();
        window.setTimeout(forceScale, 200);
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
  }, []);

  const schedulePush = useCallback(
    (immediate = false) => {
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

  useEffect(() => {
    const host = hostRef.current;
    const wrap = wrapRef.current;
    if (!host || !wrap) return undefined;

    applied.current = { w: 0, h: 0 };
    let disposed = false;
    let rfb: RFB | null = null;
    let retryTimer: number | null = null;
    let retries = 0;

    const connect = () => {
      if (disposed || !hostRef.current || !wrapRef.current) return;
      if (wrapRef.current.clientWidth < 40 || wrapRef.current.clientHeight < 40) {
        requestAnimationFrame(connect);
        return;
      }

      setError(null);
      if (rfb) {
        try {
          rfb.disconnect();
        } catch {
          /* ignore */
        }
        rfb = null;
      }
      hostRef.current.replaceChildren();

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const path = subId
        ? `/ws/vnc/${encodeURIComponent(sessionId)}/${encodeURIComponent(subId)}`
        : `/ws/vnc/${encodeURIComponent(sessionId)}`;
      const occ = occupancyId ? `?occ=${encodeURIComponent(occupancyId)}` : '';
      const url = `${proto}//${window.location.host}${path}${occ}`;
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';

      rfb = new RFB(hostRef.current, ws, { shared: true });
      rfb.scaleViewport = resizeRemoteRef.current;
      rfb.clipViewport = false;
      rfb.resizeSession = false;
      rfb.focusOnClick = !viewOnlyRef.current;
      rfb.viewOnly = viewOnlyRef.current;
      rfb.qualityLevel = 6;
      rfb.compressionLevel = 2;
      rfbRef.current = rfb;

      rfb.addEventListener('connect', () => {
        if (disposed) return;
        retries = 0;
        applied.current = { w: 0, h: 0 };
        if (resizeRemoteRef.current) {
          schedulePush(true);
          window.setTimeout(() => schedulePush(true), 400);
        }
      });
      rfb.addEventListener('disconnect', (e: { detail?: { clean?: boolean } }) => {
        if (disposed) return;
        if (rfbRef.current === rfb) rfbRef.current = null;
        applied.current = { w: 0, h: 0 };
        if (retries < (occupancyId ? 1 : 8)) {
          retries += 1;
          retryTimer = window.setTimeout(connect, 400 * retries);
          return;
        }
        if (!e?.detail?.clean) setError(occupancyId ? '会话已被接管' : '画面连接中断');
      });
      rfb.addEventListener('credentialsrequired', () => {
        rfb?.sendCredentials({ password: '' });
      });
    };

    connect();

    const ro = new ResizeObserver(() => {
      if (disposed) return;
      forceScale();
    });
    ro.observe(wrap);

    return () => {
      disposed = true;
      ro.disconnect();
      if (retryTimer) window.clearTimeout(retryTimer);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      try {
        rfb?.disconnect();
      } catch {
        /* ignore */
      }
      rfbRef.current = null;
    };
  }, [sessionId, subId, occupancyId, pushSize, schedulePush]);

  useEffect(() => {
    schedulePush(false);
  }, [remoteWidth, remoteHeight, schedulePush]);

  useEffect(() => {
    if (!sizeTick) return;
    applied.current = { w: 0, h: 0 };
    schedulePush(true);
  }, [sizeTick, schedulePush]);

  useEffect(() => {
    const rfb = rfbRef.current;
    if (!rfb) return;
    rfb.viewOnly = viewOnly;
    rfb.focusOnClick = !viewOnly;
    if (!viewOnly) {
      try {
        rfb.focus();
      } catch {
        /* ignore */
      }
    }
  }, [viewOnly]);

  useEffect(() => {
    if (!focused) return;
    try {
      rfbRef.current?.focus();
    } catch {
      /* ignore */
    }
  }, [focused]);

  return (
    <div
      ref={wrapRef}
      className={`vnc-root ${focused ? 'is-focused' : ''}`}
      aria-label={title}
      onPointerDownCapture={(e) => {
        if (!focused && e.button === 0) onFocus();
      }}
    >
      <div ref={hostRef} className="vnc-host" />
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
