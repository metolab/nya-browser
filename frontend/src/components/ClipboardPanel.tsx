import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type Props = {
  sessionId: string;
  subId?: string | null;
  ready: boolean;
};

export default function ClipboardPanel({ sessionId, subId = null, ready }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setText('');
  }, [sessionId, subId]);

  return (
    <div className="grid gap-2">
      <Textarea
        className="min-h-16 text-xs"
        value={text}
        disabled={!ready || busy}
        placeholder={ready ? '粘贴或编辑文本' : '打开窗口后可用'}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!ready || busy}
          onClick={() => {
            void (async () => {
              setBusy(true);
              try {
                const data = await api.getClipboard(sessionId, subId);
                setText(data.text);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          读取
        </Button>
        <Button
          size="sm"
          disabled={!ready || busy}
          onClick={() => {
            void (async () => {
              setBusy(true);
              try {
                await api.setClipboard(sessionId, text, subId);
              } catch (err) {
                toast.error(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          写入
        </Button>
      </div>
    </div>
  );
}
