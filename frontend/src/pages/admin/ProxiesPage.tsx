import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { ProxyRecord } from '@nya/shared';
import { regionFromLoc } from '@nya/shared';
import { api } from '../../api/client';
import ProxyFields, {
  PROXY_TYPE_LABELS,
  emptyProxyDraft,
  proxyDraftFrom,
  proxyDraftPayload,
  proxyTestLabel,
  type ProxyDraft,
} from '@/components/ProxyFields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export default function ProxiesPage() {
  const [rows, setRows] = useState<ProxyRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProxyRecord | null>(null);
  const [pending, setPending] = useState<ProxyRecord | null>(null);
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<ProxyDraft>(emptyProxyDraft());

  const load = useCallback(async () => {
    const d = await api.listProxies();
    setRows(d.proxies);
  }, []);

  useEffect(() => {
    void load().catch((e: Error) => toast.error(e.message));
  }, [load]);

  const startCreate = () => {
    setEditing(null);
    setName('');
    setDraft(emptyProxyDraft());
    setOpen(true);
  };

  const startEdit = (p: ProxyRecord) => {
    setEditing(p);
    setName(p.name);
    setDraft({ ...proxyDraftFrom(p), password: '' });
    setOpen(true);
  };

  const save = () => {
    const { password, ...payload } = proxyDraftPayload(draft);
    const req = editing
      ? api.updateProxy(editing.id, {
          name,
          ...payload,
          ...(password ? { password } : {}),
        })
      : api.createProxy({ name, ...payload, password });
    void req
      .then(() => {
        toast.success(editing ? '已保存' : '已添加');
        setOpen(false);
        setEditing(null);
        return load();
      })
      .catch((e: Error) => toast.error(e.message));
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">代理管理</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            常用代理存在这里；一次性的代理可以直接在会话里设为临时代理，不必先添加
          </p>
        </div>
        <Button onClick={startCreate}>添加代理</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>类型</TableHead>
            <TableHead>前置</TableHead>
            <TableHead>地址</TableHead>
            <TableHead>地区</TableHead>
            <TableHead>最近测试</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.name}</TableCell>
              <TableCell>{PROXY_TYPE_LABELS[p.type] || p.type}</TableCell>
              <TableCell>
                {p.viaProxyId ? rows.find((r) => r.id === p.viaProxyId)?.name || p.viaProxyId : '-'}
              </TableCell>
              <TableCell>
                {p.host}:{p.port}
              </TableCell>
              <TableCell>
                {(() => {
                  const t = p.lastTest;
                  if (!t?.ok) return '-';
                  const region = t.region || regionFromLoc(t.loc) || t.loc;
                  return region ? `${region}${t.colo ? ` · ${t.colo}` : ''}` : '-';
                })()}
              </TableCell>
              <TableCell>
                {p.lastTest ? (
                  <Badge variant={p.lastTest.ok ? 'secondary' : 'destructive'}>{proxyTestLabel(p.lastTest)}</Badge>
                ) : (
                  '-'
                )}
              </TableCell>
              <TableCell className="text-right">
                <div className="inline-flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void api
                        .testProxy(p.id)
                        .then((r) => {
                          const t = r.result;
                          toast.message(
                            t.ok
                              ? `${t.region || t.loc || ''} ${t.colo || ''} ${t.exitIp || ''} · ${t.latencyMs}ms`
                              : t.error || '失败',
                          );
                          return load();
                        })
                        .catch((e: Error) => toast.error(e.message))
                    }
                  >
                    测试
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => startEdit(p)}>
                    编辑
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => setPending(p)}>
                    删除
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog
        open={open}
        onOpenChange={(v: boolean) => {
          if (!v) {
            setOpen(false);
            setEditing(null);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑代理' : '添加代理'}</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="proxy-name">名称</Label>
              <Input id="proxy-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <ProxyFields
              idPrefix="proxy"
              value={draft}
              onChange={setDraft}
              fronts={rows.filter((r) => r.id !== editing?.id)}
              savedPassword={editing ? editing.password : undefined}
              onParsedName={(parsed) => setName((cur) => cur || parsed)}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="submit">保存</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(pending)} onOpenChange={(v: boolean) => !v && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 {pending?.name}?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!pending) return;
                void api
                  .deleteProxy(pending.id)
                  .then(load)
                  .catch((e: Error) => toast.error(e.message));
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
