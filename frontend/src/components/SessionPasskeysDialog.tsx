import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CopyIcon, DownloadIcon, RefreshCwIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import type { Passkey, PasskeyEvent, PasskeyStatus, Session, WebAuthnConfig } from '@nya/shared';
import { api } from '../api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

type RuntimeStatus = { attached: boolean; tabs: number; armedTabs: number };

const STATUS_LABEL: Record<PasskeyStatus, string> = {
  active: '可用',
  replaced: '已被替换',
  deleted_by_rp: '网站已删除',
};

const EVENT_LABEL: Record<PasskeyEvent['kind'], string> = {
  added: '创建',
  asserted: '登录',
  updated: '更新',
  deleted: '网站删除',
  replaced: '被替换',
  imported: '导入',
  removed: '手动删除',
};

function fmtTime(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success('已复制');
  } catch {
    toast.error('复制失败');
  }
}

function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function parseImport(text: string): unknown[] {
  const data = JSON.parse(text) as unknown;
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object' && Array.isArray((data as { passkeys?: unknown[] }).passkeys)) {
    return (data as { passkeys: unknown[] }).passkeys;
  }
  if (data && typeof data === 'object' && Array.isArray((data as { credentials?: unknown[] }).credentials)) {
    return (data as { credentials: unknown[] }).credentials;
  }
  return [data];
}

