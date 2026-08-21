import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { ProxyRecord } from '@nya/shared';
import { regionFromLoc } from '@nya/shared';
import { api } from '../../api/client';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function testLabel(p: ProxyRecord) {
  const t = p.lastTest;
  if (!t) return '-';
  if (!t.ok) return t.error || '失败';
  const region = t.region || regionFromLoc(t.loc) || t.loc || '';
  const colo = t.colo ? ` ${t.colo}` : '';
  const ip = t.exitIp || '';
  const ms = t.latencyMs != null ? `${t.latencyMs}ms` : '';
  return [region + colo, ip, ms].filter(Boolean).join(' · ');
}

export default function ProxiesPage() {
  const [rows, setRows] = useState<ProxyRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProxyRecord | null>(null);
  const [pending, setPending] = useState<ProxyRecord | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<ProxyRecord['type']>('http');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('1080');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

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
    setType('http');
    setHost('');
    setPort('1080');
    setUsername('');
    setPassword('');
    setOpen(true);
  };

  const startEdit = (p: ProxyRecord) => {
    setEditing(p);
    setName(p.name);
    setType(p.type);
    setHost(p.host);
    setPort(String(p.port));
    setUsername(p.username);
    setPassword('');
    setOpen(true);
  };

  const save = () => {
    const payload = {
      name,
      type,
      host,
      port: Number(port),
      username,
    };
    const req = editing
      ? api.updateProxy(editing.id, {
          ...payload,
          ...(password ? { password } : {}),
        })
      : api.createProxy({ ...payload, password });
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
        <h2 className="text-lg font-semibold">代理管理</h2>
        <Button onClick={startCreate}>添加代理</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>类型</TableHead>
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
              <TableCell>{p.type}</TableCell>
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
                  <Badge variant={p.lastTest.ok ? 'secondary' : 'destructive'}>{testLabel(p)}</Badge>
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
        <DialogContent>
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
            <div className="grid gap-2">
              <Label>类型</Label>
              <Select value={type} onValueChange={(v: string) => setType(v as ProxyRecord['type'])}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="http">HTTP</SelectItem>
                  <SelectItem value="https">HTTPS</SelectItem>
                  <SelectItem value="socks5">SOCKS5</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="proxy-host">主机</Label>
              <Input id="proxy-host" value={host} onChange={(e) => setHost(e.target.value)} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="proxy-port">端口</Label>
              <Input
                id="proxy-port"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="proxy-user">用户名</Label>
              <Input id="proxy-user" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="proxy-pass">密码</Label>
              <Input
                id="proxy-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {editing ? <p className="text-xs text-muted-foreground">留空则不修改</p> : null}
            </div>
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
                void api.deleteProxy(pending.id).then(load);
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
