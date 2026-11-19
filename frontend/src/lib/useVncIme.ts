import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import type RFB from '@novnc/novnc';
import { api } from '../api/client';
import {
  advanceTrapX,
  canTakeImeFocus,
  clampTrapPos,
  commitTextFromEvents,
  isCommitKey,
  isFallbackInsert,
  keyboardEventInit,
  shouldForwardKey,
  shouldInterceptPaste,
  shouldPreventDefaultKey,
  shouldSendCommit,
  TRAP_MIN_W,
} from './imeInput';
import type { VncSession } from './vncSession';

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

export function useVncIme(opts: {
  sessionId: string;
  subId: string | null;
  focused: boolean;
  viewOnly: boolean;
  transferPaused: boolean;
  wrapRef: RefObject<HTMLDivElement | null>;
  trapRef: RefObject<HTMLTextAreaElement | null>;
  rfbRef: RefObject<RFB | null>;
  sessionRef: RefObject<VncSession | null>;
  activeCanvas: () => HTMLCanvasElement | null;
  onLocalPaste?: (data: DataTransfer | null) => Promise<'inject' | 'done'>;
}) {
  const {
    sessionId,
    subId,
    focused,
    viewOnly,
    transferPaused,
    wrapRef,
    trapRef,
    rfbRef,
    sessionRef,
    activeCanvas,
    onLocalPaste,
  } = opts;

  const imeRef = useRef({
    composing: false,
    lastCommitAt: 0,
    lastCommitCode: null as string | null,
    lastComposingCode: null as string | null,
    lastSent: null as { text: string; at: number } | null,
    x: 8,
    y: 8,
  });
  const [imeUi, setImeUi] = useState({ composing: false, x: 8, y: 8, width: TRAP_MIN_W });

  const inputGenRef = useRef(0);
  const keyGenRef = useRef(0);
  const pointerEpochRef = useRef(0);
  const typeChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const typingPendingRef = useRef(0);

  const viewOnlyRef = useRef(viewOnly || transferPaused);
  const onLocalPasteRef = useRef(onLocalPaste);
  const activeCanvasRef = useRef(activeCanvas);

  viewOnlyRef.current = viewOnly || transferPaused;
  onLocalPasteRef.current = onLocalPaste;
  activeCanvasRef.current = activeCanvas;

  const focusTrap = useCallback(
    (force = false) => {
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
    },
    [trapRef, wrapRef],
  );

  const resetImeState = useCallback(
    (releaseKeys = false) => {
      const ime = imeRef.current;
      ime.composing = false;
      ime.lastComposingCode = null;
      const trap = trapRef.current;
      if (trap && trap.value) trap.value = '';
      setImeUi((ui) =>
        ui.composing || ui.width !== TRAP_MIN_W
          ? { composing: false, x: ime.x, y: ime.y, width: TRAP_MIN_W }
          : ui,
      );
      if (releaseKeys) {
        keyGenRef.current += 1;
        sessionRef.current?.releaseKeyboard();
      }
    },
    [sessionRef, trapRef],
  );

  const sendCommit = useCallback(
    (text: string) => {
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
      ime.lastCommitCode = ime.lastComposingCode;
      ime.lastComposingCode = null;
      if (!ime.composing) {
        ime.x = advanceTrapX(ime.x, measureTrapText(text), wrap?.clientWidth || 0);
        setImeUi({ composing: false, x: ime.x, y: ime.y, width: TRAP_MIN_W });
      }
      const gen = inputGenRef.current;
      typingPendingRef.current += 1;
      typeChainRef.current = typeChainRef.current
        .then(() => {
          if (gen !== inputGenRef.current || viewOnlyRef.current) return undefined;
          return api.typeText(sessionId, text, subId);
        })
        .catch(() => undefined)
        .finally(() => {
          if (gen === inputGenRef.current) {
            typingPendingRef.current = Math.max(0, typingPendingRef.current - 1);
          }
        });
    },
    [sessionId, subId, wrapRef],
  );

  // Reset IME queue & composition state on session/window switches.
  useEffect(() => {
    inputGenRef.current += 1;
    keyGenRef.current += 1;
    pointerEpochRef.current += 1;
    typingPendingRef.current = 0;
    typeChainRef.current = Promise.resolve();
    imeRef.current.lastSent = null;
    imeRef.current.lastCommitAt = 0;
    imeRef.current.lastCommitCode = null;
    resetImeState(false);
  }, [sessionId, subId, resetImeState]);

  // Reset composition & release keys whenever interaction is paused or viewOnly turns on.
  useEffect(() => {
    if (viewOnly || transferPaused) {
      resetImeState(true);
    }
  }, [viewOnly, transferPaused, resetImeState]);

  useEffect(() => {
    if (!focused || viewOnly || transferPaused) return;
    focusTrap(false);
  }, [focused, viewOnly, transferPaused, focusTrap]);

  useEffect(() => {
    const trap = trapRef.current;
    const wrap = wrapRef.current;
    if (!trap) return undefined;

    const dispatchToCanvas = (type: string, init: KeyboardEventInit, gen: number, keyGen: number) => {
      if (gen !== inputGenRef.current || keyGen !== keyGenRef.current || viewOnlyRef.current) return;
      const target = activeCanvasRef.current();
      if (!target) return;
      target.dispatchEvent(new KeyboardEvent(type, init));
    };

    const onKey = (e: KeyboardEvent) => {
      if (viewOnlyRef.current) return;
      const ime = imeRef.current;
      const now = performance.now();
      const hasLocalPaste = Boolean(onLocalPasteRef.current);

      if (ime.composing && e.type === 'keydown' && isCommitKey(e) && e.code) {
        ime.lastComposingCode = e.code;
      }

      e.stopPropagation();
      if (shouldPreventDefaultKey(e, ime.composing, hasLocalPaste)) e.preventDefault();
      if (
        !shouldForwardKey(e, ime.composing, now, ime.lastCommitAt, {
          hasLocalPaste,
          lastCommitCode: ime.lastCommitCode,
        })
      ) {
        return;
      }

      const init = keyboardEventInit(e);
      const gen = inputGenRef.current;
      const keyGen = keyGenRef.current;
      // Preserve key ordering against in-flight HTTP xtype commits (e.g. CJK + Enter).
      if (typingPendingRef.current > 0) {
        const type = e.type;
        typeChainRef.current = typeChainRef.current
          .then(() => {
            dispatchToCanvas(type, init, gen, keyGen);
          })
          .catch(() => undefined);
        return;
      }
      dispatchToCanvas(e.type, init, gen, keyGen);
    };

    const grow = () => {
      const w = Math.max(TRAP_MIN_W, measureTrapText(trap.value) + 8);
      setImeUi((ui) => ({ ...ui, composing: true, width: w }));
    };

    const onCompositionStart = () => {
      imeRef.current.composing = true;
      imeRef.current.lastComposingCode = null;
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
      const text = trap.value;
      if (!isFallbackInsert(inputType, false, text)) {
        if (text) trap.value = '';
        return;
      }
      trap.value = '';
      sendCommit(text);
    };

    const onBlur = () => {
      resetImeState(true);
    };

    const sendCtrlV = () => {
      const rfb = rfbRef.current;
      if (!rfb || viewOnlyRef.current) return;
      // Clear any held modifier (e.g. macOS Cmd mapped to Alt_L or held Ctrl) before injecting Ctrl+V.
      sessionRef.current?.releaseKeyboard();
      rfb.sendKey(0xffe3, 'ControlLeft', true);
      rfb.sendKey(0x0076, 'KeyV', true);
      rfb.sendKey(0x0076, 'KeyV', false);
      rfb.sendKey(0xffe3, 'ControlLeft', false);
    };

    const onClipboard = (e: Event) => {
      if (viewOnlyRef.current) return;
      e.preventDefault();
    };

    const onPaste = (e: ClipboardEvent) => {
      if (viewOnlyRef.current) return;
      if (imeRef.current.composing) return;
      const handler = onLocalPasteRef.current;
      if (!handler) return;
      const target = e.target;
      if (target instanceof HTMLInputElement) return;
      if (target instanceof HTMLTextAreaElement && target !== trap) return;
      e.preventDefault();
      e.stopPropagation();
      const gen = inputGenRef.current;
      const pointerEpoch = pointerEpochRef.current;
      void Promise.resolve(handler(e.clipboardData)).then((result) => {
        if (result !== 'inject') return;
        if (gen !== inputGenRef.current || viewOnlyRef.current) return;
        // Skip delayed Ctrl+V if the user clicked elsewhere while a large upload ran.
        if (pointerEpoch !== pointerEpochRef.current) return;
        sendCtrlV();
      });
    };

    const onPasteKeyCapture = (e: KeyboardEvent) => {
      if (viewOnlyRef.current) return;
      if (!shouldInterceptPaste(e, Boolean(onLocalPasteRef.current))) return;
      e.stopPropagation();
    };

    wrap?.addEventListener('keydown', onPasteKeyCapture, true);
    wrap?.addEventListener('keyup', onPasteKeyCapture, true);
    trap.addEventListener('keydown', onKey);
    trap.addEventListener('keyup', onKey);
    trap.addEventListener('compositionstart', onCompositionStart);
    trap.addEventListener('compositionupdate', onCompositionUpdate);
    trap.addEventListener('compositionend', onCompositionEnd);
    trap.addEventListener('input', onInput);
    trap.addEventListener('blur', onBlur);
    trap.addEventListener('copy', onClipboard);
    trap.addEventListener('cut', onClipboard);
    trap.addEventListener('paste', onPaste);
    wrap?.addEventListener('paste', onPaste);
    return () => {
      wrap?.removeEventListener('keydown', onPasteKeyCapture, true);
      wrap?.removeEventListener('keyup', onPasteKeyCapture, true);
      trap.removeEventListener('keydown', onKey);
      trap.removeEventListener('keyup', onKey);
      trap.removeEventListener('compositionstart', onCompositionStart);
      trap.removeEventListener('compositionupdate', onCompositionUpdate);
      trap.removeEventListener('compositionend', onCompositionEnd);
      trap.removeEventListener('input', onInput);
      trap.removeEventListener('blur', onBlur);
      trap.removeEventListener('copy', onClipboard);
      trap.removeEventListener('cut', onClipboard);
      trap.removeEventListener('paste', onPaste);
      wrap?.removeEventListener('paste', onPaste);
    };
  }, [resetImeState, rfbRef, sendCommit, sessionRef, trapRef, wrapRef]);

  const placeTrap = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || viewOnlyRef.current) return;
      pointerEpochRef.current += 1;
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
      setImeUi((ui) => ({
        ...ui,
        x: next.x,
        y: next.y,
        width: ui.composing ? ui.width : TRAP_MIN_W,
      }));
      focusTrap(true);
    },
    [focusTrap, wrapRef],
  );

  return {
    imeUi,
    focusTrap,
    placeTrap,
  };
}
