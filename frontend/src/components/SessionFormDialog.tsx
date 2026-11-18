import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDownIcon } from 'lucide-react';
import type { ProxyRecord, SessionGroup, SessionProxy } from '@nya/shared';
import {
  COMMON_TIMEZONES,
  DEFAULT_CHROME_LANGUAGE,
  DEFAULT_TIMEZONE,
  DEFAULT_WEBRTC_MODE,
  GPU_PROFILES,
  WEBRTC_MODES,
  WEBRTC_MODE_LABELS,
  DEFAULT_OS,
  DEFAULT_WINDOWS_RELEASE,
  OS_LABELS,
  OS_TYPES,
  WINDOWS_RELEASES,
  WINDOWS_RELEASE_LABELS,
  coerceOs,
  coerceWindowsRelease,
  DEFAULT_IDLE_TIMEOUT_MINUTES,
  IDLE_TIMEOUT_MINUTES_MAX,
  PINNED_CHROME_LANGUAGES,
  chromeLanguageOptionLabel,
  gpuProfileOptionLabel,
  hardwareProfileId,
  hardwareProfileOptions,
  parseHardwareProfileId,
  listTimezones,
  timezoneOptionLabel,
  CHROME_LANGUAGES,
} from '@nya/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import SearchSelect from '@/components/SearchSelect';
import ProxyFields, {
  emptyProxyDraft,
  proxyDraftFrom,
  proxyDraftPayload,
  proxyTestLabel,
  type ProxyDraft,
} from '@/components/ProxyFields';
import type { CustomProxyInput } from '../api/client';
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

const COMMON_TZ = new Set<string>(COMMON_TIMEZONES);
const TIMEZONE_OPTIONS = listTimezones().map((tz) => ({
  value: tz,
  label: timezoneOptionLabel(tz),
  group: COMMON_TZ.has(tz) ? '常用' : '全部',
}));
const PINNED_LANG = new Set<string>(PINNED_CHROME_LANGUAGES);
const LANGUAGE_OPTIONS = CHROME_LANGUAGES.map((code) => ({
  value: code,
  label: chromeLanguageOptionLabel(code),
  group: PINNED_LANG.has(code) ? '常用' : '全部',
}));
const RANDOM_KEY = '__random__';
const RANDOM_LABEL = '随机（按常见搭配加权）';
const GPU_OPTIONS = GPU_PROFILES.map((row) => ({
  value: row.id,
  label: gpuProfileOptionLabel(row.id),
  group: row.group,
}));
const GPU_OPTIONS_WITH_RANDOM = [{ value: RANDOM_KEY, label: RANDOM_LABEL, group: '常用' }, ...GPU_OPTIONS];
const WEBRTC_OPTIONS = WEBRTC_MODES.map((id) => ({
  value: id,
  label: WEBRTC_MODE_LABELS[id],
}));
const CUSTOM_PROXY_KEY = '__custom__';

function initialHardwareKey(cores?: number, memory?: number) {
  return cores && memory ? hardwareProfileId(cores, memory) : RANDOM_KEY;
}

export type SessionFormValues = {
  name: string;
  description: string;
  notepad: string;
  groupId: string | null;
  proxyId: string | null;
  customProxy: CustomProxyInput | null;
  timezone: string;
  chromeLanguage: string;
  /** Unset GPU, CPU and memory are picked together by the backend as a common combo. */
  gpuProfile?: string;
  webrtcMode: string;
  os: string;
  windowsRelease: string;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  geoPermission: string;
  geoLatitude: string;
  geoLongitude: string;
  geoAccuracy: string;
  homeUrl: string;
  idleTimeoutMinutes: number;
  webauthnEnabled: boolean;
};

