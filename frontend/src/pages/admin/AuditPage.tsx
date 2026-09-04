import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { AuditLog } from '@nya/shared';
import { api } from '../../api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const PAGE_SIZE = 50;

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState('');
  const [action, setAction] = useState('');

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(async () => {
    const q: Record<string, string> = {
      limit: String(PAGE_SIZE),
      offset: String((page - 1) * PAGE_SIZE),
    };
    if (action) q.action = action;
    const d = await api.audit(q);
    setLogs(d.logs);
    setTotal(d.total);
    const last = Math.max(1, Math.ceil((d.total || 0) / PAGE_SIZE));
    if (page > last) setPage(last);
  }, [action, page]);

  useEffect(() => {
    void load().catch((e: Error) => toast.error(e.message));
  }, [load]);

  const applyFilter = (event?: FormEvent) => {
    event?.preventDefault();
    const next = draft.trim();
    setPage(1);
    setAction(next);
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">审计日志</h2>
        <form className="flex items-center gap-2" onSubmit={applyFilter}>
          <Input
            placeholder="动作，如 login"
            value={draft}
            className="w-52"
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button variant="outline" type="submit">
            筛选
          </Button>
        </form>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>时间</TableHead>
            <TableHead>用户</TableHead>
            <TableHead>动作</TableHead>
            <TableHead>资源</TableHead>
            <TableHead>结果</TableHead>
            <TableHead>IP</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.length ? (
            logs.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.at}</TableCell>
                <TableCell>{r.actorUsername}</TableCell>
                <TableCell>{r.action}</TableCell>
                <TableCell>
                  {r.resourceType || ''} {r.resourceId || ''}
                </TableCell>
                <TableCell>
                  <Badge variant={r.success ? 'secondary' : 'destructive'}>
                    {r.success ? '成功' : '失败'}
                  </Badge>
                </TableCell>
                <TableCell>{r.ip}</TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={6} className="text-muted-foreground">
                没有审计记录
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <div>
          共 {total} 条
          {action ? ` · 动作 ${action}` : ''}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeftIcon />
            上一页
          </Button>
          <span className="tabular-nums">
            第 {Math.min(page, pages)} / {pages} 页
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
            <ChevronRightIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}
