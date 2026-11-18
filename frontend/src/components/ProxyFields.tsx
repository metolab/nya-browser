import { useState } from 'react';
import { toast } from 'sonner';
import type { ProxyExtra, ProxyRecord, ProxyTestResult, ProxyType } from '@nya/shared';
import {
  DEFAULT_PROXY_PORTS,
  emptyProxyExtra,
  parseProxyUri,
  proxyNeedsSecret,
  regionFromLoc,
  SS_METHODS,
  TLS_FINGERPRINTS,
} from '@nya/shared';
import { api, type CustomProxyInput } from '../api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { NONE_KEY } from '@/lib/groups';

export const PROXY_TYPE_LABELS: Record<ProxyType, string> = {
  http: 'HTTP',
  https: 'HTTPS',
  socks5: 'SOCKS5',
  anytls: 'AnyTLS',
  ss: 'Shadowsocks',
  vless: 'VLESS',
};

/** A proxy form's fields as typed; `viaProxyId` is NONE_KEY for no front proxy. */
export type ProxyDraft = {
  type: ProxyType;
  host: string;
  port: string;
  username: string;
  password: string;
  extra: ProxyExtra;
  viaProxyId: string;
};

export function emptyProxyDraft(): ProxyDraft {
  return {
    type: 'http',
    host: '',
    port: String(DEFAULT_PROXY_PORTS.http),
    username: '',
    password: '',
    extra: emptyProxyExtra(),
    viaProxyId: NONE_KEY,
  };
}

export function proxyDraftFrom(p: {
  type: ProxyType;
  host: string;
  port: number;
  username: string;
  password: string;
  extra: ProxyExtra;
  viaProxyId: string | null;
}): ProxyDraft {
  return {
    type: p.type,
    host: p.host,
    port: String(p.port),
    username: p.username,
    password: p.password,
    extra: { ...emptyProxyExtra(), ...p.extra },
    viaProxyId: p.viaProxyId || NONE_KEY,
  };
}

function needsUser(type: ProxyType) {
  return type === 'http' || type === 'https' || type === 'socks5';
}

function needsSni(type: ProxyType) {
  return type === 'https' || type === 'anytls' || type === 'vless';
}

export function proxyDraftPayload(d: ProxyDraft): CustomProxyInput {
  return {
    type: d.type,
    host: d.host.trim(),
    port: Number(d.port),
    username: needsUser(d.type) ? d.username : '',
    password: d.password,
    extra: d.extra,
    viaProxyId: d.viaProxyId === NONE_KEY ? null : d.viaProxyId,
  };
}

export function proxyTestLabel(t: ProxyTestResult | null | undefined) {
  if (!t) return '-';
  if (!t.ok) return t.error || '失败';
  const region = t.region || regionFromLoc(t.loc) || t.loc || '';
  const colo = t.colo ? ` ${t.colo}` : '';
  const ip = t.exitIp || '';
  const ms = t.latencyMs != null ? `${t.latencyMs}ms` : '';
  return [region + colo, ip, ms].filter(Boolean).join(' · ');
}

type Props = {
  value: ProxyDraft;
  onChange: (next: ProxyDraft) => void;
  /** Saved proxies offered as the front proxy. */
  fronts: ProxyRecord[];
  idPrefix: string;
  /** Editing a stored proxy: an empty password keeps this one. */
  savedPassword?: string;
  onParsedName?: (name: string) => void;
  onTested?: (result: ProxyTestResult) => void;
};

