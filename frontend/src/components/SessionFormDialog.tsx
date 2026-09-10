import { useEffect, useState } from 'react';
import type { ProxyRecord, SessionGroup } from '@nya/shared';
import {
  COMMON_TIMEZONES,
  DEFAULT_CHROME_LANGUAGE,
  DEFAULT_GPU_PROFILE,
  NATIVE_MEDIA_LABEL,
  DEFAULT_WEBRTC_MODE,
  DEFAULT_FONT_PROFILE,
  DEFAULT_TIMEZONE,
  GPU_PROFILES,
  MEDIA_AUDIO_INPUTS,
  MEDIA_AUDIO_OUTPUTS,
  MEDIA_VIDEO_INPUTS,
  WEBRTC_MODES,
  WEBRTC_MODE_LABELS,
  FONT_PROFILES,
  FONT_PROFILE_LABELS,
  IDLE_TIMEOUT_MINUTES_MAX,
  PINNED_CHROME_LANGUAGES,
  chromeLanguageOptionLabel,
  gpuProfileOptionLabel,
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
const GPU_OPTIONS = GPU_PROFILES.map((row) => ({
  value: row.id,
  label: gpuProfileOptionLabel(row.id),
  group: row.group,
}));
const WEBRTC_OPTIONS = WEBRTC_MODES.map((id) => ({
  value: id,
  label: WEBRTC_MODE_LABELS[id],
}));
const FONT_OPTIONS = FONT_PROFILES.map((id) => ({
  value: id,
  label: FONT_PROFILE_LABELS[id],
}));

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
  fontProfile: string;
  deviceName: string;
  mediaAudioInput: string;
  mediaAudioOutput: string;
  mediaVideoInput: string;
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
  initialFontProfile?: string;
  initialDeviceName?: string;
  initialMediaAudioInput?: string;
  initialMediaAudioOutput?: string;
  initialMediaVideoInput?: string;
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
  initialTimezone = DEFAULT_TIMEZONE,
  initialChromeLanguage = DEFAULT_CHROME_LANGUAGE,
  initialGpuProfile = DEFAULT_GPU_PROFILE,
  initialWebrtcMode = DEFAULT_WEBRTC_MODE,
  initialFontProfile = DEFAULT_FONT_PROFILE,
  initialDeviceName = '',
  initialMediaAudioInput = NATIVE_MEDIA_LABEL,
  initialMediaAudioOutput = NATIVE_MEDIA_LABEL,
  initialMediaVideoInput = NATIVE_MEDIA_LABEL,
  initialGeoPermission = 'ask',
  initialGeoLatitude = null,
  initialGeoLongitude = null,
  initialGeoAccuracy = 100,
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
  const [notepad, setNotepad] = useState(initialNotepad);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [chromeLanguage, setChromeLanguage] = useState(initialChromeLanguage);
  const [gpuProfile, setGpuProfile] = useState(initialGpuProfile);
  const [webrtcMode, setWebrtcMode] = useState(initialWebrtcMode);
  const [fontProfile, setFontProfile] = useState(initialFontProfile);
  const [deviceName, setDeviceName] = useState(initialDeviceName);
  const [mediaAudioInput, setMediaAudioInput] = useState(initialMediaAudioInput);
  const [mediaAudioOutput, setMediaAudioOutput] = useState(initialMediaAudioOutput);
  const [mediaVideoInput, setMediaVideoInput] = useState(initialMediaVideoInput);
  const [geoPermission, setGeoPermission] = useState(initialGeoPermission);
  const [geoLatitude, setGeoLatitude] = useState(initialGeoLatitude == null ? '' : String(initialGeoLatitude));
  const [geoLongitude, setGeoLongitude] = useState(initialGeoLongitude == null ? '' : String(initialGeoLongitude));
  const [geoAccuracy, setGeoAccuracy] = useState(String(initialGeoAccuracy ?? 100));
  const [homeUrl, setHomeUrl] = useState(initialHomeUrl);
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState(String(initialIdleTimeoutMinutes ?? 0));
  const [proxyId, setProxyId] = useState(initialProxyId || NONE_KEY);
  const [groupId, setGroupId] = useState(initialGroupId || NONE_KEY);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setDescription(initialDescription);
    setNotepad(initialNotepad);
    setTimezone(initialTimezone || DEFAULT_TIMEZONE);
    setChromeLanguage(initialChromeLanguage || DEFAULT_CHROME_LANGUAGE);
    setGpuProfile(initialGpuProfile || DEFAULT_GPU_PROFILE);
    setWebrtcMode(initialWebrtcMode || DEFAULT_WEBRTC_MODE);
    setFontProfile(initialFontProfile || DEFAULT_FONT_PROFILE);
    setDeviceName(initialDeviceName || '');
    setMediaAudioInput(initialMediaAudioInput || NATIVE_MEDIA_LABEL);
    setMediaAudioOutput(initialMediaAudioOutput || NATIVE_MEDIA_LABEL);
    setMediaVideoInput(initialMediaVideoInput || NATIVE_MEDIA_LABEL);
    setGeoPermission(initialGeoPermission || 'ask');
    setGeoLatitude(initialGeoLatitude == null ? '' : String(initialGeoLatitude));
    setGeoLongitude(initialGeoLongitude == null ? '' : String(initialGeoLongitude));
    setGeoAccuracy(String(initialGeoAccuracy ?? 100));
    setHomeUrl(initialHomeUrl || 'https://www.google.com/');
    setIdleTimeoutMinutes(String(initialIdleTimeoutMinutes ?? 0));
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
    initialFontProfile,
    initialDeviceName,
    initialMediaAudioInput,
    initialMediaAudioOutput,
    initialMediaVideoInput,
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
              timezone: timezone || DEFAULT_TIMEZONE,
              chromeLanguage: chromeLanguage || DEFAULT_CHROME_LANGUAGE,
              gpuProfile: gpuProfile || DEFAULT_GPU_PROFILE,
              webrtcMode: webrtcMode || DEFAULT_WEBRTC_MODE,
              fontProfile: fontProfile || DEFAULT_FONT_PROFILE,
              deviceName: deviceName.trim(),
              mediaAudioInput: mediaAudioInput.trim(),
              mediaAudioOutput: mediaAudioOutput.trim(),
              mediaVideoInput: mediaVideoInput.trim(),
              geoPermission: geoPermission || 'ask',
              geoLatitude: geoLatitude.trim(),
              geoLongitude: geoLongitude.trim(),
              geoAccuracy: geoAccuracy.trim(),
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
                <Label>字体库</Label>
                <Select value={fontProfile} onValueChange={setFontProfile}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {FONT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  伪造 Windows 系统字体枚举，不安装整套字体。measureText 走 Liberation / Noto 度量别名。
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="session-device">设备名</Label>
                <Input
                  id="session-device"
                  value={deviceName}
                  maxLength={32}
                  placeholder="留空则按指纹生成 DESKTOP-XXXX"
                  onChange={(e) => setDeviceName(e.target.value)}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label>麦克风</Label>
                  <SearchSelect
                    value={mediaAudioInput || NATIVE_MEDIA_LABEL}
                    onChange={setMediaAudioInput}
                    options={[
                      { value: NATIVE_MEDIA_LABEL, label: '真实设备（不伪装）' },
                      ...MEDIA_AUDIO_INPUTS.map((v) => ({ value: v, label: v })),
                    ]}
                    searchPlaceholder="搜索"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>扬声器</Label>
                  <SearchSelect
                    value={mediaAudioOutput || NATIVE_MEDIA_LABEL}
                    onChange={setMediaAudioOutput}
                    options={[
                      { value: NATIVE_MEDIA_LABEL, label: '真实设备（不伪装）' },
                      ...MEDIA_AUDIO_OUTPUTS.map((v) => ({ value: v, label: v })),
                    ]}
                    searchPlaceholder="搜索"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>摄像头</Label>
                  <SearchSelect
                    value={mediaVideoInput || NATIVE_MEDIA_LABEL}
                    onChange={setMediaVideoInput}
                    options={[
                      { value: NATIVE_MEDIA_LABEL, label: '真实设备（不伪装）' },
                      ...MEDIA_VIDEO_INPUTS.map((v) => ({ value: v, label: v })),
                    ]}
                    searchPlaceholder="搜索"
                  />
                </div>
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
