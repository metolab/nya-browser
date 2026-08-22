import { useEffect, useRef, useState } from 'react';
import { Loader2Icon } from 'lucide-react';
import type { Session } from '@nya/shared';
import VncViewer from '../components/VncViewer';
import { readStablePane, resolveRemoteSize, type DisplayPolicy, type Size } from './display';
import { vncWindowExtra } from '../lib/vnc';

type Props = {
  session: Session;
  windowId: string;
  occupancyId: string | null;
  busy: boolean;
  display: DisplayPolicy;
  sizeTick: number;
  onPaneChange: (pane: Size) => void;
};

export default function DeskStage({
  session,
  windowId,
  occupancyId,
  busy,
  display,
  sizeTick,
  onPaneChange,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState<Size>({ w: 1280, h: 720 });
  const paneRef = useRef<Size>(pane);
  const remote = resolveRemoteSize(pane, display);
  paneRef.current = pane;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    let pending = false;
    const apply = () => {
      const next = readStablePane(el, paneRef.current);
      if (!next) {
        pending = document.visibilityState !== 'visible';
        return;
      }
      pending = false;
      if (next === paneRef.current) return;
      paneRef.current = next;
      setPane(next);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && pending) apply();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    onPaneChange(pane);
  }, [pane, onPaneChange]);

  return (
    <div ref={wrapRef} className="absolute inset-0 bg-black">
      {busy || !windowId ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <Loader2Icon className="size-5 animate-spin" />
          正在打开窗口
        </div>
      ) : (
        <VncViewer
          sessionId={session.id}
          subId={vncWindowExtra(windowId)}
          focused
          title={session.name}
          remoteWidth={remote.w}
          remoteHeight={remote.h}
          sizeTick={sizeTick}
          occupancyId={occupancyId}
          onFocus={() => undefined}
        />
      )}
    </div>
  );
}
