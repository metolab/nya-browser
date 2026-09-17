import { useEffect, useState } from 'react';
import DeskFloat from '../desk/DeskFloat';
import { api } from '../api/client';
import { previewKind } from '../lib/files';

type Props = {
  sessionId: string;
  path: string;
  name: string;
  onClose: () => void;
};

export default function FilePreview({ sessionId, path, name, onClose }: Props) {
  const kind = previewKind(name);
  const src = api.downloadUrl(sessionId, path);
  const [text, setText] = useState('');

  useEffect(() => {
    if (kind !== 'text') return undefined;
    let gone = false;
    void fetch(src, { credentials: 'include' })
      .then((res) => res.text())
      .then((body) => {
        if (!gone) setText(body.slice(0, 200_000));
      })
      .catch(() => {
        if (!gone) setText('');
      });
    return () => {
      gone = true;
    };
  }, [kind, src]);

  return (
    <DeskFloat
      title={name}
      onClose={onClose}
      className="right-3 top-16 z-[70] w-[min(32rem,calc(100vw-1.5rem))]"
      bodyClassName="max-h-[min(28rem,60vh)] overflow-auto"
    >
      {kind === 'image' ? (
        <img src={src} alt={name} className="max-h-[min(26rem,56vh)] max-w-full object-contain" />
      ) : kind === 'pdf' ? (
        <iframe title={name} src={src} sandbox="" className="h-[min(26rem,56vh)] w-full bg-background" />
      ) : kind === 'text' ? (
        <pre className="whitespace-pre-wrap break-all text-xs">{text || '无法预览'}</pre>
      ) : (
        <p className="py-6 text-center text-xs text-muted-foreground">此类型无法预览，请下载到本机查看。</p>
      )}
    </DeskFloat>
  );
}
