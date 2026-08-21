import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { AccessGrant, Session, SessionGroup, UserPublic } from '@nya/shared';
import { api } from '../../api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ResourceGrantPicker } from './GrantEditor';

type Row = UserPublic & { grants: AccessGrant[] };

function grantSummary(grants: AccessGrant[] | undefined) {
  const list = grants || [];
  const folders = list.filter((g) => g.kind === 'folder').length;
  const sessions = list.filter((g) => g.kind === 'session').length;
  if (!folders && !sessions) return '无';
  const parts: string[] = [];
  if (folders) parts.push(`${folders} 个目录`);
  if (sessions) parts.push(`${sessions} 个会话`);
  return parts.join(' · ');
}

export default function UsersPage() {
  const [users, setUsers] = useState<Row[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [groups, setGroups] = useState<SessionGroup[]>([]);
  const [open, setOpen] = useState(false);
  const [assignUser, setAssignUser] = useState<Row | null>(null);
  const [folderIds, setFolderIds] = useState<Set<string>>(new Set());
  const [sessionIds, setSessionIds] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Row | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');

  const load = useCallback(async () => {
    const [u, s, g] = await Promise.all([api.listUsers(), api.listSessions(), api.listGroups()]);
    setUsers(u.users);
    setSessions(s.sessions);
    setGroups(g.groups);
  }, []);

  useEffect(() => {
    void load().catch((e: Error) => toast.error(e.message));
  }, [load]);

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">用户管理</h2>
        <Button
          onClick={() => {
            setUsername('');
            setPassword('');
            setRole('user');
            setOpen(true);
          }}
        >
          新建用户
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>用户名</TableHead>
            <TableHead>角色</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>权限</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="font-medium">{u.username}</TableCell>
              <TableCell>
                <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>
                  {u.role === 'admin' ? '管理员' : '用户'}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={u.disabled ? 'outline' : 'secondary'}>
                  {u.disabled ? '禁用' : '正常'}
                </Badge>
              </TableCell>
              <TableCell>{grantSummary(u.grants)}</TableCell>
              <TableCell className="text-right">
                <div className="inline-flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setAssignUser(u);
                      setFolderIds(
                        new Set((u.grants || []).filter((g) => g.kind === 'folder').map((g) => g.targetId)),
                      );
                      setSessionIds(
                        new Set((u.grants || []).filter((g) => g.kind === 'session').map((g) => g.targetId)),
                      );
                    }}
                  >
                    分配权限
                  </Button>
                  <Switch
                    checked={!u.disabled}
                    onCheckedChange={(v: boolean) =>
                      void api.updateUser(u.id, { disabled: !v }).then(load)
                    }
                  />
                  <Button size="sm" variant="destructive" onClick={() => setPending(u)}>
                    删除
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={open} onOpenChange={(v: boolean) => !v && setOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建用户</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void api
                .createUser({ username, password, role })
                .then(() => {
                  toast.success('已创建');
                  setOpen(false);
                  return load();
                })
                .catch((err: Error) => toast.error(err.message));
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="new-username">用户名</Label>
              <Input
                id="new-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-password">密码</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                minLength={4}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label>角色</Label>
              <Select value={role} onValueChange={(v: string) => setRole(v as 'user' | 'admin')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">用户</SelectItem>
                  <SelectItem value="admin">管理员</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="submit">创建</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(assignUser)} onOpenChange={(v: boolean) => !v && setAssignUser(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>分配权限 · {assignUser?.username || ''}</DialogTitle>
          </DialogHeader>
          <ResourceGrantPicker
            groups={groups}
            sessions={sessions}
            folderIds={folderIds}
            sessionIds={sessionIds}
            onFolderIds={setFolderIds}
            onSessionIds={setSessionIds}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignUser(null)}>
              取消
            </Button>
            <Button
              onClick={() => {
                if (!assignUser) return;
                const grants = [
                  ...[...folderIds].map((targetId) => ({ kind: 'folder' as const, targetId })),
                  ...[...sessionIds].map((targetId) => ({ kind: 'session' as const, targetId })),
                ];
                void api
                  .setUserGrants(assignUser.id, grants)
                  .then(() => {
                    toast.success('已保存');
                    setAssignUser(null);
                    return load();
                  })
                  .catch((err: Error) => toast.error(err.message));
              }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(pending)} onOpenChange={(v: boolean) => !v && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 {pending?.username}?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!pending) return;
                void api.deleteUser(pending.id).then(load);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
