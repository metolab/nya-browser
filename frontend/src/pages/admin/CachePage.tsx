import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import {
  BanIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import type { AssetCacheConfig, AssetCacheEntrySummary, AssetCacheStats } from '@nya/shared';
import { api } from '../../api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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

const PAGE_SIZE = 30;
const MIB = 1024 * 1024;
const GIB = 1024 * 1024 * 1024;

function fmtBytes(n: number) {
  const bytes = Math.max(0, n || 0);
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(2)} GB`;
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function fmtPct(ratio: number) {
  return `${((ratio || 0) * 100).toFixed(1)}%`;
}

function fmtTtl(sec: number) {
  if (sec <= 0) return '待刷新';
  if (sec >= 86400) {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    return h > 0 ? `${d}天 ${h}小时` : `${d}天`;
  }
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return m > 0 ? `${h}小时 ${m}分` : `${h}小时`;
  }
  if (sec >= 60) return `${Math.floor(sec / 60)}分`;
  return `${sec}秒`;
}

function fmtTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
}

function UsageBar({ used, max }: { used: number; max: number }) {
  const ratio = max > 0 ? Math.min(100, Math.max(0, (used / max) * 100)) : 0;
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${ratio.toFixed(1)}%` }}
      />
    </div>
  );
}

const BYPASS_LABELS: Record<string, string> = {
  'user-blacklist': '用户黑名单',
  'builtin-blacklist': '内置风控黑名单',
  'sensitive-path': '敏感路径',
  'sensitive-query': '含敏感参数',
  'not-eligible': '非不可变/非公共',
  'cc-private': 'Private 响应',
  'cc-no-store': 'No-Store',
  'cc-no-cache': 'No-Cache',
  'cc-max-age-0': 'Max-Age=0',
  'set-cookie': '含 Set-Cookie',
  'cors-credentials': '带凭证 CORS',
  'cors-mismatch': 'CORS 不匹配',
  'content-type': '非静态 MIME',
  'non-200': '非 200 状态',
  'too-large': '超出体积上限',
  'body-too-small': '体积过小',
  'html-body-sniff': '正文嗅探为 HTML',
  'concurrency-limit': '并发限流跳过',
  'non-get': '非 GET 请求',
  'auth-header': '含鉴权头',
  'cookie-header': '含 Cookie 头',
  'cookie-not-public': '含 Cookie 非公开资源',
  'range-request': 'Range 分片',
};

function labelBypass(reason: string) {
  if (reason.startsWith('unsafe-vary:')) return `不安全 Vary (${reason.slice(12)})`;
  return BYPASS_LABELS[reason] || reason;
}

