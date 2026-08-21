import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api/client';
import { APP_NAME, useDocumentTitle } from '../lib/title';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function LoginPage({ onOk }: { onOk: () => void }) {
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  useDocumentTitle(`登录 - ${APP_NAME}`);

  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Nya Browser</CardTitle>
          <CardDescription>多用户浏览器管理系统</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                setBusy(true);
                try {
                  await api.login(username, password);
                  onOk();
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : String(err));
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                placeholder="用户名"
                autoFocus
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="密码"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              进入
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
