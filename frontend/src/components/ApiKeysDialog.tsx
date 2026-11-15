import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CopyIcon, Trash2Icon } from 'lucide-react';
import { api, type ApiKey } from '../api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : '—';
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success('已复制');
  } catch {
    toast.error('复制失败');
  }
}

export default function ApiKeysDialog({ open, onOpenChange }: Props) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState('');
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [pending, setPending] = useState<ApiKey | null>(null);

  const load = useCallback(async () => {
    const data = await api.listApiKeys();
    setKeys(data.apiKeys);
  }, []);

  useEffect(() => {
    if (!open) return;
    setName('');
    setDays('');
    setCreated(null);
    void load().catch((e: Error) => toast.error(e.message));
  }, [open, load]);

  const create = async () => {
    const n = days.trim() ? Number(days) : null;
    if (n !== null && (!Number.isInteger(n) || n < 1)) {
      toast.error('有效天数需为正整数');
      return;
    }
    setBusy(true);
    try {
      const data = await api.createApiKey(name.trim(), n);
      setCreated(data.key);
      setName('');
      setDays('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (key: ApiKey) => {
    try {
      await api.deleteApiKey(key.id);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>API Keys</DialogTitle>
          <DialogDescription>
            供 SDK 和自动化程序使用，权限与当前账号相同。Key 只在创建时显示一次。
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3 sm:grid-cols-[1fr_9rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="api-key-name">名称</Label>
            <Input
              id="api-key-name"
              value={name}
              maxLength={64}
              placeholder="例如 agent-prod"
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="api-key-days">有效天数</Label>
            <Input
              id="api-key-days"
              inputMode="numeric"
              value={days}
              placeholder="永不过期"
              onChange={(e) => setDays(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy || !name.trim()}>
            创建
          </Button>
        </form>
        {created ? (
          <div className="grid gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
            <div className="text-sm font-medium">新的 API Key（关闭后无法再次查看）</div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1 font-mono text-xs">{created}</code>
              <Button variant="outline" size="icon-sm" onClick={() => void copyText(created)}>
                <CopyIcon />
              </Button>
            </div>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-auto">
          {keys.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">还没有 API Key</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>前缀</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>最后使用</TableHead>
                  <TableHead>过期时间</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="max-w-40 truncate">{key.name}</TableCell>
                    <TableCell className="font-mono text-xs">{key.prefix}…</TableCell>
                    <TableCell className="text-xs">{formatTime(key.createdAt)}</TableCell>
                    <TableCell className="text-xs">{formatTime(key.lastUsedAt)}</TableCell>
                    <TableCell className="text-xs">{key.expiresAt ? formatTime(key.expiresAt) : '永不'}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon-xs" onClick={() => setPending(key)}>
                        <Trash2Icon />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
      <AlertDialog open={Boolean(pending)} onOpenChange={(v: boolean) => !v && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 {pending?.name}?</AlertDialogTitle>
            <AlertDialogDescription>使用这个 Key 的程序会立即失去访问权限。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (pending) void remove(pending);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
