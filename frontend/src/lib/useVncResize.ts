import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { api } from '../api/client';
import { snapEven } from '../desk/display';
import { isDocumentVisible, vncLog, type VncSession } from './vncSession';

export function useVncResize(opts: {
  sessionId: string;
  subId: string | null;
  remoteWidth: number;
  remoteHeight: number;
  sizeTick: number;
  resizeRemote: boolean;
  transferPaused: boolean;
  sessionRef: RefObject<VncSession | null>;
}) {
  const {
    sessionId,
    subId,
    remoteWidth,
    remoteHeight,
    sizeTick,
    resizeRemote,
    transferPaused,
    sessionRef,
  } = opts;

  const appliedRef = useRef({ w: 0, h: 0 });
  const genRef = useRef(0);
  const remoteRef = useRef({ w: remoteWidth, h: remoteHeight });
  const sessionIdRef = useRef(sessionId);
  const subRef = useRef(subId);
  const resizeRemoteRef = useRef(resizeRemote);
  const transferPausedRef = useRef(transferPaused);
  const timerRef = useRef<number | null>(null);
  const inflightRef = useRef(false);
  const queuedRef = useRef(false);
  const pendingSizeRef = useRef(false);

  remoteRef.current = { w: remoteWidth, h: remoteHeight };
  sessionIdRef.current = sessionId;
  subRef.current = subId;
  resizeRemoteRef.current = resizeRemote;
  transferPausedRef.current = transferPaused;

  const autoscale = useCallback(() => {
    sessionRef.current?.autoscale();
  }, [sessionRef]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const pushSize = useCallback(
    (force = false) => {
      if (transferPausedRef.current) {
        pendingSizeRef.current = true;
        return;
      }
      if (!resizeRemoteRef.current) return;
      if (!isDocumentVisible()) {
        pendingSizeRef.current = true;
        return;
      }
      const w = snapEven(remoteRef.current.w);
      const h = snapEven(remoteRef.current.h);
      if (w < 40 || h < 40) return;
      if (!force && w === appliedRef.current.w && h === appliedRef.current.h) {
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
      vncLog('resize-push', { force, wanted: { w, h }, applied: { ...appliedRef.current } });
      void api
        .resizeDisplay(sid, w, h, extra)
        .then((res) => {
          if (gen !== genRef.current) return;
          if (queuedRef.current) return;
          appliedRef.current = res.geometry;
          autoscale();
        })
        .catch(() => {
          if (gen !== genRef.current) return;
          appliedRef.current = { w: 0, h: 0 };
        })
        .finally(() => {
          if (gen !== genRef.current) return;
          inflightRef.current = false;
          if (queuedRef.current) {
            queuedRef.current = false;
            pushSize(true);
          }
        });
    },
    [autoscale],
  );

  const schedulePush = useCallback(
    (immediate = false) => {
      if (!isDocumentVisible()) {
        pendingSizeRef.current = true;
        return;
      }
      clearTimer();
      if (immediate) {
        pushSize(true);
        return;
      }
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        pushSize(false);
      }, 180);
    },
    [clearTimer, pushSize],
  );

  const syncRemoteSize = useCallback(() => {
    if (!resizeRemoteRef.current) {
      sessionRef.current?.autoscale();
      return;
    }
    const w = snapEven(remoteRef.current.w);
    const h = snapEven(remoteRef.current.h);
    if (w === appliedRef.current.w && h === appliedRef.current.h) {
      sessionRef.current?.autoscale();
      return;
    }
    schedulePush(true);
  }, [schedulePush, sessionRef]);

  const flushPendingSize = useCallback(() => {
    if (pendingSizeRef.current && isDocumentVisible() && !transferPausedRef.current) {
      schedulePush(true);
    }
  }, [schedulePush]);

  const resetApplied = useCallback(() => {
    genRef.current += 1;
    inflightRef.current = false;
    queuedRef.current = false;
    pendingSizeRef.current = false;
    appliedRef.current = { w: 0, h: 0 };
    clearTimer();
  }, [clearTimer]);

  useEffect(() => {
    resetApplied();
    return () => {
      genRef.current += 1;
      clearTimer();
    };
  }, [sessionId, subId, resetApplied, clearTimer]);

  useEffect(() => {
    schedulePush(false);
  }, [remoteWidth, remoteHeight, schedulePush]);

  useEffect(() => {
    if (!sizeTick) return;
    appliedRef.current = { w: 0, h: 0 };
    schedulePush(true);
  }, [sizeTick, schedulePush]);

  useEffect(() => {
    if (!transferPaused) flushPendingSize();
  }, [transferPaused, flushPendingSize]);

  return {
    syncRemoteSize,
    flushPendingSize,
    resetApplied,
  };
}
