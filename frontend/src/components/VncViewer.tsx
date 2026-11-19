import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import type RFB from '@novnc/novnc';
import { TRAP_H } from '../lib/imeInput';
import { useVncConnection } from '../lib/useVncConnection';
import { useVncIme } from '../lib/useVncIme';
import { useVncResize } from '../lib/useVncResize';
import { hushNovncTlsWarning, type VncSession } from '../lib/vncSession';

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
  transferPaused?: boolean;
  onFocus: () => void;
  onRemoteClipboard?: () => void;
  onUserGesture?: () => void;
  onLocalPaste?: (data: DataTransfer | null) => Promise<'inject' | 'done'>;
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
  transferPaused = false,
  onFocus,
  onRemoteClipboard,
  onUserGesture,
  onLocalPaste,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const trapRef = useRef<HTMLTextAreaElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const sessionRef = useRef<VncSession | null>(null);
  const focusTrapRef = useRef<(force?: boolean) => void>(() => undefined);
  const onUserGestureRef = useRef(onUserGesture);
  onUserGestureRef.current = onUserGesture;

  const { syncRemoteSize, flushPendingSize } = useVncResize({
    sessionId,
    subId,
    remoteWidth,
    remoteHeight,
    sizeTick,
    resizeRemote,
    transferPaused,
    sessionRef,
  });

  const { error, activeCanvas } = useVncConnection({
    sessionId,
    subId,
    occupancyId,
    viewOnly,
    transferPaused,
    wrapRef,
    hostRef,
    rfbRef,
    sessionRef,
    onConnected: syncRemoteSize,
    onVisibleRestore: flushPendingSize,
    onRemoteClipboard,
    onInteractiveResume: () => focusTrapRef.current(false),
  });

  const { imeUi, focusTrap, placeTrap } = useVncIme({
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
  });
  focusTrapRef.current = focusTrap;

  return (
    <div
      ref={wrapRef}
      className={`vnc-root ${focused ? 'is-focused' : ''}`}
      aria-label={title}
      onPointerDownCapture={(e) => {
        if (!focused && e.button === 0) onFocus();
      }}
      onPointerDown={placeTrap}
      onPointerUp={(e) => {
        if (e.button !== 0) return;
        onUserGestureRef.current?.();
        if (viewOnly || transferPaused) return;
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
        aria-label="远程输入"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        disabled={viewOnly || transferPaused}
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
