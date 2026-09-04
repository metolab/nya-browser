import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2Icon } from 'lucide-react';
import type { Session, SessionGroup } from '@nya/shared';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth';
import ClipboardPanel from '../components/ClipboardPanel';
import { useClipboardSync } from '../lib/useClipboardSync';
import FilePanel from '../components/FilePanel';
import NotepadPanel from '../components/NotepadPanel';
import { SessionTree } from '../components/SessionTree';
import DeskFloat from '../desk/DeskFloat';
import DeskLauncher from '../desk/DeskLauncher';
import DeskStage from '../desk/DeskStage';
import DisplaySettings from '../desk/DisplaySettings';
import { defaultDisplayPolicy, formatSize, resolveRemoteSize, type DisplayPolicy, type Size } from '../desk/display';
import { formatDeskTitle, useDocumentTitle } from '../lib/title';
import { openSessionDeskWindow, sessionDeskPath } from '../lib/sessionWindow';
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
  const { sessionId: routeSessionId } = useParams<{ sessionId?: string }>();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [groups, setGroups] = useState<SessionGroup[]>([]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<Active | null>(null);
  const [busy, setBusy] = useState(false);
  const [listReady, setListReady] = useState(false);
  const [routeMiss, setRouteMiss] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const openingLock = useRef(false);
  const startedRoute = useRef<string | null>(null);
  const [takeover, setTakeover] = useState<Session | null>(null);
  const [clipOpen, setClipOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [notepadOpen, setNotepadOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [display, setDisplay] = useState<DisplayPolicy>(defaultDisplayPolicy);
  const [sizeTick, setSizeTick] = useState(0);
  const [pane, setPane] = useState<Size>({ w: 1280, h: 720 });
  const [tabTitle, setTabTitle] = useState('');

  const remote = resolveRemoteSize(pane, display);
  const clip = useClipboardSync({
    sessionId: active?.session.id,
    subId: active ? vncWindowExtra(active.windowId) : null,
    enabled: Boolean(active?.windowId),
  });
  useDocumentTitle(formatDeskTitle(active?.session.name, tabTitle));

  const onPaneChange = useCallback((next: Size) => {
    setPane(next);
  }, []);

  const refresh = useCallback(async () => {
    const [s, g] = await Promise.all([api.listSessions(), api.listGroups()]);
    setSessions(s.sessions);
    setGroups(g.groups);
    setListReady(true);
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

  useEffect(() => {
    if (active) return;
    setClipOpen(false);
    setFilesOpen(false);
    setNotepadOpen(false);
    setDisplayOpen(false);
    setTabTitle('');
  }, [active]);

  useEffect(() => {
    if (!active?.session.canNotepad) setNotepadOpen(false);
  }, [active?.session.canNotepad]);

  useEffect(() => {
    if (!active) {
      setTabTitle('');
      return undefined;
    }
    let cancelled = false;
    const pull = async () => {
      try {
        const data = await api.getChromeTitle(active.session.id, vncWindowExtra(active.windowId));
        if (!cancelled) setTabTitle(data.title || '');
      } catch {
        /* session may have stopped */
      }
    };
    void pull();
    const t = window.setInterval(() => void pull(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [active?.session.id, active?.windowId]);

  const exitSessionWindow = () => {
    if (!routeSessionId) return;
    window.close();
    nav('/', { replace: true });
  };

  const openSession = async (session: Session, takeoverWindow = false) => {
    if (openingLock.current) return;
    openingLock.current = true;
    setBusy(true);
    setOpeningId(session.id);
    try {
      const created = await api.createWindow(session.id, { takeover: takeoverWindow || undefined });
      const windowId = created.window?.id;
      if (!windowId) throw new Error('窗口创建失败');
      setDisplay(defaultDisplayPolicy());
      setSizeTick(0);
      setDisplayOpen(false);
      setActive({
        session,
        windowId,
        occupancyId: created.window.occupancyId || null,
      });
      setTakeover(null);
      setRouteMiss(false);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'WINDOW_OWNED') {
        setTakeover(session);
        return;
      }
      toast.error(err instanceof Error ? err.message : String(err));
      if (routeSessionId) setRouteMiss(true);
    } finally {
      openingLock.current = false;
      setBusy(false);
      setOpeningId(null);
    }
  };

  const pickSession = (session: Session) => {
    if (routeSessionId) {
      if (session.id !== routeSessionId) {
        startedRoute.current = null;
        nav(sessionDeskPath(session.id));
        return;
      }
      void openSession(session);
      return;
    }
    const win = openSessionDeskWindow(session.id);
    if (!win) toast.error('无法打开新窗口，请允许浏览器弹出窗口后重试');
    else win.focus();
  };

  useEffect(() => {
    if (!routeSessionId) {
      startedRoute.current = null;
      setRouteMiss(false);
      return;
    }
    if (!listReady || openingLock.current || busy || takeover) return;
    if (active?.session.id === routeSessionId) {
      startedRoute.current = routeSessionId;
      return;
    }
    if (startedRoute.current === routeSessionId) return;
    const session = sessions.find((s) => s.id === routeSessionId);
    if (!session) {
      startedRoute.current = routeSessionId;
      setRouteMiss(true);
      toast.error('找不到该会话或没有权限');
      return;
    }
    startedRoute.current = routeSessionId;
    void openSession(session);
  }, [routeSessionId, listReady, sessions, active, busy, takeover]);

  const closeActive = async () => {
    const cur = active;
    setActive(null);
    setClipOpen(false);
    setFilesOpen(false);
    setNotepadOpen(false);
    setDisplayOpen(false);
    setTabTitle('');
    if (cur?.session.id && cur.windowId) {
      await api.closeWindow(cur.session.id, cur.windowId).catch(() => undefined);
    }
    exitSessionWindow();
  };

  const leaveActive = () => {
    setActive(null);
    setClipOpen(false);
    setFilesOpen(false);
    setNotepadOpen(false);
    setDisplayOpen(false);
    setTabTitle('');
    exitSessionWindow();
  };

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-background">
      {active ? (
        <DeskStage
          session={active.session}
          windowId={active.windowId}
          occupancyId={active.occupancyId}
          busy={busy}
          display={display}
          sizeTick={sizeTick}
          onPaneChange={onPaneChange}
          onRemoteClipboard={() => {
            void clip.flushRemote().catch(() => undefined);
          }}
          onVncFocus={() => {
            void clip.flushLocal();
          }}
        />
      ) : routeSessionId && !takeover && !routeMiss ? (
        <div className="flex h-full flex-col items-center justify-center gap-2">
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
          <div className="text-sm font-medium">
            正在打开{openingId ? `「${sessions.find((s) => s.id === openingId)?.name || ''}」` : '会话'}
          </div>
          <p className="text-xs text-muted-foreground">请稍候，启动可能需要一些时间</p>
        </div>
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
              onPick={pickSession}
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
        canNotepad={Boolean(active?.session.canNotepad)}
        sessionName={active?.session.name}
        sizeLabel={active ? formatSize(remote) : undefined}
        onAdmin={() => nav('/admin/sessions')}
        onLogout={() => {
          void api.logout().then(() => window.location.reload());
        }}
        onNotepad={() => {
          if (!active) {
            toast.warning('请先打开一个会话');
            return;
          }
          setNotepadOpen(true);
        }}
        onDisplay={() => {
          if (!active) {
            toast.warning('请先打开一个会话');
            return;
          }
          setDisplayOpen(true);
        }}
        onEnd={() => {
          if (!active) {
            toast.warning('请先打开一个会话');
            return;
          }
          void closeActive();
        }}
        onLeave={() => {
          if (!active) {
            toast.warning('请先打开一个会话');
            return;
          }
          leaveActive();
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

      {active && notepadOpen ? (
        <NotepadPanel
          sessionId={active.session.id}
          sessionName={active.session.name}
          onClose={() => setNotepadOpen(false)}
        />
      ) : null}

      {active && displayOpen ? (
        <DeskFloat
          title="显示设置"
          subtitle={`${active.session.name} · ${formatSize(remote)}`}
          onClose={() => setDisplayOpen(false)}
          className="right-3 top-16"
          bodyClassName="max-h-[min(28rem,70vh)] overflow-auto"
        >
          <DisplaySettings
            policy={display}
            pane={pane}
            onChange={(next) => {
              setDisplay(next);
              setSizeTick((n) => n + 1);
            }}
          />
        </DeskFloat>
      ) : null}

      {active && clipOpen ? (
        <DeskFloat
          title="剪贴板"
          subtitle={active.session.name}
          onClose={() => setClipOpen(false)}
          className="right-3 bottom-16"
        >
          <ClipboardPanel
            text={clip.text}
            onTextChange={clip.onTextChange}
            auto={clip.auto}
            onAutoChange={clip.setAuto}
            ready={Boolean(active.windowId)}
            busy={clip.busy}
            permission={clip.permission}
            status={clip.status}
            onPull={clip.pull}
            onPush={clip.push}
            onRequestPermission={clip.requestPermission}
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
