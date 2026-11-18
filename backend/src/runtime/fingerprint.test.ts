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
  it('creates new sessions as Windows with offline WebRTC and a native GPU', () => {
    const fp = createFingerprint();
    expect(fp.gpuProfile).toBe('native');
    expect(fp.webrtcMode).toBe('offline');
    expect(fp.os).toBe('windows');
    expect(fp.windowsRelease).toBe('win11');
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

  it('keeps webrtc and geo, and drops the removed device name and media fields', () => {
    const fp = normalizeFingerprint({
      seed: SEED,
      gpuProfile: 'rtx-4070',
      webrtcMode: 'replace',
      deviceName: 'DESKTOP-TEST01',
      mediaDevices: { audioInput: 'USB Audio Device' },
      geo: { permission: 'allow', latitude: 31.2, longitude: 121.5, accuracy: 50 },
    });
    expect(fp.webrtcMode).toBe('replace');
    expect(fp).not.toHaveProperty('deviceName');
    expect(fp).not.toHaveProperty('mediaDevices');
    expect(fp.geo.permission).toBe('allow');
    expect(fp.geo.latitude).toBe(31.2);
    expect(fp.gpuProfile).toBe('rtx-4070');
  });

  it('reads a stored record without webrtcMode as disabled', () => {
    expect(normalizeFingerprint({ seed: SEED }).webrtcMode).toBe('disabled');
  });

  it('createFingerprint keeps extras when gpu arg is omitted', () => {
    const fp = createFingerprint(undefined, { webrtcMode: 'forward', os: 'windows' });
    expect(fp.webrtcMode).toBe('forward');
    expect(fp.os).toBe('windows');
  });

  it('merge and equality see geo coords', () => {
    const current = fingerprintFromSeed(SEED, { webrtcMode: 'offline' });
    const next = mergeFingerprintPatch(current, { geo: { longitude: 121.5 } });
    expect(next.geo.longitude).toBe(121.5);
    expect(next.webrtcMode).toBe('offline');
    expect(fingerprintsEqual(current, next)).toBe(false);
    expect(fingerprintLaunchChanged(current, next)).toBe(true);
    expect(fingerprintLaunchChanged(current, current)).toBe(false);
  });
});

describe('fingerprint OS', () => {
  it('defaults old records to linux and drops the legacy font profile', () => {
    const fp = normalizeFingerprint({ seed: SEED, fontProfile: 'win10' });
    expect(fp.os).toBe('linux');
    expect(fp.windowsRelease).toBe('win11');
    expect(fp).not.toHaveProperty('fontProfile');
    expect(normalizeFingerprint({ seed: SEED, os: 'macos' }).os).toBe('linux');
  });

  it('treats an OS change as a launch change', () => {
    const linux = fingerprintFromSeed(SEED);
    const win = mergeFingerprintPatch(linux, { os: 'windows' });
    expect(win.os).toBe('windows');
    expect(win.seed).toBe(linux.seed);
    expect(fingerprintLaunchChanged(linux, win)).toBe(true);
    const win10 = mergeFingerprintPatch(win, { windowsRelease: 'win10' });
    expect(fingerprintLaunchChanged(win, win10)).toBe(true);
    expect(fingerprintsEqual(win, mergeFingerprintPatch(win, {}))).toBe(true);
  });
});
