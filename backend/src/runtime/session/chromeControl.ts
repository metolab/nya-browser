import net from 'net';
import path from 'path';
import { execFile } from 'child_process';
import { chromeProfileDir } from '../../store.js';
import { sessionHomeUrl } from './chromeConfig.js';
import { childPidAlive, waitUnixSocket } from './proc.js';
import type { SessionRuntime } from './types.js';

type ControlReply = { ok: boolean; error?: string; [key: string]: unknown };

export async function killChromeProfile(sessionId: string) {
  const profile = chromeProfileDir(sessionId);
  await new Promise<void>((resolve) => {
    execFile('pkill', ['-9', '-f', `--user-data-dir=${profile}`], () => resolve());
  });
}

export function chromePidAlive(runtime: SessionRuntime) {
  return childPidAlive(runtime.chrome);
}

/** Open a browser window on `display` (attaching Chrome to it first when it is an extra desktop). */
export async function createChromeWindowOnDisplay(runtime: SessionRuntime, display: number, url?: string | null) {
  const target = sessionHomeUrl(runtime.id, url);
  await waitChromeControl(runtime.id, 8000);
  if (display !== runtime.display) {
    await sendChromeControl(runtime.id, {
      id: Date.now(),
      cmd: 'attachDisplay',
      display: `:${display}`,
    });
  }
  return sendChromeControl(runtime.id, {
    id: Date.now() + 1,
    cmd: 'createWindow',
    display: `:${display}`,
    url: target,
  });
}

export function chromeControlSock(sessionId: string) {
  return path.join(chromeProfileDir(sessionId), 'nya-chrome.sock');
}

function sendChromeControl(sessionId: string, payload: Record<string, unknown>, timeoutMs = 25000) {
  const sockPath = chromeControlSock(sessionId);
  return new Promise<ControlReply>((resolve, reject) => {
    const socket = net.connect({ path: sockPath });
    let buf = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('nya-chrome.sock timeout'));
    }, timeoutMs);
    socket.on('connect', () => {
      socket.write(`${JSON.stringify(payload)}\n`);
    });
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      clearTimeout(timer);
      socket.end();
      try {
        const msg = JSON.parse(buf.slice(0, nl)) as ControlReply;
        if (!msg.ok) {
          reject(new Error(msg.error || 'chrome control failed'));
          return;
        }
        resolve(msg);
      } catch (err) {
        reject(err);
      }
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export async function waitChromeControl(sessionId: string, timeoutMs = 30000) {
  await waitUnixSocket(chromeControlSock(sessionId), timeoutMs);
}