export function SessionPasskeysDialog({
  session,
  onClose,
  onChange,
}: {
  session: Session | null;
  onClose: () => void;
  onChange?: () => void;
}) {
  const [rows, setRows] = useState<Passkey[]>([]);
  const [events, setEvents] = useState<PasskeyEvent[]>([]);
  const [config, setConfig] = useState<WebAuthnConfig | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importText, setImportText] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Passkey | null>(null);

  const reload = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const [w, p, e] = await Promise.all([
        api.getWebAuthn(session.id),
        api.listPasskeys(session.id),
        api.listPasskeyEvents(session.id, 0, 1000),
      ]);
      setConfig(w.webauthn);
      setRuntime(w.runtime);
      setRows(p.passkeys);
      setEvents(e.events.slice(-50).reverse());
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!session) {
      setRows([]);
      setEvents([]);
      setConfig(null);
      setRuntime(null);
      setImportText(null);
      return;
    }
    void reload();
  }, [session, reload]);

  const toggle = async (enabled: boolean) => {
    if (!session) return;
    setSaving(true);
    try {
      const r = await api.putWebAuthn(session.id, { enabled });
      setConfig(r.webauthn);
      setRuntime(r.runtime);
      toast.success(enabled ? '已开启通行密钥' : '已关闭通行密钥');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const submitImport = async () => {
    if (!session || importText == null) return;
    let items: unknown[];
    try {
      items = parseImport(importText);
    } catch {
      toast.error('不是有效的 JSON');
      return;
    }
    try {
      const r = await api.importPasskeys(session.id, items);
      toast.success(`已导入 ${r.passkeys.length} 个通行密钥`);
      setImportText(null);
      await reload();
      onChange?.();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const confirmDelete = async () => {
    if (!session || !pendingDelete) return;
    try {
      await api.deletePasskey(session.id, pendingDelete.id);
      toast.success('已删除');
      await reload();
      onChange?.();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPendingDelete(null);
    }
  };

  const fileBase = (session?.name || 'session').replace(/[^\w.-]+/g, '_');

  return (
    <>
      <Dialog open={Boolean(session)} onOpenChange={(open: boolean) => !open && onClose()}>
        <DialogContent className="max-h-[90vh] sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>通行密钥 · {session?.name || ''}</DialogTitle>
            <DialogDescription>
              开启后，服务端会给这个会话的每个标签页挂一个虚拟认证器。网页创建的通行密钥会立即保存在这里（包括私钥），导出/导入会话时一并带走。
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm">
            <Switch checked={Boolean(config?.enabled)} disabled={!config || saving} onCheckedChange={(v: boolean) => void toggle(v)} />
            <span>{config?.enabled ? '已开启' : '未开启'}</span>
            {config?.enabled && runtime ? (
              <span className="text-muted-foreground">
                {runtime.attached ? `已挂载 ${runtime.armedTabs}/${runtime.tabs} 个标签页` : '会话未运行，启动后自动挂载'}
              </span>
            ) : null}
            <span className="text-xs text-muted-foreground">
              开启后页面里 isUserVerifyingPlatformAuthenticatorAvailable() 会返回 true。
            </span>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
                <RefreshCwIcon />
                刷新
              </Button>
              <Button variant="outline" size="sm" onClick={() => setImportText('')}>
                <UploadIcon />
                导入
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!rows.length}
                onClick={() => downloadJson(`${fileBase}.passkeys.json`, rows)}
              >
                <DownloadIcon />
                导出全部
              </Button>
            </div>
          </div>

          {importText != null ? (
            <div className="space-y-2">
              <Textarea
                className="h-40 font-mono text-xs"
                placeholder='粘贴 JSON：单个凭据、数组，或 CDP WebAuthn.getCredentials 的返回值 {"credentials": [...]}'
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setImportText(null)}>
                  取消
                </Button>
                <Button size="sm" disabled={!importText.trim()} onClick={() => void submitImport()}>
                  导入
                </Button>
              </div>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 space-y-4 overflow-auto">
            {loading && !rows.length ? (
              <p className="py-8 text-center text-sm text-muted-foreground">读取中…</p>
            ) : rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                还没有通行密钥。开启后在网页里创建，或手动导入。
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>网站</TableHead>
                    <TableHead>账号</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>计数</TableHead>
                    <TableHead>创建 / 最后使用</TableHead>
                    <TableHead className="w-28" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="max-w-52 whitespace-normal">
                        <div className="break-all font-medium">{row.rpId}</div>
                        {row.origin ? <div className="break-all text-xs text-muted-foreground">{row.origin}</div> : null}
                      </TableCell>
                      <TableCell className="max-w-44 whitespace-normal">
                        <div className="break-all">{row.userName || '—'}</div>
                        {row.userDisplayName && row.userDisplayName !== row.userName ? (
                          <div className="break-all text-xs text-muted-foreground">{row.userDisplayName}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.status === 'active' ? 'secondary' : 'outline'}>{STATUS_LABEL[row.status]}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.signCount}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <div>{fmtTime(row.createdAt)}</div>
                        <div>{fmtTime(row.lastUsedAt)}</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon-xs" title="复制 JSON（含私钥）" onClick={() => void copyText(JSON.stringify(row, null, 2))}>
                            <CopyIcon />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            title="下载 JSON"
                            onClick={() => downloadJson(`${row.rpId}-${row.userName || row.id}.passkey.json`, row)}
                          >
                            <DownloadIcon />
                          </Button>
                          <Button variant="ghost" size="icon-xs" title="删除" onClick={() => setPendingDelete(row)}>
                            <Trash2Icon />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            {events.length ? (
              <div>
                <div className="mb-1 text-sm font-medium">最近事件</div>
                <Table>
                  <TableBody>
                    {events.map((e) => (
                      <TableRow key={e.seq}>
                        <TableCell className="w-44 text-xs text-muted-foreground">{fmtTime(e.at)}</TableCell>
                        <TableCell className="w-20 text-xs">{EVENT_LABEL[e.kind]}</TableCell>
                        <TableCell className="text-xs">{e.rpId}</TableCell>
                        <TableCell className="font-mono text-xs">{e.credentialId.slice(0, 8)}</TableCell>
                        <TableCell className="text-xs">{e.signCount ?? ''}</TableCell>
                        <TableCell className="max-w-64 truncate text-xs text-muted-foreground" title={e.url}>
                          {e.url || e.actor}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(v: boolean) => !v && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 {pendingDelete?.rpId} 的通行密钥？</AlertDialogTitle>
            <AlertDialogDescription>
              会从数据库和浏览器里同时移除，网站上对应的通行密钥将无法再登录。删除前可以先下载备份。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
