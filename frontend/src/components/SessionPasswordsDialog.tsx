import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CopyIcon, EyeIcon, EyeOffIcon } from 'lucide-react';
import type { Session, SessionPassword } from '@nya/shared';
import { api } from '../api/client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function passwordKey(entry: SessionPassword) {
  return `${entry.origin}\n${entry.username}`;
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success('已复制');
  } catch {
    toast.error('复制失败');
  }
}

export function SessionPasswordsDialog({
  session,
  onClose,
}: {
  session: Session | null;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<SessionPassword[]>([]);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!session) {
      setRows([]);
      setVisible(new Set());
      return;
    }
    setLoading(true);
    void api
      .listSessionPasswords(session.id)
      .then((data) => setRows(data.passwords))
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [session]);

  return (
    <Dialog open={Boolean(session)} onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>密码 · {session?.name || ''}</DialogTitle>
          <DialogDescription>
            浏览器保存的登录信息会出现在这里，导出/导入会话时会一并带走。
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">读取中…</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              还没有保存的密码。在浏览器登录时选择保存后，会出现在这里。
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>网页</TableHead>
                  <TableHead>账号</TableHead>
                  <TableHead>密码</TableHead>
                  <TableHead>备注</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const key = passwordKey(row);
                  const shown = visible.has(key);
                  return (
                    <TableRow key={key}>
                      <TableCell className="max-w-52 whitespace-normal">
                        <div className="break-all" title={row.origin}>
                          {row.origin}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <span className="max-w-36 truncate" title={row.username}>
                            {row.username || '—'}
                          </span>
                          {row.username ? (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => void copyText(row.username)}
                            >
                              <CopyIcon />
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <span className="max-w-36 truncate font-mono text-xs">
                            {shown ? row.password || '—' : row.password ? '••••••••' : '—'}
                          </span>
                          {row.password ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={() =>
                                  setVisible((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(key)) next.delete(key);
                                    else next.add(key);
                                    return next;
                                  })
                                }
                              >
                                {shown ? <EyeOffIcon /> : <EyeIcon />}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => void copyText(row.password)}
                              >
                                <CopyIcon />
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-56 whitespace-normal">
                        <div className="break-words text-muted-foreground">{row.note || '—'}</div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
