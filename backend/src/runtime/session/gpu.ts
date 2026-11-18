import fs from 'fs';
import path from 'path';

let nvidiaDeviceId: string | null = null;

/** PCI device id of the host's first NVIDIA display controller, e.g. `1B06`. */
export function hostNvidiaDeviceId() {
  if (nvidiaDeviceId !== null) return nvidiaDeviceId;
  nvidiaDeviceId = '';
  const root = '/sys/bus/pci/devices';
  try {
    for (const dev of fs.readdirSync(root).sort()) {
      const read = (name: string) => {
        try {
          return fs.readFileSync(path.join(root, dev, name), 'utf8').trim().toLowerCase();
        } catch {
          return '';
        }
      };
      if (read('vendor') !== '0x10de' || !read('class').startsWith('0x03')) continue;
      const id = read('device').replace(/^0x/, '');
      if (/^[0-9a-f]{4}$/.test(id)) {
        nvidiaDeviceId = id.toUpperCase();
        break;
      }
    }
  } catch {
    /* no sysfs */
  }
  return nvidiaDeviceId;
}

function gpuAvailable() {
  try {
    return (
      fs.existsSync('/dev/nvidia0') &&
      (fs.existsSync('/usr/share/glvnd/egl_vendor.d/10_nvidia.json') ||
        fs.existsSync('/usr/share/glvnd/egl_vendor.d/10_nvidia_wayland.json'))
    );
  } catch {
    return false;
  }
}

export function gpuBackend() {
  const explicit = String(process.env.NYA_GPU_BACKEND || '').trim().toLowerCase();
  const raw = String(process.env.NYA_GPU || '').toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'swiftshader' || explicit === 'swiftshader') {
    return 'swiftshader';
  }
  if (!gpuAvailable()) return 'swiftshader';
  if (explicit) return explicit;
  if (raw === '1' || raw === 'true' || raw === 'on' || raw === 'nvidia' || raw === 'auto' || gpuAvailable()) {
    return 'gl-egl';
  }
  return 'swiftshader';
}
