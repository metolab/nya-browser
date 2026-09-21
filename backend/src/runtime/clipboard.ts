import { execFile, spawn } from 'child_process';
import path from 'path';
import { normalizeClipboardText, type ClipboardKind, type SessionClipboard } from '@nya/shared';
import { uriList } from '../modules/files/fileUri.js';
import { getDisplayHolder, killTree, sessionEnv } from './sessionManager.js';

export const CLIP_LOCK_MS = 2000;
export const CLIP_READY_SLACK_MS = 250;
export const CLIP_HTTP_CAP_MS = 150;
export const CLIP_PROBE_SEC = '0.1';

type Runtime = {
  display?: number;
  uid?: number;
  gid?: number;
  id?: string;
};

export type ClipboardHolder = {
  display?: number;
  clipboardKind?: ClipboardKind | string;
  clipboardText?: string;
  clipboardFiles?: string[];
  clipboardHolder?: { pid?: number } | null;
  clipboardLockUntil?: number;
  holdGen?: number;
};

export function clipboardState(
  holder: ClipboardHolder,
  kind: ClipboardKind,
  text = '',
  files: string[] = [],
): SessionClipboard {
  return {
    kind,
    text: kind === 'text' ? text : '',
    files: kind === 'files' ? files : [],
  };
}

export function rememberedClipboard(holder: ClipboardHolder): SessionClipboard {
  const kind = (holder.clipboardKind || 'text') as ClipboardKind;
  const text = typeof holder.clipboardText === 'string' ? holder.clipboardText : '';
  const files = (Array.isArray(holder.clipboardFiles) ? holder.clipboardFiles : []).map((item) =>
    path.basename(item),
  );
  return clipboardState(holder, kind, text, files);
}

export function isBinaryKind(kind?: string) {
  return kind === 'image' || kind === 'files';
}

export function shouldSkipTextHold(holder: ClipboardHolder, now = Date.now()) {
  return isBinaryKind(String(holder.clipboardKind || '')) && now < (holder.clipboardLockUntil || 0);
}

export function shouldRememberGet(holder: ClipboardHolder, now = Date.now()) {
  return shouldSkipTextHold(holder, now);
}

export function binaryTargetsMatch(kind: string, targets: string) {
  if (kind === 'image') return /image\/png/i.test(targets);
  if (kind === 'files') return /text\/uri-list|x-special\/gnome-copied-files/i.test(targets);
  return /UTF8_STRING|text\/plain|STRING/i.test(targets);
}

export function beginHold(
  holder: ClipboardHolder,
  opts: {
    kind: ClipboardKind;
    text?: string;
    files?: string[];
    child: { pid?: number } | null;
    spawnAt: number;
  },
) {
  const prev = {
    kind: (holder.clipboardKind || 'text') as ClipboardKind,
    text: typeof holder.clipboardText === 'string' ? holder.clipboardText : '',
    files: Array.isArray(holder.clipboardFiles) ? holder.clipboardFiles.slice() : [],
    child: holder.clipboardHolder || null,
  };
  holder.holdGen = (holder.holdGen || 0) + 1;
  holder.clipboardHolder = opts.child;
  holder.clipboardKind = opts.kind;
  holder.clipboardText = opts.kind === 'text' ? String(opts.text || '') : '';
  holder.clipboardFiles = opts.kind === 'files' ? opts.files || [] : [];
  holder.clipboardLockUntil = isBinaryKind(opts.kind) ? opts.spawnAt + CLIP_LOCK_MS : 0;
  return { gen: holder.holdGen, prev };
}

export function applyTargetsReady(
  holder: ClipboardHolder,
  opts: { gen: number; child: { pid?: number } | null; readyAt: number },
) {
  if (opts.gen !== holder.holdGen || opts.child !== holder.clipboardHolder) return false;
  if (!isBinaryKind(String(holder.clipboardKind || ''))) return true;
  holder.clipboardLockUntil = Math.min(holder.clipboardLockUntil || 0, opts.readyAt + CLIP_READY_SLACK_MS);
  return true;
}

