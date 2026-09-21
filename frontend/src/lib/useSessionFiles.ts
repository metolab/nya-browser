import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { SessionTransfer } from '@nya/shared';
import { api } from '../api/client';
import { canOnlinePreview, randomId, TRANSFER_PAUSE_BYTES } from './files';
import { encodePasteImage } from './pasteImage';
import {
  classifyTransfer,
  contentFingerprint,
  filesFromClipboard,
  splitBySize,
  type ClassifiedTransfer,
} from './transferIngest';

const emptyTransfer = (): SessionTransfer => ({
  chooser: null,
  uploads: [],
  downloads: [],
  localJobs: [],
});

type Opts = {
  sessionId?: string;
  subId?: string | null;
  enabled: boolean;
  onText?: (text: string) => Promise<void> | void;
  onClipboardKind?: (kind: 'image' | 'files', sessionId: string, subId?: string | null) => void;
};

export function useSessionFiles({ sessionId, subId, enabled, onText, onClipboardKind }: Opts) {
  const [transfer, setTransfer] = useState<SessionTransfer>(emptyTransfer);
  const [uploading, setUploading] = useState(false);
  const [uploadRatio, setUploadRatio] = useState(0);
  const [paused, setPaused] = useState(false);
  const [preview, setPreview] = useState<{ path: string; name: string; size?: number } | null>(null);
  const [note, setNote] = useState('');
  const sessionKey = `${sessionId || ''}:${subId || ''}`;
  const [readyFor, setReadyFor] = useState('');
  const ready = Boolean(sessionId) && readyFor === sessionKey;
  const pauseCount = useRef(0);
  const transferRef = useRef(transfer);
  const queue = useRef(Promise.resolve());
  const onTextRef = useRef(onText);
  const onClipboardKindRef = useRef(onClipboardKind);
  const seenRef = useRef(new Map<string, { path: string; kind: 'file' | 'image' }>());
  transferRef.current = transfer;
  onTextRef.current = onText;
  onClipboardKindRef.current = onClipboardKind;

  const beginPause = useCallback((bytes: number) => {
    if (bytes < TRANSFER_PAUSE_BYTES) return () => {};
    pauseCount.current += 1;
    setPaused(true);
    return () => {
      pauseCount.current = Math.max(0, pauseCount.current - 1);
      if (pauseCount.current === 0) setPaused(false);
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!sessionId) return emptyTransfer();
    const next = await api.transfer(sessionId, subId);
    setTransfer(next);
    setReadyFor(`${sessionId}:${subId || ''}`);
    return next;
  }, [sessionId, subId]);

  useEffect(() => {
    seenRef.current.clear();
  }, [sessionKey]);

  useEffect(() => {
    if (!enabled || !sessionId) {
      setTransfer(emptyTransfer());
      setReadyFor('');
      return undefined;
    }
    let timer = 0;
    // Hidden tabs skip refresh so chooser / download toast / localJobs freeze until visible (delay, not loss).
    const tick = async () => {
      if (document.visibilityState === 'visible') {
        try {
          await refresh();
        } catch {
          /* keep last */
        }
      }
      timer = window.setTimeout(() => void tick(), 400);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', onVisible);
    void tick();
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, refresh, sessionId]);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!sessionId || !files.length) return [];
      setUploading(true);
      setUploadRatio(0);
      setNote('正在上传…');
      try {
        const data = await api.upload(sessionId, '.', files, setUploadRatio);
        await refresh();
        return data.files || [];
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        return [];
      } finally {
        setUploading(false);
        setUploadRatio(0);
        setNote('');
      }
    },
    [refresh, sessionId],
  );

  const ingestClassified = useCallback(
    async (classified: ClassifiedTransfer, forRemotePaste: boolean) => {
      if (!sessionId) return { inject: false, ok: false };
      if (classified.mode === 'empty') return { inject: false, ok: false };
      if (classified.mode === 'text') {
        await onTextRef.current?.(classified.text);
        return { inject: forRemotePaste, ok: true };
      }
      const mark = (kind: 'image' | 'files') => {
        if (sessionId) onClipboardKindRef.current?.(kind, sessionId, subId);
      };
      if (classified.mode === 'image') {
        mark('image');
        const images = classified.images;
        const prints = await Promise.all(images.map((image) => contentFingerprint(image)));
        const unseen = images.filter((_, index) => !seenRef.current.has(prints[index]));
        setUploading(true);
        setUploadRatio(0);
        setNote(forRemotePaste ? '正在贴到远程…' : '正在上传图片…');
        try {
          if (!unseen.length) {
            const path = [...prints].reverse().map((fp) => seenRef.current.get(fp)?.path).find(Boolean);
            if (path) {
              await api.setClipboardImagePath(sessionId, path, subId);
              mark('image');
            }
            return { inject: forRemotePaste, ok: true };
          }
          let lastPath = '';
          for (const [index, image] of unseen.entries()) {
            const encoded = await encodePasteImage(image);
            if (!encoded.compressed) toast.message('图片未压缩，已按原图上传');
            const saved = await api.setClipboardImage(sessionId, encoded.blob, subId);
            mark('image');
            const fp = prints[images.indexOf(image)];
            if (saved.file?.path && fp) seenRef.current.set(fp, { path: saved.file.path, kind: 'image' });
            lastPath = saved.file?.path || lastPath;
            setUploadRatio((index + 1) / unseen.length);
          }
          await refresh();
          return { inject: forRemotePaste, ok: Boolean(lastPath) };
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err));
          return { inject: false, ok: false };
        } finally {
          setUploading(false);
          setUploadRatio(0);
          setNote('');
        }
      }
      const { kept, skipped } = splitBySize(classified.files);
      for (const file of skipped) {
        toast.error(`${file.name} 超过 50MB`);
      }
      if (!kept.length) return { inject: false, ok: false };
      mark('files');
      const prints = await Promise.all(kept.map((file) => contentFingerprint(file)));
      const fresh: File[] = [];
      const freshFp: string[] = [];
      const paths: string[] = [];
      kept.forEach((file, index) => {
        const seen = seenRef.current.get(prints[index]);
        if (seen) paths.push(seen.path);
        else {
          fresh.push(file);
          freshFp.push(prints[index]);
        }
      });
      if (fresh.length) {
        const uploaded = await uploadFiles(fresh);
        if (uploaded.length !== fresh.length) return { inject: false, ok: false };
        uploaded.forEach((row, index) => {
          seenRef.current.set(freshFp[index], { path: row.path, kind: 'file' });
          paths.push(row.path);
        });
      }
      if (!paths.length) return { inject: false, ok: false };
      try {
        await api.setClipboardFiles(sessionId, paths, subId);
        mark('files');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
        return { inject: false, ok: false };
      }
      return { inject: forRemotePaste, ok: true };
    },
    [refresh, sessionId, subId, uploadFiles],
  );

  const enqueue = useCallback((fn: () => Promise<{ inject: boolean; ok: boolean }>) => {
    const run = queue.current.then(fn, fn);
    queue.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  const ingestFiles = useCallback(
    (files: File[], source: 'clipboard' | 'picker' = 'picker', forRemotePaste = false) =>
      enqueue(() =>
        ingestClassified(classifyTransfer({ source, files }), forRemotePaste),
      ),
    [enqueue, ingestClassified],
  );

  const ingestPaste = useCallback(
    (data: DataTransfer | null | undefined, forRemotePaste: boolean) =>
      enqueue(() =>
        ingestClassified(
          classifyTransfer({
            source: 'clipboard',
            files: filesFromClipboard(data),
            text: data?.getData('text/plain') || '',
          }),
          forRemotePaste,
        ),
      ),
    [enqueue, ingestClassified],
  );

  const downloadToLocal = useCallback(
    async (filePath: string, name: string, size: number) => {
      if (!sessionId) return;
      const job = randomId();
      const endPause = beginPause(size);
      const link = document.createElement('a');
      link.href = api.downloadUrl(sessionId, filePath, job);
      link.download = name;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      const started = Date.now();
      const wait = () => {
        const row = transferRef.current.localJobs.find((item) => item.id === job);
        if (row && row.state !== 'active') {
          endPause();
          return;
        }
        if (!row && Date.now() - started > 5000) {
          endPause();
          return;
        }
        window.setTimeout(wait, 400);
      };
      window.setTimeout(wait, 400);
    },
    [beginPause, sessionId],
  );

  const openPreview = useCallback((path: string, name: string, size = 0) => {
    if (!canOnlinePreview(size)) {
      toast.warning('超过 5 MB，无法在线预览');
      return;
    }
    setPreview({ path, name, size });
  }, []);

  const remove = useCallback(
    async (filePath: string) => {
      if (!sessionId) return;
      try {
        await api.removeFile(sessionId, filePath);
        await refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [refresh, sessionId],
  );

  return {
    transfer,
    ready,
    uploading,
    uploadRatio,
    paused,
    preview,
    setPreview,
    openPreview,
    note,
    ingestFiles,
    ingestPaste,
    uploadFiles,
    downloadToLocal,
    remove,
    refresh,
  };
}