type Props = {
  open: boolean;
  title: string;
  initialName?: string;
  initialDescription?: string;
  initialNotepad?: string;
  initialProxyId?: string | null;
  initialCustomProxy?: SessionProxy | null;
  initialGroupId?: string | null;
  initialTimezone?: string;
  initialChromeLanguage?: string;
  initialGpuProfile?: string;
  initialWebrtcMode?: string;
  initialOs?: string;
  initialWindowsRelease?: string;
  initialHardwareConcurrency?: number;
  initialDeviceMemory?: number;
  initialGeoPermission?: string;
  initialGeoLatitude?: number | null;
  initialGeoLongitude?: number | null;
  initialGeoAccuracy?: number;
  initialHomeUrl?: string;
  initialIdleTimeoutMinutes?: number;
  initialWebauthnEnabled?: boolean;
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
  initialNotepad = '',
  initialProxyId = null,
  initialCustomProxy = null,
  initialGroupId = null,
  initialTimezone = DEFAULT_TIMEZONE,
  initialChromeLanguage = DEFAULT_CHROME_LANGUAGE,
  initialGpuProfile,
  initialWebrtcMode = DEFAULT_WEBRTC_MODE,
  initialOs = DEFAULT_OS,
  initialWindowsRelease = DEFAULT_WINDOWS_RELEASE,
  initialHardwareConcurrency,
  initialDeviceMemory,
  initialGeoPermission = 'ask',
  initialGeoLatitude = null,
  initialGeoLongitude = null,
  initialGeoAccuracy = 100,
  initialHomeUrl = '',
  initialIdleTimeoutMinutes = DEFAULT_IDLE_TIMEOUT_MINUTES,
  initialWebauthnEnabled = false,
  proxies,
  groups,
  submitLabel,
  nameEditable = true,
  showMeta = true,
  onCancel,
  onSubmit,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [notepad, setNotepad] = useState(initialNotepad);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [chromeLanguage, setChromeLanguage] = useState(initialChromeLanguage);
  const [gpuProfile, setGpuProfile] = useState(initialGpuProfile || RANDOM_KEY);
  const [webrtcMode, setWebrtcMode] = useState(initialWebrtcMode);
  const [os, setOs] = useState<string>(coerceOs(initialOs));
  const [windowsRelease, setWindowsRelease] = useState<string>(coerceWindowsRelease(initialWindowsRelease));
  const [hardware, setHardware] = useState(() =>
    initialHardwareKey(initialHardwareConcurrency, initialDeviceMemory),
  );
  const [geoPermission, setGeoPermission] = useState(initialGeoPermission);
  const [geoLatitude, setGeoLatitude] = useState(initialGeoLatitude == null ? '' : String(initialGeoLatitude));
  const [geoLongitude, setGeoLongitude] = useState(initialGeoLongitude == null ? '' : String(initialGeoLongitude));
  const [geoAccuracy, setGeoAccuracy] = useState(String(initialGeoAccuracy ?? 100));
  const [homeUrl, setHomeUrl] = useState(initialHomeUrl);
  const [webauthnEnabled, setWebauthnEnabled] = useState(initialWebauthnEnabled);
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState(
    String(initialIdleTimeoutMinutes ?? DEFAULT_IDLE_TIMEOUT_MINUTES),
  );
  const initialProxyChoice = () => (initialCustomProxy ? CUSTOM_PROXY_KEY : initialProxyId || NONE_KEY);
  const initialCustomDraft = () => (initialCustomProxy ? proxyDraftFrom(initialCustomProxy) : emptyProxyDraft());
  const [proxyId, setProxyId] = useState(initialProxyChoice);
  const [customDraft, setCustomDraft] = useState<ProxyDraft>(initialCustomDraft);
  const custom = proxyId === CUSTOM_PROXY_KEY;
  const [groupId, setGroupId] = useState(initialGroupId || NONE_KEY);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setDescription(initialDescription);
    setNotepad(initialNotepad);
    setTimezone(initialTimezone || DEFAULT_TIMEZONE);
    setChromeLanguage(initialChromeLanguage || DEFAULT_CHROME_LANGUAGE);
    setGpuProfile(initialGpuProfile || RANDOM_KEY);
    setWebrtcMode(initialWebrtcMode || DEFAULT_WEBRTC_MODE);
    setOs(coerceOs(initialOs));
    setWindowsRelease(coerceWindowsRelease(initialWindowsRelease));
    setHardware(initialHardwareKey(initialHardwareConcurrency, initialDeviceMemory));
    setGeoPermission(initialGeoPermission || 'ask');
    setGeoLatitude(initialGeoLatitude == null ? '' : String(initialGeoLatitude));
    setGeoLongitude(initialGeoLongitude == null ? '' : String(initialGeoLongitude));
    setGeoAccuracy(String(initialGeoAccuracy ?? 100));
    setHomeUrl(initialHomeUrl || '');
    setWebauthnEnabled(initialWebauthnEnabled);
    setIdleTimeoutMinutes(String(initialIdleTimeoutMinutes ?? DEFAULT_IDLE_TIMEOUT_MINUTES));
    setProxyId(initialProxyChoice());
    setCustomDraft(initialCustomDraft());
    setGroupId(initialGroupId || NONE_KEY);
    setAdvancedOpen(false);
    setBusy(false);
  }, [
    open,
    initialName,
    initialDescription,
    initialNotepad,
    initialProxyId,
    initialCustomProxy,
    initialGroupId,
    initialTimezone,
    initialChromeLanguage,
    initialGpuProfile,
    initialWebrtcMode,
    initialOs,
    initialWindowsRelease,
    initialHardwareConcurrency,
    initialDeviceMemory,
    initialGeoPermission,
    initialGeoLatitude,
    initialGeoLongitude,
    initialGeoAccuracy,
    initialHomeUrl,
    initialIdleTimeoutMinutes,
    initialWebauthnEnabled,
  ]);

  return (
    <Dialog open={open} onOpenChange={(v: boolean) => !v && onCancel()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
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
              notepad,
              timezone: timezone || DEFAULT_TIMEZONE,
              chromeLanguage: chromeLanguage || DEFAULT_CHROME_LANGUAGE,
              gpuProfile: gpuProfile === RANDOM_KEY ? undefined : gpuProfile,
              webrtcMode: webrtcMode || DEFAULT_WEBRTC_MODE,
              os,
              windowsRelease,
              hardwareConcurrency: parseHardwareProfileId(hardware)?.cores,
              deviceMemory: parseHardwareProfileId(hardware)?.memory,
              geoPermission: geoPermission || 'ask',
              geoLatitude: geoLatitude.trim(),
              geoLongitude: geoLongitude.trim(),
              geoAccuracy: geoAccuracy.trim(),
              homeUrl: homeUrl.trim(),
              webauthnEnabled,
              idleTimeoutMinutes: (() => {
                const n = Number.parseInt(String(idleTimeoutMinutes), 10);
                if (!Number.isFinite(n) || n <= 0) return 0;
                return Math.min(IDLE_TIMEOUT_MINUTES_MAX, n);
              })(),
              proxyId: proxyId === NONE_KEY || custom ? null : proxyId,
              customProxy: custom ? proxyDraftPayload(customDraft) : null,
              groupId: groupId === NONE_KEY ? null : groupId,
            })
              .then(onCancel)
              .catch((e: Error) => toast.error(e.message))
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
              <div className="grid gap-2">
                <Label htmlFor="session-notepad">Notepad</Label>
                <Textarea
                  id="session-notepad"
                  value={notepad}
                  placeholder="会话便签，仅授权用户可在桌面查看和编辑"
                  className="min-h-24"
                  onChange={(e) => setNotepad(e.target.value)}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>时区</Label>
                  <SearchSelect
                    value={timezone}
                    onChange={setTimezone}
                    options={TIMEZONE_OPTIONS}
                    searchPlaceholder="搜索城市或时区"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Chrome 语言</Label>
                  <SearchSelect
                    value={chromeLanguage}
                    onChange={setChromeLanguage}
                    options={LANGUAGE_OPTIONS}
                    searchPlaceholder="搜索语言"
                  />
                </div>
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
              <div className="grid gap-2">
                <Label htmlFor="session-url">默认网址</Label>
                <Input
                  id="session-url"
                  value={homeUrl}
                  placeholder="留空打开新标签页"
                  onChange={(e) => setHomeUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  打开窗口时使用，留空为 Chrome 新标签页，也可填 about:blank
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
                <SelectItem value={CUSTOM_PROXY_KEY}>临时代理（只属于这个会话）</SelectItem>
                {proxies.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} · {p.type}://{p.host}:{p.port}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              运行中切换代理不重启浏览器，只断开现有连接；WebRTC 需要出口公网 IP 且 IP 变化时会重启
            </p>
          </div>
          {custom && (
            <div className="grid gap-4 rounded-lg border p-3">
              <ProxyFields
                idPrefix="session-proxy"
                value={customDraft}
                onChange={setCustomDraft}
                fronts={proxies}
              />
              {initialCustomProxy?.lastTest ? (
                <p className="text-xs text-muted-foreground">
                  上次测试：{proxyTestLabel(initialCustomProxy.lastTest)}
                </p>
              ) : null}
            </div>
          )}
          {showMeta && (
            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="grid gap-4">
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="justify-start gap-1.5 px-0 text-muted-foreground hover:bg-transparent [&[data-state=open]>svg]:rotate-180"
                >
                  <ChevronDownIcon className="transition-transform" />
                  高级（操作系统、显卡、CPU / 内存、WebRTC、定位、通行密钥）
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label>操作系统</Label>
                    <Select
                      value={os}
                      onValueChange={setOs}
                    >
                      <SelectTrigger className="w-full" aria-label="操作系统">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {OS_TYPES.map((id) => (
                          <SelectItem key={id} value={id}>
                            {OS_LABELS[id]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {os === 'windows' && (
                    <div className="grid gap-2">
                      <Label>Windows 版本</Label>
                      <Select
                        value={windowsRelease}
                        onValueChange={setWindowsRelease}
                      >
                        <SelectTrigger className="w-full" aria-label="Windows 版本">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          {WINDOWS_RELEASES.map((id) => (
                            <SelectItem key={id} value={id}>
                              {WINDOWS_RELEASE_LABELS[id]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {os === 'windows' && (
                    <p className="text-xs text-muted-foreground sm:col-span-2">
                      UA、navigator.platform 和 UA-CH 报告为 Windows，字体自动换成所选版本的 Windows 字体库。建议配合真实 NVIDIA
                      显卡使用，SwiftShader 在真实 Windows 上很少见。修改后会话需要重启。
                    </p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label>显卡</Label>
                  <SearchSelect
                    value={gpuProfile}
                    onChange={setGpuProfile}
                    options={initialGpuProfile ? GPU_OPTIONS : GPU_OPTIONS_WITH_RANDOM}
                    searchPlaceholder="搜索 GTX / RTX"
                  />
                  <p className="text-xs text-muted-foreground">
                    WebGL 卡名和 WebGPU vendor/architecture/device 一起改。只限
                    NVIDIA 桌面卡，扩展和 MAX_* 仍用本机。
                  </p>
                  {gpuProfile === RANDOM_KEY || hardware === RANDOM_KEY ? (
                    <p className="text-xs text-muted-foreground">
                      随机项创建时按显卡档位和常见占比一起抽取，例如 GTX 1650 多配 4～6 核 / 8～16 GB，RTX 4090
                      多配 16～32 核 / 32 GB；已指定的项会参与搭配。
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-2">
                  <Label>CPU / 内存</Label>
                  <Select value={hardware} onValueChange={setHardware}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper" className="max-h-64">
                      {!(initialHardwareConcurrency && initialDeviceMemory) && (
                        <SelectItem value={RANDOM_KEY}>{RANDOM_LABEL}</SelectItem>
                      )}
                      {hardwareProfileOptions(
                        initialHardwareKey(initialHardwareConcurrency, initialDeviceMemory),
                      ).map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    改 navigator.hardwareConcurrency、navigator.deviceMemory 和 Device-Memory
                    请求头。Chrome 桌面版内存只报 2/4/8/16/32 GB，32 表示 32 GB 及以上。
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label>WebRTC</Label>
                  <Select value={webrtcMode} onValueChange={setWebrtcMode}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {WEBRTC_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>地理位置权限</Label>
                  <Select value={geoPermission} onValueChange={setGeoPermission}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ask">询问</SelectItem>
                      <SelectItem value="allow">允许</SelectItem>
                      <SelectItem value="block">禁止</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="grid gap-2">
                    <Label>纬度</Label>
                    <Input value={geoLatitude} placeholder="可选" onChange={(e) => setGeoLatitude(e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <Label>经度</Label>
                    <Input value={geoLongitude} placeholder="可选" onChange={(e) => setGeoLongitude(e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <Label>精度 (m)</Label>
                    <Input value={geoAccuracy} onChange={(e) => setGeoAccuracy(e.target.value)} />
                  </div>
                </div>
                <div className="grid gap-2">
                  <div className="flex items-center gap-3">
                    <Switch id="webauthn-enabled" checked={webauthnEnabled} onCheckedChange={setWebauthnEnabled} />
                    <Label htmlFor="webauthn-enabled">通行密钥（虚拟认证器）</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    服务端给每个标签页挂一个平台认证器，网页创建的通行密钥（含私钥）会保存到会话里。开启后
                    isUserVerifyingPlatformAuthenticatorAvailable() 返回 true。
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
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
