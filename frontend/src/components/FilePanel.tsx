import { DownloadIcon, FileIcon, RefreshCwIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import type { SessionDownload, SessionUpload } from '@nya/shared';
import { Button } from '@/components/ui/button';
import { formatBytes, hostOf } from '../lib/files';

type Tab = 'uploads' | 'downloads';

type Props = {
  tab: Tab;
  onTab: (tab: Tab) => void;
  uploads: SessionUpload[];
  downloads: SessionDownload[];
  loading?: boolean;
  onUpload: () => void;
  onRefresh: () => void;
  onDownload: (path: string, name: string, size: number) => void;
  onRemove: (path: string) => void;
  onPreview: (path: string, name: string) => void;
};

function stateLabel(state: SessionDownload['state']) {
  if (state === 'in_progress') return '进行中';
  if (state === 'failed') return '失败';
  if (state === 'cancelled') return '已取消';
  return '完成';
}

export default function FilePanel({
  tab,
  onTab,
  uploads,
  downloads,
  loading,
  onUpload,
  onRefresh,
  onDownload,
  onRemove,
  onPreview,
}: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex gap-1">
        <Button size="xs" variant={tab === 'uploads' ? 'default' : 'outline'} onClick={() => onTab('uploads')}>
          上传
        </Button>
        <Button size="xs" variant={tab === 'downloads' ? 'default' : 'outline'} onClick={() => onTab('downloads')}>
          下载
        </Button>
        <span className="ml-auto flex gap-1">
          <Button size="icon-xs" variant="outline" onClick={onRefresh} title="刷新">
            <RefreshCwIcon />
          </Button>
          <Button size="icon-xs" variant="outline" onClick={onUpload} title="上传到公共目录">
            <UploadIcon />
          </Button>
        </span>
      </div>
      <div className={`min-h-0 flex-1 overflow-auto ${loading ? 'opacity-60' : ''}`}>
        {tab === 'uploads' ? (
          uploads.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">还没有上传的文件</p>
          ) : (
            uploads.map((row) => (
              <FileRow
                key={row.path}
                name={row.name}
                hint={formatBytes(row.size)}
                canDownload
                onDownload={() => onDownload(row.path, row.name, row.size)}
                onRemove={() => onRemove(row.path)}
                onPreview={() => onPreview(row.path, row.name)}
              />
            ))
          )
        ) : downloads.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">还没有下载记录</p>
        ) : (
          downloads.map((row) => (
            <FileRow
              key={row.id}
              name={row.name}
              hint={`${stateLabel(row.state)} · ${formatBytes(row.receivedBytes || row.totalBytes)}${
                row.url ? ` · ${hostOf(row.url)}` : ''
              }${row.missing ? ' · 文件已删除' : ''}`}
              url={row.url}
              canDownload={row.state === 'completed' && !row.missing}
              onDownload={() => onDownload(row.path, row.name, row.totalBytes || row.receivedBytes)}
              onRemove={() => onRemove(row.path)}
              onPreview={() => onPreview(row.path, row.name)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function FileRow({
  name,
  hint,
  url,
  canDownload,
  onDownload,
  onRemove,
  onPreview,
}: {
  name: string;
  hint: string;
  url?: string;
  canDownload: boolean;
  onDownload: () => void;
  onRemove: () => void;
  onPreview: () => void;
}) {
  return (
    <div className="flex items-start gap-2 border-b border-border/60 py-1.5 last:border-0">
      <FileIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onPreview} title={url || name}>
        <div className="truncate text-sm">{name}</div>
        <div className="truncate text-[11px] text-muted-foreground">{hint}</div>
      </button>
      <span className="flex shrink-0 items-center">
        {canDownload ? (
          <Button size="icon-xs" variant="ghost" title="下载到本机" onClick={onDownload}>
            <DownloadIcon />
          </Button>
        ) : null}
        <Button size="icon-xs" variant="ghost" title="删除" onClick={onRemove}>
          <Trash2Icon />
        </Button>
      </span>
    </div>
  );
}
