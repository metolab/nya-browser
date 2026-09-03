import { useEffect, useMemo, useState } from 'react';
import {
  ChevronRightIcon,
  DownloadIcon,
  FolderIcon,
  FolderPlusIcon,
  InboxIcon,
  KeyRoundIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  ShieldIcon,
  Trash2Icon,
} from 'lucide-react';
import type { Session, SessionGroup } from '@nya/shared';
import { childrenOf, groupSelectOptions, groupSessionCount } from '@/lib/groups';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export type SessionTreeProps = {
  groups: SessionGroup[];
  sessions: Session[];
  query?: string;
  onQueryChange?: (query: string) => void;
  mode: 'pick' | 'manage';
  onPick?: (session: Session) => void;
  onEditSession?: (session: Session) => void;
  onDeleteSession?: (session: Session) => void;
  onAssignSession?: (session: Session) => void;
  onViewPasswords?: (session: Session) => void;
  onExportSession?: (session: Session) => void;
  onMoveSession?: (sessionId: string, groupId: string | null) => void;
  onCreateSession?: (groupId: string | null) => void;
  onCreateFolder?: (parentId: string | null) => void;
  onEditFolder?: (group: SessionGroup) => void;
  onDeleteFolder?: (group: SessionGroup) => void;
  onAssignFolder?: (group: SessionGroup) => void;
  className?: string;
  disabled?: boolean;
  openingId?: string | null;
};

const INDENT = { pick: 12, manage: 18 } as const;

function matchesQuery(session: Session, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    session.name.toLowerCase().includes(q) ||
    (session.description || '').toLowerCase().includes(q) ||
    (session.homeUrl || '').toLowerCase().includes(q)
  );
}

function proxyText(session: Session) {
  const p = session.proxy;
  if (!p || p.type === 'none') return '直连';
  return `${p.type}://${p.host}:${p.port}`;
}

function indentStyle(mode: 'pick' | 'manage', depth: number) {
  return { paddingLeft: 8 + depth * INDENT[mode] };
}

function SessionActions({
  session,
  groups,
  onEditSession,
  onDeleteSession,
  onAssignSession,
  onViewPasswords,
  onExportSession,
  onMoveSession,
}: {
  session: Session;
  groups: SessionGroup[];
} & Pick<
  SessionTreeProps,
  | 'onEditSession'
  | 'onDeleteSession'
  | 'onAssignSession'
  | 'onViewPasswords'
  | 'onExportSession'
  | 'onMoveSession'
>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" onClick={(e) => e.stopPropagation()}>
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onSelect={() => onEditSession?.(session)}>
          <PencilIcon />
          编辑
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>移动到目录</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 min-w-44 overflow-auto">
            <DropdownMenuItem onSelect={() => onMoveSession?.(session.id, null)}>未归类</DropdownMenuItem>
            {groupSelectOptions(groups).map((opt) => (
              <DropdownMenuItem key={opt.value} onSelect={() => onMoveSession?.(session.id, opt.value)}>
                {opt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={() => onAssignSession?.(session)}>
          <ShieldIcon />
          权限
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onViewPasswords?.(session)}>
          <KeyRoundIcon />
          密码
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onExportSession?.(session)}>
          <DownloadIcon />
          导出
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onDeleteSession?.(session)}>
          <Trash2Icon />
          删除
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SessionRow({
  session,
  depth,
  mode,
  groups,
  onPick,
  disabled,
  openingId,
  ...actions
}: {
  session: Session;
  depth: number;
  mode: 'pick' | 'manage';
  groups: SessionGroup[];
} & Pick<
  SessionTreeProps,
  | 'onPick'
  | 'onEditSession'
  | 'onDeleteSession'
  | 'onAssignSession'
  | 'onViewPasswords'
  | 'onExportSession'
  | 'onMoveSession'
  | 'disabled'
  | 'openingId'
>) {
  const running = (session.runtime?.windows || []).length;
  if (mode === 'pick') {
    const opening = openingId === session.id;
    return (
      <button
        type="button"
        disabled={disabled || opening}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] hover:bg-muted disabled:pointer-events-none disabled:opacity-60',
          opening && 'bg-muted',
        )}
        style={indentStyle(mode, depth)}
        onClick={() => onPick?.(session)}
      >
        <span className="min-w-0 flex-1 truncate">{session.name}</span>
        {opening ? (
          <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : running > 0 ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">{running} 窗</span>
        ) : null}
      </button>
    );
  }

  return (
    <div
      className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_3.5rem_2rem] items-center gap-2 px-2 py-1.5 text-sm hover:bg-muted/70"
      style={indentStyle(mode, depth)}
    >
      <div className="min-w-0">
        <div className="truncate font-medium">{session.name}</div>
        {session.description ? (
          <div className="truncate text-xs text-muted-foreground">{session.description}</div>
        ) : null}
      </div>
      <div className="truncate text-xs text-muted-foreground">{proxyText(session)}</div>
      <div className="truncate text-xs text-muted-foreground">{session.homeUrl || '—'}</div>
      <div className="text-center tabular-nums text-xs text-muted-foreground">{running}</div>
      <div className="flex justify-end">
        <SessionActions session={session} groups={groups} {...actions} />
      </div>
    </div>
  );
}

