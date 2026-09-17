import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { SessionTransfer } from '@nya/shared';
import { api } from '../api/client';
import { TRANSFER_PAUSE_BYTES } from './files';

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
};

export function useSessionFiles({ sessionId, subId, enabled }: Opts) {
  const [transfer, setTransfer] = useState<SessionTransfer>(emptyTransfer);
  const [uploading, setUploading] = useState(false);
  const [uploadRatio, setUploadRatio] = useState(0);
  const [paused, setPaused] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [preview, setPreview] = useState<{ path: string; name: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const gestureAt = useRef(0);
  const pickerFor = useRef('');
  const pauseCount = useRef(0);
  const transferRef = useRef(transfer);
  transferRef.current = transfer;

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
    return next;
  }, [sessionId, subId]);

  useEffect(() => {
    if (!enabled || !sessionId) {
      setTransfer(emptyTransfer());
      return undefined;
    }
    let timer = 0;
    const tick = async () => {
      try {
        await refresh();
      } catch {
        /* keep last */
      }
      timer = window.setTimeout(() => void tick(), 400);
    };
    void tick();
    return () => window.clearTimeout(timer);
  }, [enabled, refresh, sessionId]);

  const openLocalPicker = useCallback(() => {
    inputRef.current?.click();
    setFallback(false);
  }, []);

  const armGesture = useCallback(() => {
    gestureAt.current = Date.now();
    const chooser = transferRef.current.chooser;
    if (!chooser?.open) return;
    if (Date.now() - gestureAt.current > 5000) {
      setFallback(true);
      return;
    }
    const token = chooser.title || 'open';
    if (pickerFor.current === token) return;
    pickerFor.current = token;
    openLocalPicker();
  }, [openLocalPicker]);

  useEffect(() => {
    if (!transfer.chooser?.open) {
      pickerFor.current = '';
      setFallback(false);
      return;
    }
    if (Date.now() - gestureAt.current > 5000) {
      setFallback(true);
      return;
    }
    const token = transfer.chooser.title || 'open';
    if (pickerFor.current === token) return;
    pickerFor.current = token;
    openLocalPicker();
  }, [openLocalPicker, transfer.chooser?.open, transfer.chooser?.title]);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!sessionId || !files.length) return;
      const total = files.reduce((sum, file) => sum + file.size, 0);
      const endPause = beginPause(total);
      setUploading(true);
      setUploadRatio(0);
      try {
        await api.upload(sessionId, '.', files, setUploadRatio);
        await refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setUploading(false);
        setUploadRatio(0);
        endPause();
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [beginPause, refresh, sessionId],
  );

  const downloadToLocal = useCallback(
    async (filePath: string, name: string, size: number) => {
      if (!sessionId) return;
      const job = crypto.randomUUID();
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
    uploading,
    uploadRatio,
    paused,
    fallback,
    preview,
    setPreview,
    inputRef,
    armGesture,
    openLocalPicker,
    uploadFiles,
    downloadToLocal,
    remove,
    refresh,
  };
}
