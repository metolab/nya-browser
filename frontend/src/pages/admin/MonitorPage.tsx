import { Fragment, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDownIcon } from 'lucide-react';
import type { GpuUsage, MonitorSnapshot, Session, SessionUsage } from '@nya/shared';
import { api } from '../../api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { cn } from '@/lib/utils';

function fmtBytes(n: number) {
  const bytes = n || 0;
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function fmtCpu(n: number) {
  return `${(n || 0).toFixed(1)}%`;
}

function fmtGpu(gpu?: GpuUsage) {
  if (!gpu?.available) return '—';
  const mem = fmtBytes(gpu.memBytes);
  return gpu.utilPercent > 0 ? `${fmtCpu(gpu.utilPercent)} · ${mem}` : mem;
}

function mb(n: number) {
  return fmtBytes(n);
}

const APP_LOG = '__app__';

function SessionUsageTable({ rows }: { rows: SessionUsage[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  if (!rows.length) {
    return <p className="px-1 text-sm text-muted-foreground">暂无会话</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8" />
          <TableHead>会话</TableHead>
          <TableHead>状态</TableHead>
          <TableHead className="text-right">CPU</TableHead>
          <TableHead className="text-right">内存</TableHead>
          <TableHead className="text-right">GPU</TableHead>
          <TableHead className="text-right">磁盘</TableHead>
          <TableHead className="text-right">窗口</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const expanded = open.has(r.sessionId);
          return (
            <Fragment key={r.sessionId}>
              <TableRow className={cn(!r.running && 'text-muted-foreground')}>
                <TableCell className="w-8 pr-0">
                  {r.running && r.windows.length ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => {
                        setOpen((prev) => {
                          const copy = new Set(prev);
                          if (copy.has(r.sessionId)) copy.delete(r.sessionId);
                          else copy.add(r.sessionId);
                          return copy;
                        });
                      }}
                    >
                      <ChevronDownIcon className={cn('transition-transform', expanded && 'rotate-180')} />
                    </Button>
                  ) : null}
                </TableCell>
                <TableCell className={cn('font-medium', r.running && 'text-foreground')}>{r.name}</TableCell>
                <TableCell>
                  <Badge variant={r.running ? 'secondary' : 'outline'}>{r.running ? '运行中' : '未运行'}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.running ? fmtCpu(r.cpuPercent) : '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{r.running ? fmtBytes(r.rssBytes) : '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{r.running ? fmtGpu(r.gpu) : '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtBytes(r.diskBytes)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.running ? r.windows.length : '—'}</TableCell>
              </TableRow>
              {expanded && r.running ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={8} className="bg-muted/40 p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="pl-12">窗口</TableHead>
                          <TableHead>操作者</TableHead>
                          <TableHead className="text-right">CPU</TableHead>
                          <TableHead className="text-right">内存</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {r.windows.map((w) => (
                          <TableRow key={w.id}>
                            <TableCell className="pl-12">{w.id}</TableCell>
                            <TableCell>{w.ownerUsername || '空闲'}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {w.usage ? fmtCpu(w.usage.cpuPercent) : '—'}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {w.usage ? fmtBytes(w.usage.rssBytes) : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

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
              <CardTitle className="text-sm font-medium text-muted-foreground">本项目 CPU</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{host.cpuPercent.toFixed(1)}%</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">本项目内存</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {mb(host.memory.usedBytes)}
              <span className="text-sm font-normal text-muted-foreground"> / {mb(host.memory.totalBytes)}</span>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">本项目磁盘</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {mb(host.disk.usedBytes)}
              <span className="text-sm font-normal text-muted-foreground"> / {mb(host.disk.totalBytes)}</span>
            </CardContent>
          </Card>
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>会话占用</CardTitle>
        </CardHeader>
        <CardContent className="max-h-[min(40rem,70vh)] overflow-auto">
          <SessionUsageTable rows={snap?.sessions || []} />
        </CardContent>
      </Card>
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
