import { describe, expect, it } from 'vitest';
import {
  createFingerprint,
  fingerprintFromSeed,
  fingerprintLaunchChanged,
  fingerprintsEqual,
  mergeFingerprintPatch,
  normalizeFingerprint,
} from './fingerprint.js';

const SEED = 'a'.repeat(64);

describe('fingerprint GPU profile', () => {
  it('defaults to native GPU/fonts, disabled WebRTC, and native media', () => {
    const fp = fingerprintFromSeed(SEED);
    expect(fp.gpuProfile).toBe('native');
    expect(fp.fontProfile).toBe('native');
    expect(fp.webrtcMode).toBe('disabled');
    expect(fp.mediaDevices.audioInput).toBe('');
    expect(fp.mediaDevices.videoInput).toBe('');
  });

  it('keeps an explicit NVIDIA desktop profile', () => {
    expect(normalizeFingerprint({ seed: SEED, gpuProfile: 'rtx-2080' }).gpuProfile).toBe(
      'rtx-2080',
    );
    expect(createFingerprint('gtx-1070').gpuProfile).toBe('gtx-1070');
  });

  it('falls back to native for unknown profiles', () => {
    expect(normalizeFingerprint({ seed: SEED, gpuProfile: 'intel-uhd' }).gpuProfile).toBe(
      'native',
    );
  });

  it('keeps webrtc, device name, media and geo', () => {
    const fp = normalizeFingerprint({
      seed: SEED,
      gpuProfile: 'rtx-4070',
      webrtcMode: 'replace',
      deviceName: 'DESKTOP-TEST01',
      mediaDevices: { audioInput: 'USB Audio Device' },
      geo: { permission: 'allow', latitude: 31.2, longitude: 121.5, accuracy: 50 },
      fontProfile: 'win11',
    });
    expect(fp.webrtcMode).toBe('replace');
    expect(fp.fontProfile).toBe('win11');
    expect(fp.deviceName).toBe('DESKTOP-TEST01');
    expect(fp.mediaDevices.audioInput).toBe('USB Audio Device');
    expect(fp.mediaDevices.audioOutput).toBe('');
    expect(fp.mediaDevices.videoInput).toBe('');
    expect(fp.geo.permission).toBe('allow');
    expect(fp.geo.latitude).toBe(31.2);
    expect(fp.gpuProfile).toBe('rtx-4070');
  });

  it('does not treat a missing webrtcMode as offline', () => {
    expect(normalizeFingerprint({ seed: SEED }).webrtcMode).toBe('disabled');
  });

  it('createFingerprint keeps extras when gpu arg is omitted', () => {
    const fp = createFingerprint(undefined, { webrtcMode: 'forward', fontProfile: 'win10' });
    expect(fp.webrtcMode).toBe('forward');
    expect(fp.fontProfile).toBe('win10');
  });

  it('merge and equality see media output/video and geo coords', () => {
    const current = fingerprintFromSeed(SEED, { webrtcMode: 'offline', fontProfile: 'win10' });
    const next = mergeFingerprintPatch(current, {
      mediaDevices: { audioOutput: 'NVIDIA High Definition Audio' },
      geo: { longitude: 121.5 },
    });
    expect(next.mediaDevices.audioOutput).toBe('NVIDIA High Definition Audio');
    expect(next.geo.longitude).toBe(121.5);
    expect(next.webrtcMode).toBe('offline');
    expect(fingerprintsEqual(current, next)).toBe(false);
    expect(fingerprintLaunchChanged(current, next)).toBe(true);
    expect(fingerprintLaunchChanged(current, current)).toBe(false);
  });
});
