import type { OsType } from './osProfiles.js';

/** Endpoint names a session shows to enumerateDevices after a permission grant. */
export type MediaDeviceNames = {
  audioInput: string;
  audioOutput: string;
  videoInput: string;
};

function seedWords(seed: string): [number, number] {
  const hex = String(seed || '').replace(/[^0-9a-f]/gi, '').padEnd(16, '0');
  return [Number.parseInt(hex.slice(0, 8), 16) || 0, Number.parseInt(hex.slice(8, 16), 16) || 0];
}

/** Windows endpoint names ("Microphone (…)", "Speakers (…)") in the display language. */
const WINDOWS_ENDPOINT_WORDS: Record<string, [mic: string, speakers: string]> = {
  en: ['Microphone', 'Speakers'],
  'zh-CN': ['麦克风', '扬声器'],
  'zh-TW': ['麥克風', '喇叭'],
  ja: ['マイク', 'スピーカー'],
  ko: ['마이크', '스피커'],
  de: ['Mikrofon', 'Lautsprecher'],
  fr: ['Microphone', 'Haut-parleurs'],
  es: ['Micrófono', 'Altavoces'],
  it: ['Microfono', 'Altoparlanti'],
  pt: ['Microfone', 'Alto-falantes'],
  ru: ['Микрофон', 'Динамики'],
  nl: ['Microfoon', 'Luidsprekers'],
  pl: ['Mikrofon', 'Głośniki'],
  tr: ['Mikrofon', 'Hoparlör'],
  vi: ['Micrô', 'Loa'],
  th: ['ไมโครโฟน', 'ลำโพง'],
  id: ['Mikrofon', 'Speaker'],
};

/** Audio drivers (endpoint suffix) and cameras with the USB id Chrome appends on Windows. */
const WINDOWS_AUDIO_DRIVERS = ['Realtek(R) Audio', 'Realtek High Definition Audio', 'High Definition Audio Device'] as const;
const WINDOWS_CAMERAS = [
  'Integrated Camera (04f2:b6d9)',
  'HD Pro Webcam C920 (046d:082d)',
  'Logitech StreamCam (046d:0893)',
  'USB2.0 HD UVC WebCam (13d3:56dd)',
  'HD Webcam C615 (046d:082c)',
] as const;

/** Physical endpoint labels a Windows install shows to enumerateDevices after permission. */
function windowsMediaDevices(seed: string, language: string): MediaDeviceNames {
  const lang = String(language || '').trim();
  const base = lang.split('-')[0].toLowerCase();
  const key = base === 'zh' ? (lang === 'zh-CN' || lang === 'zh-SG' ? 'zh-CN' : 'zh-TW') : base;
  const [mic, speakers] = WINDOWS_ENDPOINT_WORDS[key] || WINDOWS_ENDPOINT_WORDS.en;
  const [a, b] = seedWords(seed);
  const driver = WINDOWS_AUDIO_DRIVERS[a % WINDOWS_AUDIO_DRIVERS.length];
  return {
    audioInput: `${mic} (${driver})`,
    audioOutput: `${speakers} (${driver})`,
    videoInput: WINDOWS_CAMERAS[(b >>> 3) % WINDOWS_CAMERAS.length],
  };
}

/** PulseAudio card descriptions (source and sink share one) and V4L2 cameras as Chrome on Linux names them. */
const LINUX_AUDIO_CARDS = [
  'Built-in Audio Analog Stereo',
  'HD Audio Controller Analog Stereo',
  'Family 17h/19h HD Audio Controller Analog Stereo',
] as const;
const LINUX_CAMERAS = [
  'Integrated Camera: Integrated C (04f2:b6d9)',
  'HD Pro Webcam C920 (046d:082d)',
  'Logitech StreamCam (046d:0893)',
  'USB2.0 HD UVC WebCam: USB2.0 HD (13d3:56dd)',
  'HD Webcam C615 (046d:082c)',
] as const;

function linuxMediaDevices(seed: string): MediaDeviceNames {
  const [a, b] = seedWords(seed);
  const card = LINUX_AUDIO_CARDS[a % LINUX_AUDIO_CARDS.length];
  return {
    audioInput: card,
    audioOutput: card,
    videoInput: LINUX_CAMERAS[(b >>> 3) % LINUX_CAMERAS.length],
  };
}

/** One stable microphone, speaker and webcam per session, named the way the emulated OS does. */
export function sessionMediaDevices(os: OsType, seed: string, language: string): MediaDeviceNames {
  return os === 'windows' ? windowsMediaDevices(seed, language) : linuxMediaDevices(seed);
}
