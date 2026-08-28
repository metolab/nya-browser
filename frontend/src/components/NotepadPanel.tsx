import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api/client';
import { Button } from '@/components/ui/button';
import DeskFloat from '../desk/DeskFloat';

type Props = {
  sessionId: string;
  sessionName: string;
  onClose: () => void;
};

export default function NotepadPanel({ sessionId, sessionName, onClose }: Props) {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api
      .getNotepad(sessionId)
      .then((data) => {
        if (cancelled) return;
        setText(data.notepad);
        setSaved(data.notepad);
      })
      .catch((err: Error) => {
        if (!cancelled) toast.error(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const dirty = text !== saved;

  return (
    <DeskFloat
      title="Notepad"
      subtitle={sessionName}
      onClose={onClose}
      className="left-3 top-16 w-96"
      bodyClassName="h-72 p-0"
      actions={
        <Button
          size="xs"
          disabled={loading || busy || !dirty}
          onClick={() => {
            setBusy(true);
            void api
              .putNotepad(sessionId, text)
              .then((data) => {
                setText(data.notepad);
                setSaved(data.notepad);
                toast.success('已保存');
              })
              .catch((err: Error) => toast.error(err.message))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? '保存中…' : '保存'}
        </Button>
      }
    >
      <textarea
        className="h-full min-h-0 w-full resize-none border-0 bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
        value={text}
        disabled={loading || busy}
        placeholder={loading ? '加载中…' : '写点什么'}
        onChange={(e) => setText(e.target.value)}
      />
    </DeskFloat>
  );
}
