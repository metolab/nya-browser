import { useEffect, useState } from 'react';
import type { ProxyRecord } from '@nya/shared';
import {
  COMMON_TIMEZONES,
  NATIVE_MEDIA_LABEL,
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
import { NONE_KEY } from '@/lib/groups';

const KEEP_KEY = '__keep__';
const COMMON_TZ = new Set<string>(COMMON_TIMEZONES);
const TIMEZONE_OPTIONS = [
  { value: KEEP_KEY, label: '不修改' },
  ...listTimezones().map((tz) => ({
    value: tz,
    label: timezoneOptionLabel(tz),
    group: COMMON_TZ.has(tz) ? '常用' : '全部',
  })),
];
const PINNED_LANG = new Set<string>(PINNED_CHROME_LANGUAGES);
const LANGUAGE_OPTIONS = [
  { value: KEEP_KEY, label: '不修改' },
  ...CHROME_LANGUAGES.map((code) => ({
    value: code,
    label: chromeLanguageOptionLabel(code),
    group: PINNED_LANG.has(code) ? '常用' : '全部',
  })),
];
const GPU_OPTIONS = [
  { value: KEEP_KEY, label: '不修改' },
  ...GPU_PROFILES.map((row) => ({
    value: row.id,
    label: gpuProfileOptionLabel(row.id),
    group: row.group,
  })),
];
const WEBRTC_OPTIONS = [
  { value: KEEP_KEY, label: '不修改' },
  ...WEBRTC_MODES.map((id) => ({
    value: id,
    label: WEBRTC_MODE_LABELS[id],
  })),
];
const FONT_OPTIONS = [
  { value: KEEP_KEY, label: '不修改' },
  ...FONT_PROFILES.map((id) => ({
    value: id,
    label: FONT_PROFILE_LABELS[id],
  })),
];

function mediaLabel(value: string) {
  const raw = value.trim();
  if (!raw || raw === NATIVE_MEDIA_LABEL) return '';
  return raw;
}

export type BatchSessionPatch = {
  proxyId?: string | null;
  timezone?: string;
  chromeLanguage?: string;
  gpuProfile?: string;
  webrtcMode?: string;
  fontProfile?: string;
  mediaDevices?: { audioInput?: string; audioOutput?: string; videoInput?: string };
  geo?: {
    permission?: string;
    latitude?: number | null;
    longitude?: number | null;
    accuracy?: number;
  };
  homeUrl?: string;
  idleTimeoutMinutes?: number;
};

type Props = {
  open: boolean;
  count: number;
  proxies: ProxyRecord[];
  onCancel: () => void;
  onSubmit: (patch: BatchSessionPatch) => Promise<void>;
};

export default function BatchSessionFormDialog({ open, count, proxies, onCancel, onSubmit }: Props) {
  const [busy, setBusy] = useState(false);
  const [timezone, setTimezone] = useState(KEEP_KEY);
  const [chromeLanguage, setChromeLanguage] = useState(KEEP_KEY);
  const [gpuProfile, setGpuProfile] = useState(KEEP_KEY);
  const [webrtcMode, setWebrtcMode] = useState(KEEP_KEY);
  const [fontProfile, setFontProfile] = useState(KEEP_KEY);
  const [mediaAudioInput, setMediaAudioInput] = useState(KEEP_KEY);
  const [mediaAudioOutput, setMediaAudioOutput] = useState(KEEP_KEY);
  const [mediaVideoInput, setMediaVideoInput] = useState(KEEP_KEY);
  const [geoPermission, setGeoPermission] = useState(KEEP_KEY);
  const [geoLatitude, setGeoLatitude] = useState('');
  const [geoLongitude, setGeoLongitude] = useState('');
  const [geoAccuracy, setGeoAccuracy] = useState('');
  const [homeUrl, setHomeUrl] = useState('');
  const [idleTimeoutMinutes, setIdleTimeoutMinutes] = useState('');
  const [proxyId, setProxyId] = useState(KEEP_KEY);

  useEffect(() => {
    if (!open) return;
    setTimezone(KEEP_KEY);
    setChromeLanguage(KEEP_KEY);
    setGpuProfile(KEEP_KEY);
    setWebrtcMode(KEEP_KEY);
    setFontProfile(KEEP_KEY);
    setMediaAudioInput(KEEP_KEY);
    setMediaAudioOutput(KEEP_KEY);
    setMediaVideoInput(KEEP_KEY);
    setGeoPermission(KEEP_KEY);
    setGeoLatitude('');
    setGeoLongitude('');
    setGeoAccuracy('');
    setHomeUrl('');
    setIdleTimeoutMinutes('');
    setProxyId(KEEP_KEY);
    setBusy(false);
  }, [open]);

  const buildPatch = (): BatchSessionPatch | null => {
    const patch: BatchSessionPatch = {};
    if (proxyId !== KEEP_KEY) patch.proxyId = proxyId === NONE_KEY ? null : proxyId;
    if (timezone !== KEEP_KEY) patch.timezone = timezone;
    if (chromeLanguage !== KEEP_KEY) patch.chromeLanguage = chromeLanguage;
    if (gpuProfile !== KEEP_KEY) patch.gpuProfile = gpuProfile;
    if (webrtcMode !== KEEP_KEY) patch.webrtcMode = webrtcMode;
    if (fontProfile !== KEEP_KEY) patch.fontProfile = fontProfile;

    const mediaDevices: NonNullable<BatchSessionPatch['mediaDevices']> = {};
    if (mediaAudioInput !== KEEP_KEY) mediaDevices.audioInput = mediaLabel(mediaAudioInput);
    if (mediaAudioOutput !== KEEP_KEY) mediaDevices.audioOutput = mediaLabel(mediaAudioOutput);
    if (mediaVideoInput !== KEEP_KEY) mediaDevices.videoInput = mediaLabel(mediaVideoInput);
    if (Object.keys(mediaDevices).length) patch.mediaDevices = mediaDevices;

    const geo: NonNullable<BatchSessionPatch['geo']> = {};
    if (geoPermission !== KEEP_KEY) geo.permission = geoPermission;
    if (geoLatitude.trim() !== '') {
      const lat = Number(geoLatitude);
      if (Number.isFinite(lat)) geo.latitude = lat;
    }
    if (geoLongitude.trim() !== '') {
      const lng = Number(geoLongitude);
      if (Number.isFinite(lng)) geo.longitude = lng;
    }
    if (geoAccuracy.trim() !== '') {
      const acc = Number.parseInt(geoAccuracy, 10);
      if (Number.isFinite(acc) && acc >= 10) geo.accuracy = acc;
    }
    if (Object.keys(geo).length) patch.geo = geo;

    if (homeUrl.trim()) patch.homeUrl = homeUrl.trim();
    if (idleTimeoutMinutes.trim() !== '') {
      const n = Number.parseInt(idleTimeoutMinutes, 10);
      if (!Number.isFinite(n) || n <= 0) patch.idleTimeoutMinutes = 0;
      else patch.idleTimeoutMinutes = Math.min(IDLE_TIMEOUT_MINUTES_MAX, n);
    }

    return Object.keys(patch).length ? patch : null;
  };

  return (
    <Dialog open={open} onOpenChange={(v: boolean) => !v && !busy && onCancel()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>批量修改 · {count} 个会话</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const patch = buildPatch();
            if (!patch) return;
            setBusy(true);
            void onSubmit(patch)
              .then(onCancel)
              .finally(() => setBusy(false));
          }}
        >
          <p className="text-sm text-muted-foreground">
            未改动的项保持原值。不会修改名称、描述、Notepad、设备名和目录。
          </p>
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
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label>麦克风</Label>
              <SearchSelect
                value={mediaAudioInput}
                onChange={setMediaAudioInput}
                options={[
                  { value: KEEP_KEY, label: '不修改' },
                  { value: NATIVE_MEDIA_LABEL, label: '真实设备（不伪装）' },
                  ...MEDIA_AUDIO_INPUTS.map((v) => ({ value: v, label: v })),
                ]}
                searchPlaceholder="搜索"
              />
            </div>
            <div className="grid gap-2">
              <Label>扬声器</Label>
              <SearchSelect
                value={mediaAudioOutput}
                onChange={setMediaAudioOutput}
                options={[
                  { value: KEEP_KEY, label: '不修改' },
                  { value: NATIVE_MEDIA_LABEL, label: '真实设备（不伪装）' },
                  ...MEDIA_AUDIO_OUTPUTS.map((v) => ({ value: v, label: v })),
                ]}
                searchPlaceholder="搜索"
              />
            </div>
            <div className="grid gap-2">
              <Label>摄像头</Label>
              <SearchSelect
                value={mediaVideoInput}
                onChange={setMediaVideoInput}
                options={[
                  { value: KEEP_KEY, label: '不修改' },
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
                <SelectItem value={KEEP_KEY}>不修改</SelectItem>
                <SelectItem value="ask">询问</SelectItem>
                <SelectItem value="allow">允许</SelectItem>
                <SelectItem value="block">禁止</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label>纬度</Label>
              <Input value={geoLatitude} placeholder="不修改" onChange={(e) => setGeoLatitude(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>经度</Label>
              <Input value={geoLongitude} placeholder="不修改" onChange={(e) => setGeoLongitude(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>精度 (m)</Label>
              <Input value={geoAccuracy} placeholder="不修改" onChange={(e) => setGeoAccuracy(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="batch-session-url">默认网址</Label>
            <Input
              id="batch-session-url"
              value={homeUrl}
              placeholder="不修改"
              onChange={(e) => setHomeUrl(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="batch-session-idle">空闲超时（分钟）</Label>
            <Input
              id="batch-session-idle"
              type="number"
              min={0}
              max={IDLE_TIMEOUT_MINUTES_MAX}
              step={1}
              value={idleTimeoutMinutes}
              placeholder="不修改"
              onChange={(e) => setIdleTimeoutMinutes(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>代理</Label>
            <Select value={proxyId} onValueChange={setProxyId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" className="max-h-64">
                <SelectItem value={KEEP_KEY}>不修改</SelectItem>
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
            <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
              取消
            </Button>
            <Button type="submit" disabled={busy || !buildPatch()}>
              {busy ? '更新中…' : '应用到所选会话'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
