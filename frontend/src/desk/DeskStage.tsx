import { useEffect, useRef, useState } from 'react';
import { Loader2Icon } from 'lucide-react';
import type { Session } from '@nya/shared';
import VncViewer from '../components/VncViewer';
import { resolveRemoteSize, type DisplayPolicy, type Size } from './display';
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
  const remote = resolveRemoteSize(pane, display);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const apply = () => {
      const rect = el.getBoundingClientRect();
      setPane({ w: Math.max(1, Math.round(rect.width)), h: Math.max(1, Math.round(rect.height)) });
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
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
