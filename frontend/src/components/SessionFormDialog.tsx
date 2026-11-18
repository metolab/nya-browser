import { useEffect, useState } from 'react';
import type { ProxyRecord, SessionGroup } from '@nya/shared';
import {
  COMMON_TIMEZONES,
  DEFAULT_GPU_PROFILE,
  DEFAULT_WEBRTC_MODE,
  AUTO_LOCALE,
  resolveSessionLocale,
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
import SearchSelect from '@/components/SearchSelect';
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
const AUTO_OPTION = { value: AUTO_LOCALE, label: '自动（跟随代理出口国家）', group: '常用' };
const TIMEZONE_OPTIONS = [
  AUTO_OPTION,
  ...listTimezones().map((tz) => ({
    value: tz,
    label: timezoneOptionLabel(tz),
    group: COMMON_TZ.has(tz) ? '常用' : '全部',
  })),
];
const PINNED_LANG = new Set<string>(PINNED_CHROME_LANGUAGES);
const LANGUAGE_OPTIONS = [
  AUTO_OPTION,
  ...CHROME_LANGUAGES.map((code) => ({
    value: code,
    label: chromeLanguageOptionLabel(code),
    group: PINNED_LANG.has(code) ? '常用' : '全部',
  })),
];
const GPU_OPTIONS = GPU_PROFILES.map((row) => ({
  value: row.id,
  label: gpuProfileOptionLabel(row.id),
  group: row.group,
}));
const WEBRTC_OPTIONS = WEBRTC_MODES.map((id) => ({
  value: id,
  label: WEBRTC_MODE_LABELS[id],
}));
const RANDOM_HARDWARE_KEY = '__random__';

function initialHardwareKey(cores?: number, memory?: number) {
  return cores && memory ? hardwareProfileId(cores, memory) : RANDOM_HARDWARE_KEY;
}

export type SessionFormValues = {
  name: string;
  description: string;
  notepad: string;
  groupId: string | null;
  proxyId: string | null;
  timezone: string;
  chromeLanguage: string;
  gpuProfile: string;
  webrtcMode: string;
  os: string;
  windowsRelease: string;
  /** Unset means the backend picks a common combo from the fingerprint seed. */
  hardwareConcurrency?: number;
  deviceMemory?: number;
  geoPermission: string;
  geoLatitude: string;
  geoLongitude: string;
  geoAccuracy: string;
  homeUrl: string;
  idleTimeoutMinutes: number;
};

type Props = {
  open: boolean;
  title: string;
  initialName?: string;
  initialDescription?: string;
  initialNotepad?: string;
  initialProxyId?: string | null;
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
  initialGroupId = null,
  initialTimezone = AUTO_LOCALE,
  initialChromeLanguage = AUTO_LOCALE,
  initialGpuProfile = DEFAULT_GPU_PROFILE,
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
  const [notepad, setNotepad] = useState(initialNotepad);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [chromeLanguage, setChromeLanguage] = useState(initialChromeLanguage);
  const [gpuProfile, setGpuProfile] = useState(initialGpuProfile);
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
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState(
    String(initialIdleTimeoutMinutes ?? DEFAULT_IDLE_TIMEOUT_MINUTES),
  );
  const [proxyId, setProxyId] = useState(initialProxyId || NONE_KEY);
  const autoLocaleHint = (() => {
    if (timezone !== AUTO_LOCALE && chromeLanguage !== AUTO_LOCALE) return '';
    const exit = proxies.find((p) => p.id === proxyId)?.lastTest;
    const resolved = resolveSessionLocale({ timezone, chromeLanguage }, exit);
    const now = `${resolved.timezone} · ${chromeLanguageOptionLabel(resolved.language)}`;
    if (exit?.ok && exit.loc) return `自动：出口 ${exit.region || exit.loc} → ${now}，代理重新测试后下次启动生效`;
    return `自动：代理还没有测试出口，暂用 ${now}；测试代理后下次启动自动切换`;
  })();
  const [groupId, setGroupId] = useState(initialGroupId || NONE_KEY);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setDescription(initialDescription);
    setNotepad(initialNotepad);
    setTimezone(initialTimezone || AUTO_LOCALE);
    setChromeLanguage(initialChromeLanguage || AUTO_LOCALE);
    setGpuProfile(initialGpuProfile || DEFAULT_GPU_PROFILE);
    setWebrtcMode(initialWebrtcMode || DEFAULT_WEBRTC_MODE);
    setOs(coerceOs(initialOs));
    setWindowsRelease(coerceWindowsRelease(initialWindowsRelease));
    setHardware(initialHardwareKey(initialHardwareConcurrency, initialDeviceMemory));
    setGeoPermission(initialGeoPermission || 'ask');
    setGeoLatitude(initialGeoLatitude == null ? '' : String(initialGeoLatitude));
    setGeoLongitude(initialGeoLongitude == null ? '' : String(initialGeoLongitude));
    setGeoAccuracy(String(initialGeoAccuracy ?? 100));
    setHomeUrl(initialHomeUrl || '');
    setIdleTimeoutMinutes(String(initialIdleTimeoutMinutes ?? DEFAULT_IDLE_TIMEOUT_MINUTES));
    setProxyId(initialProxyId || NONE_KEY);
    setGroupId(initialGroupId || NONE_KEY);
    setBusy(false);
  }, [
    open,
    initialName,
    initialDescription,
    initialNotepad,
    initialProxyId,
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
              timezone: timezone || AUTO_LOCALE,
              chromeLanguage: chromeLanguage || AUTO_LOCALE,
              gpuProfile: gpuProfile || DEFAULT_GPU_PROFILE,
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
                {autoLocaleHint ? (
                  <p className="text-xs text-muted-foreground sm:col-span-2">{autoLocaleHint}</p>
                ) : null}
              </div>
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
                  options={GPU_OPTIONS}
                  searchPlaceholder="搜索 GTX / RTX"
                />
                <p className="text-xs text-muted-foreground">
                  WebGL 卡名和 WebGPU vendor/architecture/device 一起改。只限
                  NVIDIA 桌面卡，扩展和 MAX_* 仍用本机。
                </p>
              </div>
              <div className="grid gap-2">
                <Label>CPU / 内存</Label>
                <Select value={hardware} onValueChange={setHardware}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" className="max-h-64">
                    {!(initialHardwareConcurrency && initialDeviceMemory) && (
                      <SelectItem value={RANDOM_HARDWARE_KEY}>随机（常见配置）</SelectItem>
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
