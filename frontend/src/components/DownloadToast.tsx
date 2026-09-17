import { useEffect, useRef, useState } from 'react';
import { XIcon } from 'lucide-react';
import type { SessionDownload } from '@nya/shared';
import { Button } from '@/components/ui/button';
import { formatBytes, hostOf } from '../lib/files';

type Props = {
  sessionId?: string;
  ready: boolean;
  downloads: SessionDownload[];
  onOpen: (path: string, name: string) => void;
  onSave: (path: string, name: string, size: number) => void;
};

const HOLD_MS = 8000;

export default function DownloadToast({ sessionId, ready, downloads, onOpen, onSave }: Props) {
  const [held, setHeld] = useState<Record<string, number>>({});
  const seen = useRef(new Set<string>());
  const primed = useRef(false);

  useEffect(() => {
    primed.current = false;
    seen.current.clear();
    setHeld({});
  }, [sessionId]);

  useEffect(() => {
    if (!ready) return undefined;
    const now = Date.now();
    if (!primed.current) {
      for (const row of downloads) {
        if (row.state !== 'in_progress') seen.current.add(row.id);
      }
      primed.current = true;
    }
    setHeld((prev) => {
      const next = { ...prev };
      for (const row of downloads) {
        if ((row.state === 'completed' || row.state === 'failed') && !seen.current.has(row.id)) {
          seen.current.add(row.id);
          next[row.id] = now + HOLD_MS;
        }
        if (row.state === 'in_progress') seen.current.add(row.id);
      }
      for (const id of Object.keys(next)) {
        if (next[id] < now) delete next[id];
      }
      return next;
    });
    const timer = window.setInterval(() => {
      setHeld((prev) => {
        const nowTick = Date.now();
        const next = { ...prev };
        let changed = false;
        for (const id of Object.keys(next)) {
          if (next[id] < nowTick) {
            delete next[id];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [downloads, ready]);

  const visible = downloads.filter(
    (row) =>
      row.state === 'in_progress' ||
      ((row.state === 'completed' || row.state === 'failed') && held[row.id]),
  );
  if (!visible.length) return null;

  return (
    <div className="pointer-events-none fixed right-3 bottom-3 z-[60] flex w-80 flex-col gap-2">
      {visible.map((row) => {
        const active = row.state === 'in_progress';
        const total = row.totalBytes || row.receivedBytes;
        const ratio = total > 0 ? Math.min(1, row.receivedBytes / total) : active ? 0.15 : 1;
        return (
          <div
            key={row.id}
            className="pointer-events-auto rounded-xl border bg-card/95 p-2 shadow-lg backdrop-blur-md"
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium">
                  {active ? '正在下载' : row.state === 'failed' ? '下载失败' : '下载完成'}
                </div>
                <div className="truncate text-sm">{row.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {formatBytes(row.receivedBytes)}
                  {row.totalBytes ? ` / ${formatBytes(row.totalBytes)}` : ''}
                  {row.url ? ` · ${hostOf(row.url)}` : ''}
                </div>
              </div>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="关闭"
                onClick={() => setHeld((prev) => ({ ...prev, [row.id]: 0 }))}
              >
                <XIcon />
              </Button>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded bg-muted">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${Math.round(ratio * 100)}%` }} />
            </div>
            <div className="mt-1 flex justify-end gap-1">
              {!row.missing ? (
                <Button size="xs" variant="outline" onClick={() => onOpen(row.path, row.name)}>
                  打开
                </Button>
              ) : null}
              {row.state === 'completed' && !row.missing ? (
                <Button size="xs" onClick={() => onSave(row.path, row.name, row.totalBytes || row.receivedBytes)}>
                  下载到本机
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