export function failHoldIfCurrent(
  holder: ClipboardHolder,
  opts: {
    gen: number;
    child: { pid?: number } | null;
    prev: { kind: ClipboardKind; text: string; files: string[] };
    resolved: boolean;
  },
) {
  if (opts.resolved) return false;
  if (opts.gen !== holder.holdGen || opts.child !== holder.clipboardHolder) return false;
  holder.clipboardHolder = null;
  holder.clipboardLockUntil = 0;
  holder.clipboardKind = opts.prev.kind;
  holder.clipboardText = opts.prev.text;
  holder.clipboardFiles = opts.prev.files;
  return true;
}

export function clearClipboardLock(holder: ClipboardHolder | null | undefined) {
  if (!holder) return;
  holder.clipboardLockUntil = 0;
}

function execFileOnHolder(
  runtime: Runtime,
  holder: ClipboardHolder,
  file: string,
  args: string[],
  timeoutMs?: number,
) {
  const display = holder.display ?? runtime.display;
  /** @type {import('child_process').ExecFileOptions} */
  const opts: import('child_process').ExecFileOptions = {
    env: sessionEnv(runtime, { DISPLAY: `:${display}` }),
    maxBuffer: 2 * 1024 * 1024,
  };
  if (timeoutMs) opts.timeout = timeoutMs;
  if (Number.isInteger(runtime.uid)) {
    opts.uid = runtime.uid;
    opts.gid = runtime.gid;
  }
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(file, args, opts, (err, stdout, stderr) => {
      if (err) {
        (err as Error & { stderr?: string }).stderr = String(stderr || '');
        reject(err);
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

function readXclip(runtime: Runtime, holder: ClipboardHolder) {
  const tryTarget = (target: string) =>
    execFileOnHolder(runtime, holder, 'timeout', [
      '2',
      'xclip',
      '-selection',
      'clipboard',
      '-o',
      '-t',
      target,
    ]).then(({ stdout }) => String(stdout ?? ''));

  return tryTarget('UTF8_STRING').catch(() =>
    tryTarget('text/plain;charset=utf-8').catch(() => tryTarget('STRING')),
  );
}

function readXclipTargets(runtime: Runtime, holder: ClipboardHolder) {
  return execFileOnHolder(runtime, holder, 'timeout', [
    '2',
    'xclip',
    '-selection',
    'clipboard',
    '-o',
    '-t',
    'TARGETS',
  ]).then(({ stdout }) => String(stdout ?? ''));
}

function readXclipTargetsQuick(runtime: Runtime, holder: ClipboardHolder) {
  return execFileOnHolder(
    runtime,
    holder,
    'timeout',
    ['0.1', 'xclip', '-selection', 'clipboard', '-o', '-t', 'TARGETS'],
    150,
  ).then(({ stdout }) => String(stdout ?? ''));
}

async function releaseX11Buttons(runtime: Runtime, holder: ClipboardHolder) {
  try {
    await execFileOnHolder(runtime, holder, 'xdotool', ['mouseup', '1', 'mouseup', '2', 'mouseup', '3']);
  } catch {
    /* lost mouseup after a file picker is common; ignore if xdotool is busy */
  }
}

function holdClipboard(
  runtime: Runtime,
  holder: ClipboardHolder,
  opts: { kind: ClipboardKind; text?: string; files?: string[]; type: string; payload: Buffer | string },
) {
  const spawnAt = Date.now();
  const spawnOpts: import('child_process').SpawnOptions = {
    env: sessionEnv(runtime, { DISPLAY: `:${holder.display ?? runtime.display}` }),
    detached: true,
    stdio: ['pipe', 'ignore', 'ignore'],
  };
  if (Number.isInteger(runtime.uid)) {
    spawnOpts.uid = runtime.uid;
    spawnOpts.gid = runtime.gid;
  }
  const child = spawn('xclip', ['-selection', 'clipboard', '-t', opts.type, '-i'], spawnOpts);
  const { gen, prev } = beginHold(holder, {
    kind: opts.kind,
    text: opts.text,
    files: opts.files,
    child,
    spawnAt,
  });
  if (prev.child?.pid && prev.child !== child) killTree(prev.child, 'SIGKILL');

  if (Buffer.isBuffer(opts.payload)) child.stdin?.end(opts.payload);
  else child.stdin?.end(String(opts.payload ?? ''), 'utf8');

  let resolved = false;
  let settle: (err?: Error) => void;
  const httpWait = new Promise<void>((resolve, reject) => {
    settle = (err) => {
      if (resolved && !err) return;
      if (err && resolved) return;
      resolved = true;
      if (err) reject(err);
      else resolve();
    };
  });

  const fail = (err?: Error) => {
    if (
      failHoldIfCurrent(holder, {
        gen,
        child,
        prev,
        resolved,
      })
    ) {
      settle(err || new Error('xclip exited'));
    }
  };

  child.on('error', (err) => {
    if (resolved && gen === holder.holdGen) return;
    fail(err);
  });
  child.on('exit', () => {
    fail();
  });

  const probe = async () => {
    for (;;) {
      if (gen !== holder.holdGen || child !== holder.clipboardHolder) return;
      if (Date.now() >= spawnAt + CLIP_LOCK_MS) return;
      try {
        const targets = await readXclipTargetsQuick(runtime, holder);
        if (gen !== holder.holdGen || child !== holder.clipboardHolder) return;
        if (binaryTargetsMatch(opts.kind, targets)) {
          applyTargetsReady(holder, { gen, child, readyAt: Date.now() });
          settle();
          return;
        }
      } catch {
        /* still holding */
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  const cap = setTimeout(() => settle(), CLIP_HTTP_CAP_MS);
  void probe();
  return httpWait.finally(() => clearTimeout(cap));
}

export async function getClipboard(sessionId: string, subId: string | null = null): Promise<SessionClipboard> {
  const { runtime, holder } = getDisplayHolder(sessionId, subId);
  if (shouldRememberGet(holder)) return rememberedClipboard(holder);
  try {
    const targets = await readXclipTargets(runtime, holder);
    if (/image\/png/i.test(targets)) {
      holder.clipboardKind = 'image';
      return clipboardState(holder, 'image');
    }
    if (/text\/uri-list|x-special\/gnome-copied-files/i.test(targets)) {
      holder.clipboardKind = 'files';
      const names = (holder.clipboardFiles || []).map((item) => path.basename(item));
      return clipboardState(holder, 'files', '', names);
    }
    const previous = typeof holder.clipboardText === 'string' ? holder.clipboardText : '';
    const text = await readXclip(runtime, holder);
    const next = normalizeClipboardText(text, previous);
    if (next == null) return rememberedClipboard(holder);
    holder.clipboardKind = 'text';
    holder.clipboardText = next;
    holder.clipboardFiles = [];
    return clipboardState(holder, 'text', next);
  } catch {
    return rememberedClipboard(holder);
  }
}

export async function setClipboard(
  sessionId: string,
  text: string,
  subId: string | null = null,
): Promise<SessionClipboard> {
  const { runtime, holder } = getDisplayHolder(sessionId, subId);
  if (shouldSkipTextHold(holder)) return rememberedClipboard(holder);
  const value = String(text ?? '');
  await holdClipboard(runtime, holder, {
    kind: 'text',
    text: value,
    type: 'UTF8_STRING',
    payload: value,
  });
  return rememberedClipboard(holder);
}

export async function setClipboardImage(sessionId: string, png: Buffer, subId: string | null = null) {
  const { runtime, holder } = getDisplayHolder(sessionId, subId);
  await holdClipboard(runtime, holder, {
    kind: 'image',
    type: 'image/png',
    payload: png,
  });
  await releaseX11Buttons(runtime, holder);
  return clipboardState(holder, 'image');
}

export async function setClipboardFiles(sessionId: string, absPaths: string[], subId: string | null = null) {
  const { runtime, holder } = getDisplayHolder(sessionId, subId);
  const files = (absPaths || []).map((item) => path.resolve(String(item)));
  await holdClipboard(runtime, holder, {
    kind: 'files',
    files,
    type: 'text/uri-list',
    payload: uriList(files),
  });
  await releaseX11Buttons(runtime, holder);
  return clipboardState(holder, 'files', '', files.map((item) => path.basename(item)));
}
