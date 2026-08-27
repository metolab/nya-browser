import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { ProxyExtra, ProxyRecord } from '@nya/shared';
import {
  emptyProxyExtra,
  parseProxyUri,
  regionFromLoc,
  SS_METHODS,
  TLS_FINGERPRINTS,
} from '@nya/shared';
import { api } from '../../api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
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

const TYPE_LABELS: Record<ProxyRecord['type'], string> = {
  http: 'HTTP',
  https: 'HTTPS',
  socks5: 'SOCKS5',
  anytls: 'AnyTLS',
  ss: 'Shadowsocks',
  vless: 'VLESS',
};

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

function needsUser(type: ProxyRecord['type']) {
  return type === 'http' || type === 'https' || type === 'socks5';
}

function needsSni(type: ProxyRecord['type']) {
  return type === 'https' || type === 'anytls' || type === 'vless';
}

export default function ProxiesPage() {
  const [rows, setRows] = useState<ProxyRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProxyRecord | null>(null);
  const [pending, setPending] = useState<ProxyRecord | null>(null);
  const [uri, setUri] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<ProxyRecord['type']>('http');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('1080');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [extra, setExtra] = useState<ProxyExtra>(emptyProxyExtra());

  const load = useCallback(async () => {
    const d = await api.listProxies();
    setRows(d.proxies);
  }, []);

  useEffect(() => {
    void load().catch((e: Error) => toast.error(e.message));
  }, [load]);

  const patchExtra = (patch: Partial<ProxyExtra>) => setExtra((cur) => ({ ...cur, ...patch }));

  const startCreate = () => {
    setEditing(null);
    setUri('');
    setName('');
    setType('http');
    setHost('');
    setPort('1080');
    setUsername('');
    setPassword('');
    setExtra(emptyProxyExtra());
    setOpen(true);
  };

  const startEdit = (p: ProxyRecord) => {
    setEditing(p);
    setUri('');
    setName(p.name);
    setType(p.type);
    setHost(p.host);
    setPort(String(p.port));
    setUsername(p.username);
    setPassword('');
    setExtra({ ...emptyProxyExtra(), ...p.extra });
    setOpen(true);
  };

  const applyUri = () => {
    try {
      const parsed = parseProxyUri(uri);
      setType(parsed.type);
      setHost(parsed.host);
      setPort(String(parsed.port));
      setUsername(parsed.username);
      setPassword(parsed.password);
      setExtra({ ...emptyProxyExtra(), ...parsed.extra });
      if (parsed.name && !name) setName(parsed.name);
      toast.success('已解析链接');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '无法解析链接');
    }
  };

  const save = () => {
    const payload = {
      name,
      type,
      host,
      port: Number(port),
      username: needsUser(type) ? username : '',
      extra,
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

  const passwordLabel = type === 'vless' ? 'UUID' : '密码';
  const showTls = needsSni(type);
  const showInsecure = type === 'https' || type === 'anytls' || (type === 'vless' && extra.security !== 'none');

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
              <TableCell>{TYPE_LABELS[p.type] || p.type}</TableCell>
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
              <Label htmlFor="proxy-uri">分享链接</Label>
              <Textarea
                id="proxy-uri"
                value={uri}
                onChange={(e) => setUri(e.target.value)}
                placeholder="anytls://、ss://、vless://、socks5://、http://"
              />
              <Button type="button" variant="outline" size="sm" onClick={applyUri} disabled={!uri.trim()}>
                解析并填入
              </Button>
            </div>
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
                  <SelectItem value="http">HTTP 代理</SelectItem>
                  <SelectItem value="https">HTTPS 代理（连代理走 TLS）</SelectItem>
                  <SelectItem value="socks5">SOCKS5</SelectItem>
                  <SelectItem value="anytls">AnyTLS</SelectItem>
                  <SelectItem value="ss">Shadowsocks</SelectItem>
                  <SelectItem value="vless">VLESS</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Chrome 只连本机 HTTP，协议由 sing-box sidecar 处理
              </p>
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
            {needsUser(type) ? (
              <div className="grid gap-2">
                <Label htmlFor="proxy-user">用户名</Label>
                <Input id="proxy-user" value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="proxy-pass">{passwordLabel}</Label>
              <Input
                id="proxy-pass"
                type={type === 'vless' ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={!editing}
              />
              {editing ? <p className="text-xs text-muted-foreground">留空则不修改</p> : null}
            </div>
            {type === 'ss' ? (
              <div className="grid gap-2">
                <Label>加密</Label>
                <Select value={extra.method} onValueChange={(v: string) => patchExtra({ method: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SS_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {type === 'vless' ? (
              <>
                <div className="grid gap-2">
                  <Label>传输</Label>
                  <Select
                    value={extra.network}
                    onValueChange={(v: string) => patchExtra({ network: v as ProxyExtra['network'] })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tcp">TCP</SelectItem>
                      <SelectItem value="ws">WebSocket</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {extra.network === 'ws' ? (
                  <>
                    <div className="grid gap-2">
                      <Label htmlFor="proxy-ws-path">WS path</Label>
                      <Input
                        id="proxy-ws-path"
                        value={extra.wsPath}
                        onChange={(e) => patchExtra({ wsPath: e.target.value })}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="proxy-ws-host">WS host</Label>
                      <Input
                        id="proxy-ws-host"
                        value={extra.wsHost}
                        onChange={(e) => patchExtra({ wsHost: e.target.value })}
                      />
                    </div>
                  </>
                ) : null}
                <div className="grid gap-2">
                  <Label>TLS</Label>
                  <Select
                    value={extra.security}
                    onValueChange={(v: string) => patchExtra({ security: v as ProxyExtra['security'] })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">无</SelectItem>
                      <SelectItem value="tls">TLS</SelectItem>
                      <SelectItem value="reality">Reality</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="proxy-flow">flow</Label>
                  <Input
                    id="proxy-flow"
                    value={extra.flow}
                    onChange={(e) => patchExtra({ flow: e.target.value })}
                    placeholder="xtls-rprx-vision"
                  />
                </div>
              </>
            ) : null}
            {showTls ? (
              <div className="grid gap-2">
                <Label htmlFor="proxy-sni">SNI</Label>
                <Input
                  id="proxy-sni"
                  value={extra.sni}
                  onChange={(e) => patchExtra({ sni: e.target.value })}
                  placeholder="留空则用主机名"
                />
              </div>
            ) : null}
            {type === 'vless' && extra.security !== 'none' ? (
              <div className="grid gap-2">
                <Label>uTLS 指纹</Label>
                <Select
                  value={extra.fingerprint || 'chrome'}
                  onValueChange={(v: string) => patchExtra({ fingerprint: v })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TLS_FINGERPRINTS.map((fp) => (
                      <SelectItem key={fp} value={fp}>
                        {fp}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {type === 'vless' && extra.security === 'reality' ? (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="proxy-pbk">Reality public key</Label>
                  <Input
                    id="proxy-pbk"
                    value={extra.publicKey}
                    onChange={(e) => patchExtra({ publicKey: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="proxy-sid">shortId</Label>
                  <Input
                    id="proxy-sid"
                    value={extra.shortId}
                    onChange={(e) => patchExtra({ shortId: e.target.value })}
                  />
                </div>
              </>
            ) : null}
            {showInsecure ? (
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="proxy-insecure">跳过证书校验</Label>
                <Switch
                  id="proxy-insecure"
                  checked={extra.insecure}
                  onCheckedChange={(v: boolean) => patchExtra({ insecure: v })}
                />
              </div>
            ) : null}
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