export default function ProxyFields({ value, onChange, fronts, idPrefix, savedPassword, onParsedName, onTested }: Props) {
  const [uri, setUri] = useState('');
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<ProxyTestResult | null>(null);
  const { type, extra } = value;
  const patch = (next: Partial<ProxyDraft>) => {
    setTested(null);
    onChange({ ...value, ...next });
  };
  const patchExtra = (next: Partial<ProxyExtra>) => patch({ extra: { ...extra, ...next } });
  const id = (name: string) => `${idPrefix}-${name}`;
  const editing = savedPassword !== undefined;

  const changeType = (next: ProxyType) => {
    // Keep a port the user typed; swap only the previous type's suggestion.
    const port = !value.port || value.port === String(DEFAULT_PROXY_PORTS[type]) ? String(DEFAULT_PROXY_PORTS[next]) : value.port;
    patch({ type: next, port });
  };

  const applyUri = () => {
    try {
      const parsed = parseProxyUri(uri);
      patch({
        type: parsed.type,
        host: parsed.host,
        port: String(parsed.port),
        username: parsed.username,
        password: parsed.password,
        extra: { ...emptyProxyExtra(), ...parsed.extra },
      });
      if (parsed.name) onParsedName?.(parsed.name);
      toast.success('已解析链接');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '无法解析链接');
    }
  };

  const runTest = () => {
    const payload = proxyDraftPayload(value);
    if (!payload.host || !payload.port) {
      toast.error('请先填写主机和端口');
      return;
    }
    if (!payload.password && savedPassword) payload.password = savedPassword;
    setTesting(true);
    void api
      .probeProxy(payload)
      .then(({ result }) => {
        setTested(result);
        onTested?.(result);
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setTesting(false));
  };

  const passwordLabel = type === 'vless' ? 'UUID' : '密码';
  const showInsecure = type === 'https' || type === 'anytls' || (type === 'vless' && extra.security !== 'none');

  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor={id('uri')}>分享链接</Label>
        <Textarea
          id={id('uri')}
          value={uri}
          onChange={(e) => setUri(e.target.value)}
          placeholder="anytls://、ss://、vless://、socks5://、http://"
        />
        <Button type="button" variant="outline" size="sm" onClick={applyUri} disabled={!uri.trim()}>
          解析并填入
        </Button>
      </div>
      <div className="grid gap-2">
        <Label>类型</Label>
        <Select value={type} onValueChange={(v: string) => changeType(v as ProxyType)}>
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
        <p className="text-xs text-muted-foreground">Chrome 只连本机 HTTP，协议由 sing-box sidecar 处理</p>
      </div>
      <div className="grid gap-2">
        <Label>前置代理</Label>
        <Select value={value.viaProxyId} onValueChange={(v: string) => patch({ viaProxyId: v })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="max-h-64">
            <SelectItem value={NONE_KEY}>无</SelectItem>
            {fronts.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name} ({PROXY_TYPE_LABELS[r.type] || r.type})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">先经前置节点再连本节点，用于入口不通的线路</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <div className="grid gap-2">
          <Label htmlFor={id('host')}>主机</Label>
          <Input id={id('host')} value={value.host} onChange={(e) => patch({ host: e.target.value })} required />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={id('port')}>端口</Label>
          <Input
            id={id('port')}
            type="number"
            min={1}
            max={65535}
            value={value.port}
            onChange={(e) => patch({ port: e.target.value })}
            required
          />
        </div>
      </div>
      {needsUser(type) ? (
        <div className="grid gap-2">
          <Label htmlFor={id('user')}>用户名</Label>
          <Input id={id('user')} value={value.username} onChange={(e) => patch({ username: e.target.value })} />
        </div>
      ) : null}
      <div className="grid gap-2">
        <Label htmlFor={id('pass')}>{passwordLabel}</Label>
        <Input
          id={id('pass')}
          type={type === 'vless' ? 'text' : 'password'}
          value={value.password}
          onChange={(e) => patch({ password: e.target.value })}
          required={!editing && proxyNeedsSecret(type)}
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
                <Label htmlFor={id('ws-path')}>WS path</Label>
                <Input id={id('ws-path')} value={extra.wsPath} onChange={(e) => patchExtra({ wsPath: e.target.value })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={id('ws-host')}>WS host</Label>
                <Input id={id('ws-host')} value={extra.wsHost} onChange={(e) => patchExtra({ wsHost: e.target.value })} />
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
            <Label htmlFor={id('flow')}>flow</Label>
            <Input
              id={id('flow')}
              value={extra.flow}
              onChange={(e) => patchExtra({ flow: e.target.value })}
              placeholder="xtls-rprx-vision"
            />
          </div>
        </>
      ) : null}
      {needsSni(type) ? (
        <div className="grid gap-2">
          <Label htmlFor={id('sni')}>SNI</Label>
          <Input
            id={id('sni')}
            value={extra.sni}
            onChange={(e) => patchExtra({ sni: e.target.value })}
            placeholder="留空则用主机名"
          />
        </div>
      ) : null}
      {type === 'vless' && extra.security !== 'none' ? (
        <div className="grid gap-2">
          <Label>uTLS 指纹</Label>
          <Select value={extra.fingerprint || 'chrome'} onValueChange={(v: string) => patchExtra({ fingerprint: v })}>
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
            <Label htmlFor={id('pbk')}>Reality public key</Label>
            <Input id={id('pbk')} value={extra.publicKey} onChange={(e) => patchExtra({ publicKey: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={id('sid')}>shortId</Label>
            <Input id={id('sid')} value={extra.shortId} onChange={(e) => patchExtra({ shortId: e.target.value })} />
          </div>
        </>
      ) : null}
      {showInsecure ? (
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={id('insecure')}>跳过证书校验</Label>
          <Switch
            id={id('insecure')}
            checked={extra.insecure}
            onCheckedChange={(v: boolean) => patchExtra({ insecure: v })}
          />
        </div>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" disabled={testing} onClick={runTest}>
          {testing ? '测试中…' : '测试连通性'}
        </Button>
        {tested ? (
          <span className={`text-xs ${tested.ok ? 'text-muted-foreground' : 'text-destructive'}`}>
            {proxyTestLabel(tested)}
          </span>
        ) : null}
      </div>
    </>
  );
}
