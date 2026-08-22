import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

type Props = {
  text: string;
  onTextChange: (value: string) => void;
  auto: boolean;
  onAutoChange: (value: boolean) => void;
  ready: boolean;
  busy: boolean;
  permission: 'unknown' | 'granted' | 'denied';
  status: string;
  onPull: () => Promise<void>;
  onPush: () => Promise<void>;
  onRequestPermission: () => Promise<void>;
};

export default function ClipboardPanel({
  text,
  onTextChange,
  auto,
  onAutoChange,
  ready,
  busy,
  permission,
  status,
  onPull,
  onPush,
  onRequestPermission,
}: Props) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="clip-auto" className="text-xs font-normal">
          自动同步
        </Label>
        <Switch
          id="clip-auto"
          size="sm"
          checked={auto}
          disabled={!ready}
          onCheckedChange={onAutoChange}
        />
      </div>
      <Textarea
        className="min-h-16 text-xs"
        value={text}
        disabled={!ready || busy}
        placeholder={ready ? '本地与远程剪贴板会自动同步' : '打开窗口后可用'}
        onChange={(e) => onTextChange(e.target.value)}
      />
      <p className="text-[11px] text-muted-foreground">{ready ? status : '打开窗口后可用'}</p>
      {permission === 'denied' ? (
        <Button
          size="sm"
          variant="outline"
          disabled={!ready}
          onClick={() => {
            void onRequestPermission().catch((err) => {
              toast.error(err instanceof Error ? err.message : String(err));
            });
          }}
        >
          授权读取本地剪贴板
        </Button>
      ) : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!ready || busy}
          onClick={() => {
            void onPull().catch((err) => {
              toast.error(err instanceof Error ? err.message : String(err));
            });
          }}
        >
          读取
        </Button>
        <Button
          size="sm"
          disabled={!ready || busy}
          onClick={() => {
            void onPush().catch((err) => {
              toast.error(err instanceof Error ? err.message : String(err));
            });
          }}
        >
          写入
        </Button>
      </div>
    </div>
  );
}
