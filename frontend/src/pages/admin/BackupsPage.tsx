import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api } from '../../api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default function BackupsPage() {
  const nav = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-col gap-4 p-6">
      <h2 className="text-lg font-semibold">备份与恢复</h2>
      <Card>
        <CardHeader>
          <CardTitle>导入会话归档</CardTitle>
          <CardDescription>
            上传先前导出的 `.nya-session.tar.zst` / `.tar.gz`。导入会创建新会话。
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Input
            ref={inputRef}
            type="file"
            accept=".tar.zst,.tar.gz,.zst,.gz"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              void api
                .importSession(file)
                .then((r) => {
                  toast.success(
                    `已导入 ${r.session.name}${r.proxyMatched ? '' : '（代理未匹配，已直连）'}`,
                  );
                  nav('/admin/sessions');
                })
                .catch((err: Error) => toast.error(err.message))
                .finally(() => {
                  setBusy(false);
                  if (inputRef.current) inputRef.current.value = '';
                });
            }}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>导出</CardTitle>
          <CardDescription>
            请到「会话管理」中点击导出。归档包含指纹、首页、书签/Cookie/历史等用户数据（不含缓存）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => nav('/admin/sessions')}>
            前往会话
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
