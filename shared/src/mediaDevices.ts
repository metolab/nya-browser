export type MediaDeviceKind = 'audioinput' | 'audiooutput' | 'videoinput';

export type MediaDevicePreset = {
  audioInput: string;
  audioOutput: string;
  videoInput: string;
};

export const NATIVE_MEDIA_LABEL = 'native';

export const EMPTY_MEDIA_DEVICES: MediaDevicePreset = {
  audioInput: '',
  audioOutput: '',
  videoInput: '',
};

/** Common consumer labels from public enumerateDevices dumps / USB ID lists. ASCII only. */
export const MEDIA_AUDIO_INPUTS = [
  'Default - Microphone (Realtek(R) Audio)',
  'Microphone (Realtek High Definition Audio)',
  'USB Audio Device',
  'Headset Microphone (Logitech H390)',
  'Microphone Array (Intel Smart Sound Technology)',
  'Microphone (HD Webcam C615)',
] as const;

export const MEDIA_AUDIO_OUTPUTS = [
  'Default - Speakers (Realtek(R) Audio)',
  'Speakers (Realtek High Definition Audio)',
  'NVIDIA High Definition Audio',
  'Headphones (Realtek USB Audio)',
  'Digital Output (S/PDIF)',
  'Speakers (USB Audio Device)',
] as const;

export const MEDIA_VIDEO_INPUTS = [
  'HD Pro Webcam C920',
  'Integrated Camera',
  'USB Camera',
  'Logitech StreamCam',
  'USB2.0 HD UVC WebCam',
  'HD Webcam C615',
] as const;

export const DEFAULT_MEDIA_DEVICES: MediaDevicePreset = EMPTY_MEDIA_DEVICES;

function pick<T>(list: readonly T[], n: number) {
  return list[Math.abs(n) % list.length];
}

function seedWord(seed: string, offset: number) {
  const hex = String(seed || '')
    .replace(/[^0-9a-f]/gi, '')
    .padEnd(offset + 8, '0');
  const n = Number.parseInt(hex.slice(offset, offset + 8), 16);
  return Number.isFinite(n) ? n : offset + 1;
}

export function mediaDevicesFromSeed(seed: string): MediaDevicePreset {
  const a = seedWord(seed, 0);
  const b = seedWord(seed, 8);
  const c = seedWord(seed, 16);
  return {
    audioInput: pick(MEDIA_AUDIO_INPUTS, a),
    audioOutput: pick(MEDIA_AUDIO_OUTPUTS, b >>> 3),
    videoInput: pick(MEDIA_VIDEO_INPUTS, c >>> 5),
  };
}

function clipLabel(value: unknown, fallback: string) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === NATIVE_MEDIA_LABEL) return '';
  return raw.length <= 80 ? raw : fallback;
}

export function normalizeMediaDevices(input: unknown, seed: string): MediaDevicePreset {
  if (!input || typeof input !== 'object') return { ...EMPTY_MEDIA_DEVICES };
  const obj = input as Partial<MediaDevicePreset>;
  const keys: Array<keyof MediaDevicePreset> = ['audioInput', 'audioOutput', 'videoInput'];
  if (!keys.some((key) => key in obj)) return { ...EMPTY_MEDIA_DEVICES };
  const generated = mediaDevicesFromSeed(seed);
  return {
    audioInput: 'audioInput' in obj ? clipLabel(obj.audioInput, generated.audioInput) : '',
    audioOutput: 'audioOutput' in obj ? clipLabel(obj.audioOutput, generated.audioOutput) : '',
    videoInput: 'videoInput' in obj ? clipLabel(obj.videoInput, generated.videoInput) : '',
  };
}

export function mediaDevicesSpoofed(media: MediaDevicePreset | null | undefined) {
  return Boolean(media?.audioInput || media?.audioOutput || media?.videoInput);
}
