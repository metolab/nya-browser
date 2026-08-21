import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDownIcon } from 'lucide-react';
import type { MonitorSnapshot, Session } from '@nya/shared';
import { api } from '../../api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

function mb(n: number) {
  return `${Math.round((n || 0) / 1024 / 1024)} MB`;
}

const APP_LOG = '__app__';

export default function MonitorPage() {
  const [snap, setSnap] = useState<MonitorSnapshot | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [logSession, setLogSession] = useState(APP_LOG);
  const [logFile, setLogFile] = useState('chrome');
  const [log, setLog] = useState('');

  const load = useCallback(async () => {
    const [m, s] = await Promise.all([api.monitor(), api.listSessions()]);
    setSnap(m.monitor);
    setSessions(s.sessions);
  }, []);

  useEffect(() => {
    void load().catch((e: Error) => toast.error(e.message));
    const t = window.setInterval(() => void load().catch(() => undefined), 3000);
    return () => window.clearInterval(t);
  }, [load]);

  const host = snap?.host;

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">系统监控</h2>
        <Button variant="outline" onClick={() => void load()}>
          刷新
        </Button>
      </div>
      {host && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">负载</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{host.loadavg[0]?.toFixed(2)}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">CPU</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{host.cpuPercent.toFixed(1)}%</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">内存</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {mb(host.memory.usedBytes)}
              <span className="text-sm font-normal text-muted-foreground"> / {mb(host.memory.totalBytes)}</span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">磁盘</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {mb(host.disk.usedBytes)}
              <span className="text-sm font-normal text-muted-foreground"> / {mb(host.disk.totalBytes)}</span>
            </CardContent>
          </Card>
        </div>
      )}
      <div className="grid gap-2">
        {(snap?.sessions || []).map((r) => (
          <Collapsible key={r.sessionId} className="rounded-lg border">
            <div className="flex items-center gap-3 p-3">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  <ChevronDownIcon />
                </Button>
              </CollapsibleTrigger>
              <div className="min-w-0 flex-1 font-medium">{r.name}</div>
              <div className="text-sm text-muted-foreground">{mb(r.chrome.rssBytes)}</div>
              <div className="text-sm text-muted-foreground">{r.chrome.cpuPercent}%</div>
              <div className="text-sm text-muted-foreground">{r.windows.length} 窗口</div>
            </div>
            <CollapsibleContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>窗口</TableHead>
                    <TableHead>操作者</TableHead>
                    <TableHead>显示栈</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.windows.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell>{w.id}</TableCell>
                      <TableCell>{w.ownerUsername}</TableCell>
                      <TableCell>{w.usage ? mb(w.usage.rssBytes) : '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>日志</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={logSession} onValueChange={setLogSession}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="应用日志" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={APP_LOG}>应用日志</SelectItem>
                {sessions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={logFile} onValueChange={setLogFile}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['chrome', 'x11vnc', 'openbox', 'xvfb'].map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={() => {
                void (async () => {
                  if (logSession && logSession !== APP_LOG) {
                    const d = await api.sessionLog(logSession, logFile);
                    setLog(d.content);
                  } else {
                    const d = await api.appLog(400);
                    setLog(d.content);
                  }
                })();
              }}
            >
              读取
            </Button>
          </div>
          <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 text-xs">
            {log || '点击读取'}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
