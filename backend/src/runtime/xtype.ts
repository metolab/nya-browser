import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

export const TYPE_TEXT_MAX = 8192;

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'xtype.py');

export function runXtype(env: NodeJS.ProcessEnv, text: string): Promise<void> {
  const timeoutMs = Math.min(60_000, 4_000 + Math.max(1, text.length) * 40);
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [scriptPath], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('xtype timeout'));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `xtype exit ${code}`));
    });
    child.stdin.write(text, 'utf8');
    child.stdin.end();
  });
}
