import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  DownloadIcon,
  FileIcon,
  FolderIcon,
  FolderPlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
} from 'lucide-react';
import type { FileEntry } from '../api/client';
import { api } from '../api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Props = { sessionId: string };

function joinPath(base: string, name: string) {
  if (!base || base === '.') return name;
  return `${base.replace(/\/$/, '')}/${name}`;
}

function parentPath(p: string) {
  if (!p || p === '.') return '.';
  const parts = p.split('/').filter(Boolean);
  parts.pop();
  return parts.length ? parts.join('/') : '.';
}

export default function FilePanel({ sessionId }: Props) {
  const [path, setPath] = useState('.');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [folderName, setFolderName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listFiles(sessionId, path);
      setEntries(data.entries);
      setPath(data.path);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [path, sessionId]);

  useEffect(() => {
    setPath('.');
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="truncate text-xs text-muted-foreground">
        Downloads / {path === '.' ? '' : path}
      </div>
      <div className="flex flex-wrap gap-1">
        <Button size="sm" variant="outline" disabled={path === '.'} onClick={() => setPath(parentPath(path))}>
          上级
        </Button>
        <Button size="icon-sm" variant="outline" onClick={() => void refresh()}>
          <RefreshCwIcon />
        </Button>
        <Button
          size="icon-sm"
          variant="outline"
          onClick={() => {
            setFolderName('');
            setMkdirOpen(true);
          }}
        >
          <FolderPlusIcon />
        </Button>
        <Button size="icon-sm" variant="outline" onClick={() => fileRef.current?.click()}>
          <UploadIcon />
        </Button>
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (!files.length) return;
            void (async () => {
              try {
                await api.upload(sessionId, path, files);
                await refresh();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : String(err));
              } finally {
                if (fileRef.current) fileRef.current.value = '';
              }
            })();
          }}
        />
      </div>
      <div className={`min-h-0 flex-1 overflow-auto ${loading ? 'opacity-60' : ''}`}>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">空目录</p>
        ) : (
          entries.map((row) => (
            <div key={row.name} className="flex items-center gap-2 py-1 text-sm">
              {row.type === 'dir' ? (
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => setPath(joinPath(path, row.name))}
                >
                  <FolderIcon className="size-4 shrink-0" />
                  <span className="truncate">{row.name}</span>
                </button>
              ) : (
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <FileIcon className="size-4 shrink-0" />
                  <span className="truncate">{row.name}</span>
                </span>
              )}
              <span className="flex shrink-0 items-center">
                {row.type === 'file' && (
                  <Button size="icon-xs" variant="ghost" asChild>
                    <a href={api.downloadUrl(sessionId, joinPath(path, row.name))} title="下载">
                      <DownloadIcon />
                    </a>
                  </Button>
                )}
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => {
                    void (async () => {
                      try {
                        await api.removeFile(sessionId, joinPath(path, row.name));
                        await refresh();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : String(err));
                      }
                    })();
                  }}
                >
                  <Trash2Icon />
                </Button>
              </span>
            </div>
          ))
        )}
      </div>
      <Dialog open={mkdirOpen} onOpenChange={setMkdirOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建文件夹</DialogTitle>
          </DialogHeader>
          <Input
            value={folderName}
            placeholder="文件夹名称"
            onChange={(e) => setFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && folderName.trim()) {
                void api
                  .mkdir(sessionId, joinPath(path, folderName.trim()))
                  .then(() => {
                    setMkdirOpen(false);
                    return refresh();
                  })
                  .catch((err: Error) => toast.error(err.message));
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMkdirOpen(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                if (!folderName.trim()) return;
                void api
                  .mkdir(sessionId, joinPath(path, folderName.trim()))
                  .then(() => {
                    setMkdirOpen(false);
                    return refresh();
                  })
                  .catch((err: Error) => toast.error(err.message));
              }}
            >
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
