export const WEBRTC_MODES = [
  'offline',
  'disabled',
  'disable-udp',
  'replace',
  'forward',
] as const;

export type WebrtcMode = (typeof WEBRTC_MODES)[number];

/** Matches the old `--disable-features=WebRTC` default: no RTCPeerConnection. */
export const DEFAULT_WEBRTC_MODE: WebrtcMode = 'disabled';

export const WEBRTC_MODE_LABELS: Record<WebrtcMode, string> = {
  offline: '离线（API 在，实际不可用）',
  disabled: '正式禁用（无 RTCPeerConnection）',
  'disable-udp': '禁用 UDP（只走代理 TCP）',
  replace: '替换（ICE 写成代理出口 IP）',
  forward: '转发（强制 Google STUN + 替换 IP）',
};

export function isWebrtcMode(value: unknown): value is WebrtcMode {
  return WEBRTC_MODES.includes(value as WebrtcMode);
}

export function coerceWebrtcMode(input: unknown): WebrtcMode {
  const raw = String(input || '')
    .trim()
    .toLowerCase();
  return isWebrtcMode(raw) ? raw : DEFAULT_WEBRTC_MODE;
}

export function webrtcNeedsPublicIp(mode: WebrtcMode) {
  return mode === 'replace' || mode === 'forward';
}

export function webrtcLocksUdp(mode: WebrtcMode) {
  return mode === 'disable-udp' || mode === 'disabled' || mode === 'offline';
}

export const GOOGLE_STUN_URLS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
] as const;