export default function CachePage() {
  const [config, setConfig] = useState<AssetCacheConfig | null>(null);
  const [stats, setStats] = useState<AssetCacheStats | null>(null);
  const [builtinBlacklist, setBuiltinBlacklist] = useState<string[]>([]);

  // Config form draft
  const [memMb, setMemMb] = useState('256');
  const [diskGb, setDiskGb] = useState('5');
  const [entryMb, setEntryMb] = useState('4');
  const [defaultTtlHours, setDefaultTtlHours] = useState('24');
  const [immutableTtlDays, setImmutableTtlDays] = useState('7');
  const [cacheImages, setCacheImages] = useState(false);
  const [builtinEnabled, setBuiltinEnabled] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);

  // Blacklist
  const [newPattern, setNewPattern] = useState('');
  const [showBuiltin, setShowBuiltin] = useState(false);

  // Entries browser
  const [entries, setEntries] = useState<AssetCacheEntrySummary[]>([]);
  const [entriesTotal, setEntriesTotal] = useState(0);
  const [searchDraft, setSearchDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [hostFilter, setHostFilter] = useState('');
  const [sortBy, setSortBy] = useState<'hits' | 'size' | 'updated' | 'ttl'>('hits');
  const [page, setPage] = useState(1);

  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState(false);

  const syncFormFromConfig = useCallback((cfg: AssetCacheConfig) => {
    setMemMb(String(Math.round(cfg.maxMemoryBytes / MIB)));
    setDiskGb(String(Number((cfg.maxDiskBytes / GIB).toFixed(2))));
    setEntryMb(String(Number((cfg.maxEntryBytes / MIB).toFixed(1))));
    setDefaultTtlHours(String(Math.round(cfg.defaultTtlSec / 3600)));
    setImmutableTtlDays(String(Math.round(cfg.immutableTtlSec / 86400)));
    setCacheImages(cfg.cacheImages);
    setBuiltinEnabled(cfg.builtinBlacklistEnabled);
  }, []);

  const loadSummary = useCallback(
    async (syncDraft = false) => {
      const data = await api.getAssetCache();
      setConfig(data.config);
      setStats(data.stats);
      setBuiltinBlacklist(data.builtinBlacklist);
      if (syncDraft) syncFormFromConfig(data.config);
    },
    [syncFormFromConfig],
  );

  const loadEntries = useCallback(async () => {
    const data = await api.listAssetCacheEntries({
      q: searchQuery || undefined,
      host: hostFilter || undefined,
      sort: sortBy,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    });
    setEntries(data.entries);
    setEntriesTotal(data.total);
    const maxPage = Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE));
    if (page > maxPage) setPage(maxPage);
  }, [hostFilter, page, searchQuery, sortBy]);

  useEffect(() => {
    void loadSummary(true).catch((e: Error) => toast.error(e.message));
  }, [loadSummary]);

  useEffect(() => {
    void loadEntries().catch((e: Error) => toast.error(e.message));
  }, [loadEntries]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadSummary(false).catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [loadSummary]);

  const handleToggleEnabled = async (next: boolean) => {
    try {
      const data = await api.updateAssetCacheConfig({ enabled: next });
      setConfig(data.config);
      setStats(data.stats);
      toast.success(next ? '已启用共享缓存池' : '已关闭共享缓存池');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleSaveConfig = async (event: FormEvent) => {
    event.preventDefault();
    const maxMemoryBytes = Math.round(Number(memMb) * MIB);
    const maxDiskBytes = Math.round(Number(diskGb) * GIB);
    const maxEntryBytes = Math.round(Number(entryMb) * MIB);
    const defaultTtlSec = Math.round(Number(defaultTtlHours) * 3600);
    const immutableTtlSec = Math.round(Number(immutableTtlDays) * 86400);

    if (!Number.isFinite(maxMemoryBytes) || maxMemoryBytes < 16 * MIB) {
      toast.error('内存上限至少为 16 MB');
      return;
    }
    if (!Number.isFinite(maxDiskBytes) || maxDiskBytes < 64 * MIB) {
      toast.error('磁盘上限至少为 0.07 GB');
      return;
    }
    if (!Number.isFinite(defaultTtlSec) || defaultTtlSec < 300) {
      toast.error('默认 TTL 至少 1 小时');
      return;
    }

    setSavingConfig(true);
    try {
      const data = await api.updateAssetCacheConfig({
        cacheImages,
        builtinBlacklistEnabled: builtinEnabled,
        maxMemoryBytes,
        maxDiskBytes,
        maxEntryBytes,
        defaultTtlSec,
        immutableTtlSec,
      });
      setConfig(data.config);
      setStats(data.stats);
      syncFormFromConfig(data.config);
      toast.success('缓存配置已保存并立即生效');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingConfig(false);
    }
  };

  const addBlacklistPattern = async (patternRaw: string) => {
    if (!config) return;
    const pat = patternRaw.trim().toLowerCase();
    if (!pat) return;
    if (config.blacklist.includes(pat)) {
      toast.info('该规则已在黑名单中');
      return;
    }
    try {
      const data = await api.updateAssetCacheConfig({
        blacklist: [...config.blacklist, pat],
      });
      setConfig(data.config);
      setStats(data.stats);
      setNewPattern('');
      toast.success(`已加入黑名单：${pat}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '添加失败');
    }
  };

  const removeBlacklistPattern = async (pat: string) => {
    if (!config) return;
    try {
      const data = await api.updateAssetCacheConfig({
        blacklist: config.blacklist.filter((x) => x !== pat),
      });
      setConfig(data.config);
      setStats(data.stats);
      toast.success(`已移除黑名单：${pat}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '移除失败');
    }
  };

  const handleRefreshScope = async (
    scope: 'all' | 'host' | 'key',
    opts?: { host?: string; key?: string },
  ) => {
    try {
      const data = await api.refreshAssetCache({ scope, ...opts });
      setStats(data.stats);
      await loadEntries();
      toast.success(`已标记 ${data.affected} 条缓存待刷新，下次访问自动回源更新`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '刷新失败');
    }
  };

  const handlePurgeScope = async (
    scope: 'all' | 'host' | 'key',
    opts?: { host?: string; key?: string },
  ) => {
    try {
      const data = await api.purgeAssetCache({ scope, ...opts });
      setStats(data.stats);
      await loadEntries();
      toast.success(`已清除 ${data.affected} 条缓存`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '清除失败');
    }
  };

  const handleResetStats = async () => {
    try {
      const data = await api.resetAssetCacheStats();
      setStats(data.stats);
      toast.success('已重置命中统计');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '重置失败');
    }
  };

  const applySearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSearchQuery(searchDraft.trim());
  };

  const totalPages = Math.max(1, Math.ceil(entriesTotal / PAGE_SIZE));
  const bypassList = stats ? Object.entries(stats.bypassReasons) : [];

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">共享缓存池</h2>
          {config && (
            <Badge variant={config.enabled ? 'secondary' : 'outline'}>
              {config.enabled ? '已启用' : '已关闭'}
            </Badge>
          )}
          {stats && (
            <span className="text-xs text-muted-foreground">
              活跃接入会话：{stats.activeSessions}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {config && (
            <div className="mr-2 flex items-center gap-2">
              <Switch
                id="cache-global-enabled"
                checked={config.enabled}
                onCheckedChange={(v: boolean) => void handleToggleEnabled(v)}
              />
              <Label htmlFor="cache-global-enabled" className="cursor-pointer text-sm">
                启用缓存池
              </Label>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void Promise.all([loadSummary(false), loadEntries()])}
          >
            <RefreshCwIcon className="mr-1.5 size-3.5" />
            刷新数据
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleRefreshScope('all')}
          >
            <RotateCcwIcon className="mr-1.5 size-3.5" />
            全部标记刷新
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleResetStats()}
          >
            重置统计
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setPurgeConfirmOpen(true)}
          >
            <Trash2Icon className="mr-1.5 size-3.5" />
            清空缓存
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      {stats && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">命中率</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">{fmtPct(stats.hitRate)}</div>
              <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                命中 {stats.hits}（内存 {stats.memoryHits} / 磁盘 {stats.diskHits}） · 未命中 {stats.misses}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">累计节省流量</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">{fmtBytes(stats.savedBytes)}</div>
              <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                写入 {stats.stores} · 刷新 {stats.refreshes} · 绕过 {stats.bypasses}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">L1 内存占用</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">
                {fmtBytes(stats.memoryBytes)}
                <span className="text-sm font-normal text-muted-foreground">
                  {' '}
                  / {fmtBytes(stats.memoryMaxBytes)}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                {stats.memoryEntries} 条热缓存
              </div>
              <UsageBar used={stats.memoryBytes} max={stats.memoryMaxBytes} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">L2 磁盘占用</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">
                {fmtBytes(stats.diskBytes)}
                <span className="text-sm font-normal text-muted-foreground">
                  {' '}
                  / {fmtBytes(stats.diskMaxBytes)}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                {stats.diskEntries} 条持久化资源
              </div>
              <UsageBar used={stats.diskBytes} max={stats.diskMaxBytes} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Config + Blacklist */}
      {config && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">策略与配额</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4" onSubmit={(e) => void handleSaveConfig(e)}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="cfg-mem-mb">内存上限 (MB)</Label>
                    <Input
                      id="cfg-mem-mb"
                      type="number"
                      min={16}
                      max={2048}
                      value={memMb}
                      onChange={(e) => setMemMb(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="cfg-disk-gb">磁盘上限 (GB)</Label>
                    <Input
                      id="cfg-disk-gb"
                      type="number"
                      step="0.5"
                      min={0.5}
                      max={100}
                      value={diskGb}
                      onChange={(e) => setDiskGb(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="cfg-entry-mb">单文件上限 (MB)</Label>
                    <Input
                      id="cfg-entry-mb"
                      type="number"
                      step="0.5"
                      min={0.5}
                      max={16}
                      value={entryMb}
                      onChange={(e) => setEntryMb(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="cfg-ttl-h">普通资源 TTL (小时)</Label>
                    <Input
                      id="cfg-ttl-h"
                      type="number"
                      min={1}
                      max={720}
                      value={defaultTtlHours}
                      onChange={(e) => setDefaultTtlHours(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="cfg-imm-d">不可变资源 TTL (天)</Label>
                    <Input
                      id="cfg-imm-d"
                      type="number"
                      min={1}
                      max={90}
                      value={immutableTtlDays}
                      onChange={(e) => setImmutableTtlDays(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2.5 pt-1">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">启用内置风控 / 验证码 / 支付黑名单</div>
                      <div className="text-xs text-muted-foreground">
                        自动绕过 Cloudflare、reCAPTCHA、阿里/腾讯验证码、支付与埋点脚本（强烈建议开启）
                      </div>
                    </div>
                    <Switch checked={builtinEnabled} onCheckedChange={setBuiltinEnabled} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">缓存公共图片资源</div>
                      <div className="text-xs text-muted-foreground">
                        默认仅缓存 JS / CSS / 字体；开启后将额外缓存公共静态图片（不含 SVG 与头像路径）
                      </div>
                    </div>
                    <Switch checked={cacheImages} onCheckedChange={setCacheImages} />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={savingConfig}>
                    {savingConfig ? '保存中…' : '保存配置'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">黑名单管理</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowBuiltin((v) => !v)}
              >
                <ShieldAlertIcon className="mr-1.5 size-3.5" />
                {showBuiltin ? '隐藏内置规则' : `内置规则 (${builtinBlacklist.length})`}
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addBlacklistPattern(newPattern);
                }}
              >
                <Input
                  placeholder="域名或路径，如 example.com、*.cdn.com/private/*"
                  value={newPattern}
                  onChange={(e) => setNewPattern(e.target.value)}
                />
                <Button type="submit" variant="outline" size="sm" className="shrink-0">
                  <PlusIcon className="mr-1 size-3.5" />
                  添加
                </Button>
              </form>

              {config.blacklist.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  暂无自定义黑名单。添加后，匹配域名或路径的请求将立即绕过缓存池。
                </p>
              ) : (
                <div className="flex max-h-40 flex-wrap gap-1.5 overflow-auto">
                  {config.blacklist.map((pat) => (
                    <Badge key={pat} variant="secondary" className="gap-1 pr-1 font-mono text-xs">
                      <span>{pat}</span>
                      <button
                        type="button"
                        className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                        onClick={() => void removeBlacklistPattern(pat)}
                        title="移除"
                      >
                        <XIcon className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              {showBuiltin && (
                <div className="rounded-lg border bg-muted/40 p-2.5">
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                    内置安全黑名单（{config.builtinBlacklistEnabled ? '生效中' : '已停用'}）
                  </div>
                  <div className="flex max-h-32 flex-wrap gap-1 overflow-auto">
                    {builtinBlacklist.map((pat) => (
                      <span
                        key={pat}
                        className="rounded bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                      >
                        {pat}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {bypassList.length > 0 && (
                <div className="border-t pt-2.5">
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                    安全拦截 / 绕过原因统计
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {bypassList.slice(0, 12).map(([reason, count]) => (
                      <Badge key={reason} variant="outline" className="text-[11px] font-normal tabular-nums">
                        {labelBypass(reason)}: {count}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Top Hosts */}
      {stats && stats.topHosts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">热门缓存域名</CardTitle>
          </CardHeader>
          <CardContent className="max-h-72 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>域名</TableHead>
                  <TableHead className="text-right">条目数</TableHead>
                  <TableHead className="text-right">占用大小</TableHead>
                  <TableHead className="text-right">命中次数</TableHead>
                  <TableHead className="text-right">节省流量</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.topHosts.map((h) => (
                  <TableRow key={h.host}>
                    <TableCell>
                      <button
                        type="button"
                        className="font-mono text-xs text-primary hover:underline"
                        onClick={() => {
                          setHostFilter(hostFilter === h.host ? '' : h.host);
                          setPage(1);
                        }}
                      >
                        {h.host}
                      </button>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{h.entries}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBytes(h.diskBytes)}</TableCell>
                    <TableCell className="text-right tabular-nums">{h.hits}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtBytes(h.savedBytes)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => void handleRefreshScope('host', { host: h.host })}
                          title="标记该域名缓存待刷新"
                        >
                          <RotateCcwIcon className="mr-1 size-3" />
                          刷新
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => void handlePurgeScope('host', { host: h.host })}
                          title="删除该域名所有缓存"
                        >
                          <Trash2Icon className="mr-1 size-3" />
                          清除
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => {
                            void (async () => {
                              await addBlacklistPattern(h.host);
                              await handlePurgeScope('host', { host: h.host });
                            })();
                          }}
                          title="拉黑并清除该域名"
                        >
                          <BanIcon className="mr-1 size-3" />
                          拉黑
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Entries Table */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">缓存资源明细</CardTitle>
            <Badge variant="outline" className="tabular-nums">
              共 {entriesTotal} 条
            </Badge>
            {hostFilter && (
              <Badge variant="secondary" className="gap-1 pr-1 font-mono text-xs">
                <span>{hostFilter}</span>
                <button
                  type="button"
                  onClick={() => {
                    setHostFilter('');
                    setPage(1);
                  }}
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <form className="flex items-center gap-2" onSubmit={applySearch}>
              <Input
                placeholder="搜索 URL 或域名…"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                className="h-8 w-56 text-xs"
              />
              <Button type="submit" variant="outline" size="sm">
                搜索
              </Button>
            </form>
            <Select
              value={sortBy}
              onValueChange={(v: string) => {
                setSortBy(v as 'hits' | 'size' | 'updated' | 'ttl');
                setPage(1);
              }}
            >
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hits">按命中次数</SelectItem>
                <SelectItem value="size">按文件大小</SelectItem>
                <SelectItem value="updated">按最近更新</SelectItem>
                <SelectItem value="ttl">按剩余 TTL</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">暂无缓存条目</p>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>资源 URL</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>层级</TableHead>
                    <TableHead className="text-right">大小</TableHead>
                    <TableHead className="text-right">命中</TableHead>
                    <TableHead className="text-right">剩余 TTL</TableHead>
                    <TableHead>更新时间</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((item) => (
                    <TableRow key={item.key}>
                      <TableCell className="max-w-md">
                        <div className="truncate font-mono text-xs" title={item.url}>
                          {item.url}
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span>{item.host}</span>
                          {item.immutable && (
                            <Badge variant="outline" className="h-4 px-1 text-[10px]">
                              immutable
                            </Badge>
                          )}
                          {item.varyLang && (
                            <Badge variant="outline" className="h-4 px-1 text-[10px]">
                              lang:{item.varyLang}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {item.resourceType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={item.inMemory ? 'secondary' : 'outline'} className="text-xs">
                          {item.inMemory ? 'L1 内存' : 'L2 磁盘'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {fmtBytes(item.sizeBytes)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {item.hits}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        <span className={item.stale ? 'text-amber-600 dark:text-amber-400' : ''}>
                          {fmtTtl(item.ttlRemainingSec)}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                        {fmtTime(item.updatedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => void handleRefreshScope('key', { key: item.key })}
                            title="标记待刷新"
                          >
                            <RotateCcwIcon className="size-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => void handlePurgeScope('key', { key: item.key })}
                            title="删除条目"
                          >
                            <Trash2Icon className="size-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-end gap-2">
              <span className="text-xs text-muted-foreground tabular-nums">
                第 {page} / {totalPages} 页
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeftIcon className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                <ChevronRightIcon className="size-4" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={purgeConfirmOpen} onOpenChange={setPurgeConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认清空全部共享缓存？</AlertDialogTitle>
            <AlertDialogDescription>
              将立即清除 L1 内存与 L2 磁盘中的所有静态资源缓存文件，不会影响任何会话的登录态与 Cookie。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setPurgeConfirmOpen(false);
                void handlePurgeScope('all');
              }}
            >
              确认清空
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
