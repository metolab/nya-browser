import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDownIcon, EyeIcon, MousePointer2Icon } from 'lucide-react';
import type { LiveSession, SessionWindow } from '@nya/shared';
import { api } from '../../api/client';
import VncViewer from '../../components/VncViewer';
import { vncWindowExtra } from '../../lib/vnc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type ViewTarget = { sessionId: string; window: SessionWindow; name: string };

function windowSize(w: SessionWindow) {
  const width = w.width > 0 ? w.width : 1280;
  const height = w.height > 0 ? w.height : 720;
  return { width, height };
}

export default function LivePage() {
  const [rows, setRows] = useState<LiveSession[]>([]);
  const [view, setView] = useState<ViewTarget | null>(null);
  const [control, setControl] = useState(false);

  const load = useCallback(async () => {
    const data = await api.live();
    setRows(data.sessions);
  }, []);

  useEffect(() => {
    void load().catch((e: Error) => toast.error(e.message));
    const t = window.setInterval(() => void load().catch(() => undefined), 3000);
    return () => window.clearInterval(t);
  }, [load]);

  const geom = view ? windowSize(view.window) : { width: 1280, height: 720 };

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">在线会话</h2>
        <Button variant="outline" onClick={() => void load()}>
          刷新
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无在线会话</p>
      ) : null}
      <div className="grid gap-2">
        {rows.map((r) => (
          <Collapsible key={r.session.id} defaultOpen className="rounded-lg border">
            <div className="flex items-center gap-3 p-3">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="[&[data-state=open]>svg]:rotate-180">
                  <ChevronDownIcon className="transition-transform" />
                </Button>
              </CollapsibleTrigger>
              <div className="min-w-0 flex-1 font-medium">{r.session.name}</div>
              <div className="text-sm text-muted-foreground">
                {Math.round((r.chrome.rssBytes || 0) / 1024 / 1024)} MB / {r.chrome.cpuPercent}%
              </div>
              <div className="text-sm text-muted-foreground">{r.windows.length} 窗口</div>
              <div className="text-sm text-muted-foreground">观看 {r.viewerCount}</div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void api.restartSession(r.session.id).then(load)}
              >
                重启
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void api.stopSession(r.session.id).then(load)}
              >
                停止
              </Button>
            </div>
            <CollapsibleContent>
              {r.windows.length === 0 ? (
                <p className="px-3 pb-3 text-sm text-muted-foreground">没有窗口</p>
              ) : (
                <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
                  {r.windows.map((w) => {
                    const size = windowSize(w);
                    return (
                      <Card key={w.id} size="sm">
                        <CardHeader>
                          <CardTitle className="truncate">{w.ownerUsername || '空闲'}</CardTitle>
                          <CardDescription>
                            {w.id} · {size.width}×{size.height}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="text-muted-foreground">
                          VNC {w.vncConnections}
                          {w.usage ? ` · ${Math.round((w.usage.rssBytes || 0) / 1024 / 1024)} MB` : ''}
                        </CardContent>
                        <CardFooter className="justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setControl(false);
                              setView({ sessionId: r.session.id, window: w, name: r.session.name });
                            }}
                          >
                            <EyeIcon />
                            观看
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => void api.closeWindow(r.session.id, w.id).then(load)}
                          >
                            关闭
                          </Button>
                        </CardFooter>
                      </Card>
                    );
                  })}
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>

      <Dialog
        open={Boolean(view)}
        onOpenChange={(open: boolean) => {
          if (!open) {
            setView(null);
            setControl(false);
          }
        }}
      >
        <DialogContent
          className="flex w-auto max-h-[calc(100vh-2rem)] max-w-[calc(100vw-2rem)] flex-col gap-3 overflow-hidden sm:max-w-none"
          style={{ width: Math.min(geom.width + 32, typeof window === 'undefined' ? geom.width : window.innerWidth - 32) }}
        >
          <DialogHeader>
            <DialogTitle>{view ? `观看 ${view.name}` : '观看'}</DialogTitle>
            <DialogDescription>
              {view
                ? `${view.window.ownerUsername || view.window.id} · ${geom.width}×${geom.height}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {view ? (
            <div className="min-h-0 flex-1 overflow-auto bg-black">
              <div style={{ width: geom.width, height: geom.height }}>
                <VncViewer
                  sessionId={view.sessionId}
                  subId={vncWindowExtra(view.window.id)}
                  focused
                  title={view.name}
                  remoteWidth={geom.width}
                  remoteHeight={geom.height}
                  viewOnly={!control}
                  resizeRemote={false}
                  onFocus={() => undefined}
                />
              </div>
            </div>
          ) : null}
          <DialogFooter className="sm:justify-between">
            <p className="self-center text-xs text-muted-foreground">
              {control ? '已开启操控（仅鼠标和键盘）' : '当前为观看模式，不会改变会话分辨率'}
            </p>
            <Button
              variant={control ? 'outline' : 'default'}
              onClick={() => setControl((v) => !v)}
            >
              <MousePointer2Icon />
              {control ? '停止操控' : '开启操控'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
