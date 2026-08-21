import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
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

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [action, setAction] = useState('');

  const load = useCallback(async () => {
    const q: Record<string, string> = { limit: '200' };
    if (action) q.action = action;
    const d = await api.audit(q);
    setLogs(d.logs);
  }, [action]);

  useEffect(() => {
    void load().catch((e: Error) => toast.error(e.message));
  }, [load]);

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">审计日志</h2>
        <div className="flex items-center gap-2">
          <Input
            placeholder="动作，如 login"
            value={action}
            className="w-52"
            onChange={(e) => setAction(e.target.value)}
          />
          <Button variant="outline" onClick={() => void load()}>
            筛选
          </Button>
        </div>
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
          {logs.map((r) => (
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
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
