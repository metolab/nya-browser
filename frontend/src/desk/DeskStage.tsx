import { useEffect, useRef, useState } from 'react';
import { Loader2Icon, SettingsIcon, XIcon } from 'lucide-react';
import type { Session } from '@nya/shared';
import VncViewer from '../components/VncViewer';
import DisplaySettings from './DisplaySettings';
import {
  defaultDisplayPolicy,
  formatSize,
  resolveRemoteSize,
  type DisplayPolicy,
} from './display';
import { vncWindowExtra } from '../lib/vnc';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type Props = {
  session: Session;
  windowId: string;
  occupancyId: string | null;
  busy: boolean;
  onClose: () => void;
};

export default function DeskStage({ session, windowId, occupancyId, busy, onClose }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState({ w: 1280, h: 720 });
  const [display, setDisplay] = useState<DisplayPolicy>(defaultDisplayPolicy);
  const [sizeTick, setSizeTick] = useState(0);
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

  return (
    <div ref={wrapRef} className="desk-win is-focused absolute inset-0">
      <div className="desk-win-body">
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
      <div className="desk-win-hit-top" />
      <div className="desk-win-chrome" style={{ cursor: 'default' }}>
        <span className="min-w-0 flex-1 truncate text-xs">{session.name}</span>
        <span className="text-[10px] opacity-70">{formatSize(remote)}</span>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-white hover:bg-white/15 hover:text-white"
              aria-label="显示设置"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <SettingsIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="end" className="w-72">
            <DisplaySettings
              policy={display}
              pane={pane}
              onChange={(next) => {
                setDisplay(next);
                setSizeTick((n) => n + 1);
              }}
            />
          </PopoverContent>
        </Popover>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-white hover:bg-white/15 hover:text-white"
          aria-label="关闭"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>
    </div>
  );
}
