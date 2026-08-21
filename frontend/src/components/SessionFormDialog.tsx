import { useEffect, useState } from 'react';
import type { ProxyRecord, SessionGroup } from '@nya/shared';
import { DEFAULT_TIMEZONE, IDLE_TIMEOUT_MINUTES_MAX, TIMEZONES } from '@nya/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { NONE_KEY, groupSelectOptions } from '@/lib/groups';

export type SessionFormValues = {
  name: string;
  description: string;
  groupId: string | null;
  proxyId: string | null;
  timezone: string;
  homeUrl: string;
  idleTimeoutMinutes: number;
};

type Props = {
  open: boolean;
  title: string;
  initialName?: string;
  initialDescription?: string;
  initialProxyId?: string | null;
  initialGroupId?: string | null;
  initialTimezone?: string;
  initialHomeUrl?: string;
  initialIdleTimeoutMinutes?: number;
  proxies: ProxyRecord[];
  groups?: SessionGroup[];
  submitLabel: string;
  nameEditable?: boolean;
  showMeta?: boolean;
  onCancel: () => void;
  onSubmit: (data: SessionFormValues) => Promise<void>;
};

export default function SessionFormDialog({
  open,
  title,
  initialName = '',
  initialDescription = '',
  initialProxyId = null,
  initialGroupId = null,
  initialTimezone = DEFAULT_TIMEZONE,
  initialHomeUrl = 'https://www.google.com/',
  initialIdleTimeoutMinutes = 0,
  proxies,
  groups,
  submitLabel,
  nameEditable = true,
  showMeta = true,
  onCancel,
  onSubmit,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [homeUrl, setHomeUrl] = useState(initialHomeUrl);
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState(String(initialIdleTimeoutMinutes ?? 0));
  const [proxyId, setProxyId] = useState(initialProxyId || NONE_KEY);
  const [groupId, setGroupId] = useState(initialGroupId || NONE_KEY);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setDescription(initialDescription);
    setTimezone(initialTimezone || DEFAULT_TIMEZONE);
    setHomeUrl(initialHomeUrl || 'https://www.google.com/');
    setIdleTimeoutMinutes(String(initialIdleTimeoutMinutes ?? 0));
    setProxyId(initialProxyId || NONE_KEY);
    setGroupId(initialGroupId || NONE_KEY);
    setBusy(false);
  }, [
    open,
    initialName,
    initialDescription,
    initialProxyId,
    initialGroupId,
    initialTimezone,
    initialHomeUrl,
    initialIdleTimeoutMinutes,
  ]);

  return (
    <Dialog open={open} onOpenChange={(v: boolean) => !v && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (nameEditable && !name.trim()) return;
            setBusy(true);
            void onSubmit({
              name: name.trim() || initialName || 'Session',
              description,
              timezone: timezone || DEFAULT_TIMEZONE,
              homeUrl: homeUrl || 'https://www.google.com/',
              idleTimeoutMinutes: (() => {
                const n = Number.parseInt(String(idleTimeoutMinutes), 10);
                if (!Number.isFinite(n) || n <= 0) return 0;
                return Math.min(IDLE_TIMEOUT_MINUTES_MAX, n);
              })(),
              proxyId: proxyId === NONE_KEY ? null : proxyId,
              groupId: groupId === NONE_KEY ? null : groupId,
            })
              .then(onCancel)
              .finally(() => setBusy(false));
          }}
        >
          {nameEditable && (
            <div className="grid gap-2">
              <Label htmlFor="session-name">名称</Label>
              <Input
                id="session-name"
                value={name}
                maxLength={64}
                placeholder="例如：工作账号"
                required
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}
          {showMeta && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="session-desc">描述</Label>
                <Textarea
                  id="session-desc"
                  value={description}
                  maxLength={500}
                  placeholder="可选"
                  className="min-h-16"
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>时区</Label>
                  <Select value={timezone} onValueChange={setTimezone}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" className="max-h-64">
                      {TIMEZONES.map((tz) => (
                        <SelectItem key={tz} value={tz}>
                          {tz}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {groups && (
                  <div className="grid gap-2">
                    <Label>目录</Label>
                    <Select value={groupId} onValueChange={setGroupId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="未归类" />
                      </SelectTrigger>
                      <SelectContent position="popper" className="max-h-64">
                        <SelectItem value={NONE_KEY}>未归类</SelectItem>
                        {groupSelectOptions(groups).map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="session-url">默认网址</Label>
                <Input
                  id="session-url"
                  value={homeUrl}
                  placeholder="https://www.google.com/"
                  onChange={(e) => setHomeUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  打开窗口时使用，也可以临时填写别的地址
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="session-idle">空闲超时（分钟）</Label>
                <Input
                  id="session-idle"
                  type="number"
                  min={0}
                  max={IDLE_TIMEOUT_MINUTES_MAX}
                  step={1}
                  value={idleTimeoutMinutes}
                  onChange={(e) => setIdleTimeoutMinutes(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  所有窗口都没有 VNC 连接达到该时间后自动停止会话。0 表示不限制
                </p>
              </div>
            </>
          )}
          <div className="grid gap-2">
            <Label>代理</Label>
            <Select value={proxyId} onValueChange={setProxyId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="直连（无代理）" />
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-64">
                <SelectItem value={NONE_KEY}>直连（无代理）</SelectItem>
                {proxies.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} · {p.type}://{p.host}:{p.port}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
