import { useRef, useState, type ClipboardEvent } from 'react';
import { UploadIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { filesFromClipboard } from '../lib/transferIngest';
import { requestPointerRelease } from '../lib/vncSession';

type Props = {
  open: boolean;
  chooserOpen: boolean;
  uploading: boolean;
  ratio: number;
  note?: string;
  onOpenChange: (open: boolean) => void;
  onFiles: (files: File[]) => void | Promise<void>;
  onPaste: (data: DataTransfer | null) => void | Promise<void>;
};

export default function UploadDialog({
  open,
  chooserOpen,
  uploading,
  ratio,
  note,
  onOpenChange,
  onFiles,
  onPaste,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onPaste={(event: ClipboardEvent<HTMLDivElement>) => {
          event.preventDefault();
          requestPointerRelease();
          void onPaste(event.clipboardData);
        }}
      >
        <DialogHeader>
          <DialogTitle>传到会话</DialogTitle>
          <DialogDescription>
            {chooserOpen
              ? '远程正在选文件。传到公共目录后即可点选；列表没有刷新的话，点一下上一级再回来。'
              : '文件会进入这个会话的公共目录，也可以再贴到远程网页里。'}
          </DialogDescription>
        </DialogHeader>
        <button
          type="button"
          disabled={uploading}
          className={`flex min-h-36 flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center text-sm ${
            over ? 'border-primary bg-muted/60' : 'bg-muted/30'
          }`}
          onClick={() => {
            requestPointerRelease();
            inputRef.current?.click();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setOver(false);
            const files = filesFromClipboard(event.dataTransfer);
            requestPointerRelease();
            if (files.length) void onFiles(files);
          }}
        >
          <UploadIcon className="size-5 text-muted-foreground" />
          <div>拖到这里，或 Ctrl+V，或点击选择</div>
          <div className="text-xs text-muted-foreground">单个文件不超过 50MB</div>
        </button>
        {uploading || note ? (
          <div className="text-xs text-muted-foreground">
            {note || '正在上传…'} {uploading ? `${Math.round(ratio * 100)}%` : ''}
          </div>
        ) : null}
        {chooserOpen ? (
          <p className="text-[11px] text-muted-foreground">关闭这个窗口不会关掉远程文件框。</p>
        ) : null}
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              requestPointerRelease();
              onOpenChange(false);
            }}
          >
            完成
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            const picked = Array.from(event.target.files || []);
            event.target.value = '';
            requestPointerRelease();
            if (picked.length) void onFiles(picked);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
