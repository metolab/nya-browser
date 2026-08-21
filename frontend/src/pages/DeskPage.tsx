import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2Icon } from 'lucide-react';
import type { Session, SessionGroup } from '@nya/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth';
import ClipboardPanel from '../components/ClipboardPanel';
import FilePanel from '../components/FilePanel';
import { SessionTree } from '../components/SessionTree';
import DeskFloat from '../desk/DeskFloat';
import DeskLauncher from '../desk/DeskLauncher';
import DeskStage from '../desk/DeskStage';
import { vncWindowExtra } from '../lib/vnc';
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

type Active = {
  session: Session;
  windowId: string;
  occupancyId: string | null;
};

export default function DeskPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [groups, setGroups] = useState<SessionGroup[]>([]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<Active | null>(null);
  const [busy, setBusy] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const openingLock = useRef(false);
  const [takeover, setTakeover] = useState<Session | null>(null);
  const [clipOpen, setClipOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);

  const refresh = useCallback(async () => {
    const [s, g] = await Promise.all([api.listSessions(), api.listGroups()]);
    setSessions(s.sessions);
    setGroups(g.groups);
    setActive((cur) => {
      if (!cur) return cur;
      const next = s.sessions.find((x) => x.id === cur.session.id);
      if (!next) return null;
      const alive = (next.runtime?.windows || []).some((w) => w.id === cur.windowId);
      if (!alive) return null;
      return { ...cur, session: next };
    });
  }, []);

  useEffect(() => {
    void refresh().catch((err: Error) => toast.error(err.message));
    const t = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(t);
  }, [refresh]);

  const openSession = async (session: Session, takeoverWindow = false) => {
    if (openingLock.current) return;
    openingLock.current = true;
    setBusy(true);
    setOpeningId(session.id);
    try {
      const created = await api.createWindow(session.id, { takeover: takeoverWindow || undefined });
      const windowId = created.window?.id;
      if (!windowId) throw new Error('窗口创建失败');
      setActive({
        session,
        windowId,
        occupancyId: created.window.occupancyId || null,
      });
      setTakeover(null);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'WINDOW_OWNED') {
        setTakeover(session);
        return;
      }
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      openingLock.current = false;
      setBusy(false);
      setOpeningId(null);
    }
  };

  const closeActive = async () => {
    const cur = active;
    setActive(null);
    setClipOpen(false);
    setFilesOpen(false);
    if (cur?.session.id && cur.windowId) {
      await api.closeWindow(cur.session.id, cur.windowId).catch(() => undefined);
    }
  };

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-background">
      {active ? (
        <DeskStage
          session={active.session}
          windowId={active.windowId}
          occupancyId={active.occupancyId}
          busy={busy}
          onClose={() => void closeActive()}
        />
      ) : (
        <div className="flex h-full items-center justify-center p-6">
          <div className="relative flex h-[min(52rem,85vh)] w-full max-w-sm flex-col rounded-xl border bg-card p-3 shadow-xs">
            <div className="mb-2 shrink-0 text-sm font-semibold">选择会话</div>
            <SessionTree
              mode="pick"
              className="min-h-0 flex-1"
              groups={groups}
              sessions={sessions}
              query={query}
              onQueryChange={setQuery}
              disabled={busy}
              openingId={openingId}
              onPick={(session) => void openSession(session)}
            />
            {busy ? (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-card/80 backdrop-blur-[2px]">
                <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
                <div className="text-sm font-medium">
                  正在打开{openingId ? `「${sessions.find((s) => s.id === openingId)?.name || ''}」` : '会话'}
                </div>
                <p className="text-xs text-muted-foreground">请稍候，启动可能需要一些时间</p>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <DeskLauncher
        username={user.username}
        isAdmin={user.role === 'admin'}
        hasSession={Boolean(active)}
        onAdmin={() => nav('/admin/sessions')}
        onLogout={() => {
          void api.logout().then(() => window.location.reload());
        }}
        onClipboard={() => {
          if (!active) {
            toast.warning('请先打开一个会话');
            return;
          }
          setClipOpen(true);
        }}
        onFiles={() => {
          if (!active) {
            toast.warning('请先打开一个会话');
            return;
          }
          setFilesOpen(true);
        }}
      />

      {active && clipOpen ? (
        <DeskFloat
          title="剪贴板"
          subtitle={active.session.name}
          onClose={() => setClipOpen(false)}
          className="right-3 bottom-16"
        >
          <ClipboardPanel
            sessionId={active.session.id}
            subId={vncWindowExtra(active.windowId)}
            ready={Boolean(active.windowId)}
          />
        </DeskFloat>
      ) : null}

      {active && filesOpen ? (
        <DeskFloat
          title="文件管理"
          subtitle={active.session.name}
          onClose={() => setFilesOpen(false)}
          className={clipOpen ? 'right-[19.5rem] bottom-16' : 'right-3 bottom-16'}
          bodyClassName="h-72"
        >
          <FilePanel sessionId={active.session.id} />
        </DeskFloat>
      ) : null}

      <AlertDialog
        open={Boolean(takeover)}
        onOpenChange={(open: boolean) => {
          if (!open && !busy) setTakeover(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>会话已在其他页面打开</AlertDialogTitle>
            <AlertDialogDescription>
              「{takeover?.name}」已在你的另一个标签页或窗口中使用。接管后，原页面会立即失效。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event: MouseEvent<HTMLButtonElement>) => {
                event.preventDefault();
                if (takeover) void openSession(takeover, true);
              }}
            >
              {busy ? '正在接管…' : '接管'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
