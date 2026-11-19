import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { SessionTransfer } from '@nya/shared';
import { api } from '../api/client';
import { canOnlinePreview, randomId, TRANSFER_PAUSE_BYTES } from './files';
import { encodePasteImage, PASTE_IMAGE_MAX_BYTES } from './pasteImage';
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

export type RemotePastePolicy = boolean | 'text-only';

type Opts = {
  sessionId?: string;
  subId?: string | null;
  enabled: boolean;
  onText?: (text: string) => Promise<void> | void;
  onClipboardKind?: (kind: 'image' | 'files', sessionId: string, subId?: string | null) => void;
};

function seenKey(kind: 'image' | 'file', fp: string) {
  return `${kind}:${fp}`;
}

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

  const sessionKeyRef = useRef(sessionKey);
  sessionKeyRef.current = sessionKey;
  const pauseCount = useRef(0);
  const transferRef = useRef(transfer);
  const queue = useRef(Promise.resolve());
  const onTextRef = useRef(onText);
  const onClipboardKindRef = useRef(onClipboardKind);
  const seenRef = useRef(new Map<string, string>());
  const downloadTimersRef = useRef(new Set<number>());

  transferRef.current = transfer;
  onTextRef.current = onText;
  onClipboardKindRef.current = onClipboardKind;

  const clearDownloadTimers = useCallback(() => {
    for (const id of downloadTimersRef.current) window.clearTimeout(id);
    downloadTimersRef.current.clear();
  }, []);

  const invalidateSeenPath = useCallback((filePath: string) => {
    for (const [key, savedPath] of seenRef.current.entries()) {
      if (savedPath === filePath) seenRef.current.delete(key);
    }
  }, []);

  const beginPause = useCallback((bytes: number) => {
    if (bytes < TRANSFER_PAUSE_BYTES) return () => {};
    let released = false;
    pauseCount.current += 1;
    setPaused(true);
    return () => {
      if (released) return;
      released = true;
      pauseCount.current = Math.max(0, pauseCount.current - 1);
      if (pauseCount.current === 0) setPaused(false);
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!sessionId) return emptyTransfer();
    const capturedKey = `${sessionId}:${subId || ''}`;
    const next = await api.transfer(sessionId, subId);
    if (sessionKeyRef.current !== capturedKey) return emptyTransfer();
    setTransfer(next);
    setReadyFor(capturedKey);
    return next;
  }, [sessionId, subId]);

  useEffect(() => {
    seenRef.current.clear();
    clearDownloadTimers();
    pauseCount.current = 0;
    setPaused(false);
    setUploading(false);
    setUploadRatio(0);
    setNote('');
    setPreview(null);
  }, [sessionKey, clearDownloadTimers]);

  useEffect(
    () => () => {
      clearDownloadTimers();
    },
    [clearDownloadTimers],
  );

  useEffect(() => {
    if (!enabled || !sessionId) {
      setTransfer(emptyTransfer());
      setReadyFor('');
      return undefined;
    }
    let cancelled = false;
    let timer = 0;
    // Hidden tabs skip refresh so chooser / download toast / localJobs freeze until visible (delay, not loss).
    const tick = async () => {
      if (cancelled) return;
      if (document.visibilityState === 'visible') {
        try {
          await refresh();
        } catch {
          /* keep last */
        }
      }
      if (cancelled) return;
      timer = window.setTimeout(() => void tick(), 400);
    };
    const onVisible = () => {
      if (!cancelled && document.visibilityState === 'visible') {
        void refresh().catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, refresh, sessionId]);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!sessionId || !files.length) return [];
      const capturedKey = `${sessionId}:${subId || ''}`;
      setUploading(true);
      setUploadRatio(0);
      setNote('正在上传…');
      try {
        const data = await api.upload(sessionId, '.', files, (ratio) => {
          if (sessionKeyRef.current === capturedKey) setUploadRatio(ratio);
        });
        if (sessionKeyRef.current !== capturedKey) return [];
        await refresh();
        return data.files || [];
      } catch (err) {
        if (sessionKeyRef.current === capturedKey) {
          toast.error(err instanceof Error ? err.message : String(err));
        }
        return [];
      } finally {
        if (sessionKeyRef.current === capturedKey) {
          setUploading(false);
          setUploadRatio(0);
          setNote('');
        }
      }
    },
    [refresh, sessionId, subId],
  );

  const ingestClassified = useCallback(
    async (classified: ClassifiedTransfer, forRemotePaste: RemotePastePolicy) => {
      if (!sessionId) return { inject: false, ok: false };
      const capturedKey = `${sessionId}:${subId || ''}`;
      if (classified.mode === 'empty') return { inject: false, ok: false };

      const allowTextInject = forRemotePaste === true || forRemotePaste === 'text-only';
      const allowBinaryInject = forRemotePaste === true;

      if (classified.mode === 'text') {
        await onTextRef.current?.(classified.text);
        return { inject: allowTextInject && sessionKeyRef.current === capturedKey, ok: true };
      }

      const mark = (kind: 'image' | 'files') => {
        if (sessionKeyRef.current === capturedKey) {
          onClipboardKindRef.current?.(kind, sessionId, subId);
        }
      };

      if (classified.mode === 'image') {
        const images = classified.images;
        let prints: string[];
        try {
          prints = await Promise.all(images.map((image) => contentFingerprint(image)));
        } catch {
          toast.error('无法读取剪贴板图片');
          return { inject: false, ok: false };
        }
        if (sessionKeyRef.current !== capturedKey) return { inject: false, ok: false };

        // Deduplicate by content fingerprint and keep upload work minimal.
        const uniqueImages: { file: File; key: string }[] = [];
        const seenBatch = new Set<string>();
        images.forEach((file, index) => {
          const key = seenKey('image', prints[index]);
          if (seenBatch.has(key)) return;
          seenBatch.add(key);
          uniqueImages.push({ file, key });
        });

        let toUpload = uniqueImages.filter((item) => !seenRef.current.has(item.key));

        setUploading(true);
        setUploadRatio(0);
        setNote(allowBinaryInject ? '正在贴到远程…' : '正在上传图片…');
        try {
          if (!toUpload.length) {
            const lastItem = uniqueImages[uniqueImages.length - 1];
            const cachedPath = lastItem ? seenRef.current.get(lastItem.key) : undefined;
            if (cachedPath) {
              mark('image');
              try {
                await api.setClipboardImagePath(sessionId, cachedPath, subId);
                mark('image');
                return { inject: allowBinaryInject && sessionKeyRef.current === capturedKey, ok: true };
              } catch {
                // Cached file may have been deleted remotely; invalidate and re-upload seamlessly.
                seenRef.current.delete(lastItem.key);
                toUpload = [lastItem];
              }
            }
          }

          let lastPath = '';
          for (const [index, item] of toUpload.entries()) {
            const encoded = await encodePasteImage(item.file);
            if (sessionKeyRef.current !== capturedKey) return { inject: false, ok: false };
            if (encoded.blob.size > PASTE_IMAGE_MAX_BYTES) {
              toast.error('图片超过 8MB 限制，无法粘贴');
              return { inject: false, ok: false };
            }
            if (!encoded.compressed && encoded.mime !== 'image/png') {
              toast.message('图片未压缩，已按原图上传');
            }
            mark('image');
            const saved = await api.setClipboardImage(sessionId, encoded.blob, subId);
            if (sessionKeyRef.current !== capturedKey) return { inject: false, ok: false };
            mark('image');
            if (saved.file?.path) {
              seenRef.current.set(item.key, saved.file.path);
              lastPath = saved.file.path;
            }
            setUploadRatio((index + 1) / toUpload.length);
          }
          await refresh();
          return {
            inject: allowBinaryInject && Boolean(lastPath) && sessionKeyRef.current === capturedKey,
            ok: Boolean(lastPath),
          };
        } catch (err) {
          if (sessionKeyRef.current === capturedKey) {
            toast.error(err instanceof Error ? err.message : String(err));
          }
          return { inject: false, ok: false };
        } finally {
          if (sessionKeyRef.current === capturedKey) {
            setUploading(false);
            setUploadRatio(0);
            setNote('');
          }
        }
      }

      const { kept, skipped } = splitBySize(classified.files);
      for (const file of skipped) {
        toast.error(`${file.name} 超过 50MB`);
      }
      if (!kept.length) return { inject: false, ok: false };

      let prints: string[];
      try {
        prints = await Promise.all(kept.map((file) => contentFingerprint(file)));
      } catch {
        toast.error('无法读取所选文件（暂不支持直接拖入文件夹）');
        return { inject: false, ok: false };
      }
      if (sessionKeyRef.current !== capturedKey) return { inject: false, ok: false };

      const entries = kept.map((file, index) => ({
        file,
        key: seenKey('file', prints[index]),
      }));

      const uploadMissing = async (items: { file: File; key: string }[]) => {
        const fresh: { file: File; key: string }[] = [];
        const pathsByIndex: (string | null)[] = items.map((item) => {
          const cached = seenRef.current.get(item.key);
          if (cached) return cached;
          fresh.push(item);
          return null;
        });
        if (fresh.length) {
          const uploaded = await uploadFiles(fresh.map((item) => item.file));
          if (sessionKeyRef.current !== capturedKey || uploaded.length !== fresh.length) {
            return null;
          }
          let cursor = 0;
          for (let i = 0; i < pathsByIndex.length; i += 1) {
            if (pathsByIndex[i] === null) {
              const row = uploaded[cursor];
              seenRef.current.set(fresh[cursor].key, row.path);
              pathsByIndex[i] = row.path;
              cursor += 1;
            }
          }
        }
        return pathsByIndex.filter((p): p is string => Boolean(p));
      };

      const cachedKeys = entries
        .filter((item) => seenRef.current.has(item.key))
        .map((item) => item.key);
      let paths = await uploadMissing(entries);
      if (!paths || !paths.length || sessionKeyRef.current !== capturedKey) {
        return { inject: false, ok: false };
      }

      const applyClipboardFiles = async (filePaths: string[]) => {
        mark('files');
        await api.setClipboardFiles(sessionId, filePaths, subId);
        mark('files');
      };

      try {
        await applyClipboardFiles(paths);
      } catch (err) {
        if (cachedKeys.length && sessionKeyRef.current === capturedKey) {
          // Only invalidate previously cached files that may have been removed remotely,
          // keeping freshly uploaded files in this batch intact.
          for (const key of cachedKeys) seenRef.current.delete(key);
          paths = await uploadMissing(entries);
          if (!paths || !paths.length || sessionKeyRef.current !== capturedKey) {
            return { inject: false, ok: false };
          }
          try {
            await applyClipboardFiles(paths);
          } catch (retryErr) {
            if (sessionKeyRef.current === capturedKey) {
              toast.error(retryErr instanceof Error ? retryErr.message : String(retryErr));
            }
            return { inject: false, ok: false };
          }
        } else {
          if (sessionKeyRef.current === capturedKey) {
            toast.error(err instanceof Error ? err.message : String(err));
          }
          return { inject: false, ok: false };
        }
      }

      return { inject: allowBinaryInject && sessionKeyRef.current === capturedKey, ok: true };
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
    (
      files: File[],
      source: 'clipboard' | 'picker' = 'picker',
      forRemotePaste: RemotePastePolicy = false,
    ) => {
      const classified = classifyTransfer({ source, files });
      return enqueue(() => ingestClassified(classified, forRemotePaste));
    },
    [enqueue, ingestClassified],
  );

  const ingestPaste = useCallback(
    (data: DataTransfer | null | undefined, forRemotePaste: RemotePastePolicy) => {
      // Extract DataTransfer synchronously before entering the async queue;
      // browsers clear ClipboardEvent.clipboardData once the event turn ends.
      const classified = classifyTransfer({
        source: 'clipboard',
        files: filesFromClipboard(data),
        text: data?.getData('text/plain') || '',
      });
      return enqueue(() => ingestClassified(classified, forRemotePaste));
    },
    [enqueue, ingestClassified],
  );

  const downloadToLocal = useCallback(
    async (filePath: string, name: string, size: number) => {
      if (!sessionId) return;
      const capturedKey = `${sessionId}:${subId || ''}`;
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
      const schedule = () => {
        const id = window.setTimeout(() => {
          downloadTimersRef.current.delete(id);
          if (sessionKeyRef.current !== capturedKey) {
            endPause();
            return;
          }
          const row = transferRef.current.localJobs.find((item) => item.id === job);
          if (row && row.state !== 'active') {
            endPause();
            return;
          }
          if (!row && Date.now() - started > 5000) {
            endPause();
            return;
          }
          schedule();
        }, 400);
        downloadTimersRef.current.add(id);
      };
      schedule();
    },
    [beginPause, sessionId, subId],
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
        invalidateSeenPath(filePath);
        await refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [invalidateSeenPath, refresh, sessionId],
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
