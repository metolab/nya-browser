import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { ProxyRecord, Session, SessionGroup, UserPublic } from '@nya/shared';
import { DEFAULT_TIMEZONE } from '@nya/shared';
import { api } from '../../api/client';
import { SessionTree } from '../../components/SessionTree';
import SessionFormDialog from '../../components/SessionFormDialog';
import { UserGrantList } from './GrantEditor';
import { NONE_KEY, groupSelectOptions } from '@/lib/groups';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  AlertDialogDescription,
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

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [groups, setGroups] = useState<SessionGroup[]>([]);
  const [proxies, setProxies] = useState<ProxyRecord[]>([]);
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [query, setQuery] = useState('');
  const [createGroupId, setCreateGroupId] = useState<string | null>(null);
  const [openCreate, setOpenCreate] = useState(false);
  const [edit, setEdit] = useState<Session | null>(null);
  const [assign, setAssign] = useState<Session | null>(null);
  const [assignFolder, setAssignFolder] = useState<SessionGroup | null>(null);
  const [grantUserIds, setGrantUserIds] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderEditing, setFolderEditing] = useState<SessionGroup | null>(null);
  const [folderName, setFolderName] = useState('');
  const [folderParent, setFolderParent] = useState<string | null>(null);
  const [pendingFolder, setPendingFolder] = useState<SessionGroup | null>(null);

  const load = useCallback(async () => {
    const [s, p, u, g] = await Promise.all([
      api.listSessions(),
      api.listProxies(),
      api.listUsers(),
      api.listGroups(),
    ]);
    setSessions(s.sessions);
    setProxies(p.proxies);
    setUsers(u.users);
    setGroups(g.groups);
  }, []);

  useEffect(() => {
    void load().catch((e: Error) => toast.error(e.message));
  }, [load]);

  const openFolder = (parent: string | null, editing: SessionGroup | null = null) => {
    setFolderEditing(editing);
    setFolderName(editing?.name || '');
    setFolderParent(editing ? editing.parentId : parent);
    setFolderOpen(true);
  };

  const saveFolder = async () => {
    const trimmed = folderName.trim();
    if (!trimmed) {
      toast.error('请输入目录名称');
      return;
    }
    try {
      if (folderEditing) {
        await api.updateGroup(folderEditing.id, { name: trimmed, parentId: folderParent });
        toast.success('已保存');
      } else {
        await api.createGroup({ name: trimmed, parentId: folderParent });
        toast.success('已创建');
      }
      setFolderOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const moveTo = async (sessionId: string, groupId: string | null) => {
    try {
      await api.updateSession(sessionId, { groupId });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 p-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">会话管理</h2>
        <p className="mt-1 text-sm text-muted-foreground">按目录树管理会话，共 {sessions.length} 个</p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card p-4 shadow-xs">
        <SessionTree
          mode="manage"
          className="min-h-0 flex-1"
          groups={groups}
          sessions={sessions}
          query={query}
          onQueryChange={setQuery}
          onCreateSession={(groupId) => {
            setCreateGroupId(groupId);
            setOpenCreate(true);
          }}
          onEditSession={setEdit}
          onDeleteSession={setPendingDelete}
          onAssignSession={(s) => {
            setAssignFolder(null);
            setAssign(s);
            setGrantUserIds(new Set((s.grants || []).map((g) => g.userId)));
          }}
          onExportSession={(s) => {
            window.location.href = api.exportUrl(s.id);
          }}
          onMoveSession={(id, groupId) => void moveTo(id, groupId)}
          onCreateFolder={(parentId) => openFolder(parentId)}
          onEditFolder={(g) => openFolder(g.parentId, g)}
          onDeleteFolder={setPendingFolder}
          onAssignFolder={(g) => {
            setAssign(null);
            setGrantUserIds(new Set());
            setAssignFolder(g);
            void api
              .getFolderGrants(g.id)
              .then((d) => setGrantUserIds(new Set(d.grants.map((x) => x.userId))))
              .catch((e: Error) => toast.error(e.message));
          }}
        />
      </div>

      <SessionFormDialog
        open={openCreate}
        title="新建会话"
        submitLabel="创建"
        proxies={proxies}
        groups={groups}
        initialGroupId={createGroupId}
        onCancel={() => setOpenCreate(false)}
        onSubmit={async (data) => {
          await api.createSession({
            ...data,
            groupId: data.groupId ?? createGroupId,
          });
          await load();
          toast.success('已创建');
        }}
      />
      <SessionFormDialog
        open={Boolean(edit)}
        title="编辑会话"
        submitLabel="保存"
        proxies={proxies}
        groups={groups}
        initialName={edit?.name}
        initialDescription={edit?.description}
        initialGroupId={edit?.groupId}
        initialProxyId={edit?.proxyId}
        initialTimezone={edit?.timezone || DEFAULT_TIMEZONE}
        initialHomeUrl={edit?.homeUrl}
        onCancel={() => setEdit(null)}
        onSubmit={async (data) => {
          if (!edit) return;
          await api.updateSession(edit.id, data);
          await load();
          toast.success('已保存');
        }}
      />

      <Dialog
        open={Boolean(assign) || Boolean(assignFolder)}
        onOpenChange={(v: boolean) => {
          if (!v) {
            setAssign(null);
            setAssignFolder(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {assignFolder ? `目录权限 · ${assignFolder.name}` : `会话权限 · ${assign?.name || ''}`}
            </DialogTitle>
          </DialogHeader>
          {assignFolder ? (
            <p className="text-sm text-muted-foreground">
              被授权用户可以使用该目录及子目录下的全部会话，包括之后新建的。
            </p>
          ) : null}
          <UserGrantList users={users} selected={grantUserIds} onChange={setGrantUserIds} />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAssign(null);
                setAssignFolder(null);
              }}
            >
              取消
            </Button>
            <Button
              onClick={() => {
                const ids = [...grantUserIds];
                const req = assignFolder
                  ? api.setFolderGrants(assignFolder.id, ids)
                  : assign
                    ? api.setSessionGrants(assign.id, ids)
                    : null;
                if (!req) return;
                void req
                  .then(() => {
                    toast.success('已保存');
                    setAssign(null);
                    setAssignFolder(null);
                    return load();
                  })
                  .catch((e: Error) => toast.error(e.message));
              }}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{folderEditing ? '编辑目录' : '新建目录'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="folder-name">名称</Label>
              <Input
                id="folder-name"
                value={folderName}
                maxLength={80}
                placeholder="例如：客户 A"
                autoFocus
                onChange={(e) => setFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveFolder();
                }}
              />
            </div>
            <div className="grid gap-2">
              <Label>上级目录</Label>
              <Select
                value={folderParent || NONE_KEY}
                onValueChange={(v: string) => setFolderParent(v === NONE_KEY ? null : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="无（顶层）" />
                </SelectTrigger>
                <SelectContent position="popper" className="max-h-64">
                  <SelectItem value={NONE_KEY}>无（顶层）</SelectItem>
                  {groupSelectOptions(groups)
                    .filter((opt) => opt.value !== folderEditing?.id)
                    .map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderOpen(false)}>
              取消
            </Button>
            <Button onClick={() => void saveFolder()}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(v: boolean) => !v && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 {pendingDelete?.name}？</AlertDialogTitle>
            <AlertDialogDescription>删除后无法恢复，会话数据会被清除。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!pendingDelete) return;
                void api
                  .deleteSession(pendingDelete.id)
                  .then(() => {
                    toast.success('已删除');
                    return load();
                  })
                  .catch((e: Error) => toast.error(e.message));
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(pendingFolder)} onOpenChange={(v: boolean) => !v && setPendingFolder(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除目录「{pendingFolder?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>其中的会话会变为未归类，子目录会移到上一级。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (!pendingFolder) return;
                void api
                  .deleteGroup(pendingFolder.id)
                  .then(() => {
                    toast.success('已删除');
                    return load();
                  })
                  .catch((e: Error) => toast.error(e.message));
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