function SessionList({
  items,
  depth,
  mode,
  groups,
  ...rest
}: {
  items: Session[];
  depth: number;
  mode: 'pick' | 'manage';
  groups: SessionGroup[];
} & Pick<
  SessionTreeProps,
  | 'onPick'
  | 'onEditSession'
  | 'onDeleteSession'
  | 'onAssignSession'
  | 'onViewPasswords'
  | 'onExportSession'
  | 'onMoveSession'
  | 'disabled'
  | 'openingId'
>) {
  return (
    <div>
      {items.map((session) => (
        <SessionRow key={session.id} session={session} depth={depth} mode={mode} groups={groups} {...rest} />
      ))}
    </div>
  );
}

function FolderNode({
  group,
  depth,
  groups,
  sessions,
  expanded,
  onToggle,
  ...rest
}: {
  group: SessionGroup;
  depth: number;
  groups: SessionGroup[];
  sessions: Session[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
} & Omit<SessionTreeProps, 'groups' | 'sessions' | 'query' | 'onQueryChange' | 'className'>) {
  const kids = childrenOf(groups, group.id);
  const direct = sessions.filter((s) => s.groupId === group.id);
  const open = expanded.has(group.id);
  const count = groupSessionCount(groups, sessions, group.id);
  const compact = rest.mode === 'pick';

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1.5 hover:bg-muted/60',
          compact ? 'rounded-md px-1 py-0.5' : 'border-b bg-muted/40 px-1 py-1.5',
        )}
        style={indentStyle(rest.mode, depth)}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => onToggle(group.id)}
        >
          <ChevronRightIcon className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className={cn('min-w-0 flex-1 truncate', compact ? 'text-[13px]' : 'text-sm font-medium')}>
            {group.name}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{count}</span>
        </button>
        {rest.mode === 'manage' ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs">
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuItem onSelect={() => rest.onCreateSession?.(group.id)}>
                <PlusIcon />
                新建会话
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => rest.onCreateFolder?.(group.id)}>
                <FolderPlusIcon />
                新建子目录
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => rest.onEditFolder?.(group)}>
                <PencilIcon />
                重命名
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => rest.onAssignFolder?.(group)}>
                <ShieldIcon />
                分配权限
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => rest.onDeleteFolder?.(group)}>
                <Trash2Icon />
                删除目录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {open ? (
        <>
          {kids.map((child) => (
            <FolderNode
              key={child.id}
              {...rest}
              group={child}
              depth={depth + 1}
              groups={groups}
              sessions={sessions}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
          <SessionList
            items={direct}
            depth={depth + 1}
            mode={rest.mode}
            groups={groups}
            onPick={rest.onPick}
            onEditSession={rest.onEditSession}
            onDeleteSession={rest.onDeleteSession}
            onAssignSession={rest.onAssignSession}
            onViewPasswords={rest.onViewPasswords}
            onExportSession={rest.onExportSession}
            onMoveSession={rest.onMoveSession}
            disabled={rest.disabled}
            openingId={rest.openingId}
          />
        </>
      ) : null}
    </div>
  );
}

export function SessionTree(props: SessionTreeProps) {
  const {
    groups,
    sessions,
    query = '',
    onQueryChange,
    mode,
    onCreateFolder,
    onCreateSession,
    className,
  } = props;
  const filtered = useMemo(() => sessions.filter((s) => matchesQuery(s, query)), [sessions, query]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    setExpanded(new Set(groups.map((g) => g.id)));
  }, [groups]);

  const roots = childrenOf(groups, null);
  const loose = filtered.filter((s) => !s.groupId);
  const compact = mode === 'pick';

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const treeActions = {
    mode,
    onPick: props.onPick,
    onEditSession: props.onEditSession,
    onDeleteSession: props.onDeleteSession,
    onAssignSession: props.onAssignSession,
    onViewPasswords: props.onViewPasswords,
    onExportSession: props.onExportSession,
    onMoveSession: props.onMoveSession,
    onCreateSession: props.onCreateSession,
    onCreateFolder: props.onCreateFolder,
    onEditFolder: props.onEditFolder,
    onDeleteFolder: props.onDeleteFolder,
    onAssignFolder: props.onAssignFolder,
    disabled: props.disabled,
    openingId: props.openingId,
  };

  return (
    <div className={cn('flex h-full min-h-0 flex-col', compact ? 'gap-2' : 'gap-3', className)}>
      <div className="flex shrink-0 items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            placeholder="搜索会话"
            className={cn('pl-8', compact && 'h-7 text-xs')}
            disabled={props.disabled}
            onChange={(e) => onQueryChange?.(e.target.value)}
          />
        </div>
        {mode === 'manage' ? (
          <>
            <Button variant="outline" size="sm" onClick={() => onCreateFolder?.(null)}>
              <FolderPlusIcon />
              目录
            </Button>
            <Button size="sm" onClick={() => onCreateSession?.(null)}>
              <PlusIcon />
              会话
            </Button>
          </>
        ) : null}
      </div>
      {mode === 'manage' ? (
        <div className="grid shrink-0 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_3.5rem_2rem] gap-2 border-b px-2 pb-1.5 text-xs text-muted-foreground">
          <div>名称</div>
          <div>代理</div>
          <div>首页</div>
          <div className="text-center">窗口</div>
          <div />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {roots
          .filter((group) => !query.trim() || groupSessionCount(groups, filtered, group.id) > 0)
          .map((group) => (
            <FolderNode
              key={group.id}
              {...treeActions}
              group={group}
              depth={0}
              groups={groups}
              sessions={filtered}
              expanded={expanded}
              onToggle={toggle}
            />
          ))}
        {loose.length || (mode === 'manage' && !query.trim()) ? (
          <div>
            <div
              className={cn(
                'flex items-center gap-1.5 text-muted-foreground',
                compact ? 'px-2 py-0.5 text-[13px]' : 'border-b bg-muted/40 px-2 py-1.5 text-sm font-medium',
              )}
            >
              <InboxIcon className="size-3.5" />
              未归类
              <span className="text-[11px] tabular-nums">{loose.length}</span>
            </div>
            <SessionList
              items={loose}
              depth={1}
              mode={mode}
              groups={groups}
              onPick={props.onPick}
              onEditSession={props.onEditSession}
              onDeleteSession={props.onDeleteSession}
              onAssignSession={props.onAssignSession}
              onViewPasswords={props.onViewPasswords}
              onExportSession={props.onExportSession}
              onMoveSession={props.onMoveSession}
              disabled={props.disabled}
              openingId={props.openingId}
            />
          </div>
        ) : null}
        {filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {query.trim() ? '没有匹配的会话' : '还没有可打开的会话'}
          </p>
        ) : null}
      </div>
    </div>
  );
}
