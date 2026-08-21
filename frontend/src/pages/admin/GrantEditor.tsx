import { CheckIcon } from 'lucide-react';
import type { Session, SessionGroup, UserPublic } from '@nya/shared';
import { cn } from '@/lib/utils';
import { childrenOf, groupPath } from '@/lib/groups';
import { ScrollArea } from '@/components/ui/scroll-area';

export function CheckRow({
  checked,
  label,
  hint,
  depth = 0,
  onToggle,
}: {
  checked: boolean;
  label: string;
  hint?: string;
  depth?: number;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={onToggle}
    >
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-sm border',
          checked
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-input bg-background',
        )}
      >
        {checked ? <CheckIcon className="size-3" /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? <span className="shrink-0 text-xs text-muted-foreground">{hint}</span> : null}
    </button>
  );
}

export function UserGrantList({
  users,
  selected,
  onChange,
}: {
  users: UserPublic[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  if (users.length === 0) {
    return <p className="px-2 py-6 text-center text-sm text-muted-foreground">还没有可分配的用户</p>;
  }
  return (
    <ScrollArea className="h-72 rounded-md border">
      <div className="p-1">
        {users.map((u) => (
          <CheckRow
            key={u.id}
            checked={selected.has(u.id)}
            label={u.username}
            hint={u.role === 'admin' ? '管理员' : undefined}
            onToggle={() => toggle(u.id)}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

function FolderGrantNode({
  group,
  depth,
  groups,
  selected,
  onToggle,
}: {
  group: SessionGroup;
  depth: number;
  groups: SessionGroup[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const kids = childrenOf(groups, group.id);
  return (
    <>
      <CheckRow
        checked={selected.has(group.id)}
        label={group.name}
        depth={depth}
        onToggle={() => onToggle(group.id)}
      />
      {kids.map((child) => (
        <FolderGrantNode
          key={child.id}
          group={child}
          depth={depth + 1}
          groups={groups}
          selected={selected}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}

export function ResourceGrantPicker({
  groups,
  sessions,
  folderIds,
  sessionIds,
  onFolderIds,
  onSessionIds,
}: {
  groups: SessionGroup[];
  sessions: Session[];
  folderIds: Set<string>;
  sessionIds: Set<string>;
  onFolderIds: (next: Set<string>) => void;
  onSessionIds: (next: Set<string>) => void;
}) {
  const toggle = (set: Set<string>, id: string, onChange: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <div>
          <div className="text-sm font-medium">目录权限</div>
          <p className="text-xs text-muted-foreground">
            授权后可使用该目录及子目录下的全部会话，包括之后新建的。
          </p>
        </div>
        <ScrollArea className="h-48 rounded-md border">
          <div className="p-1">
            {groups.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">还没有目录</p>
            ) : (
              childrenOf(groups, null).map((g) => (
                <FolderGrantNode
                  key={g.id}
                  group={g}
                  depth={0}
                  groups={groups}
                  selected={folderIds}
                  onToggle={(id) => toggle(folderIds, id, onFolderIds)}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </div>
      <div className="grid gap-2">
        <div>
          <div className="text-sm font-medium">单独会话</div>
          <p className="text-xs text-muted-foreground">只授权指定会话，不随目录变动。</p>
        </div>
        <ScrollArea className="h-48 rounded-md border">
          <div className="p-1">
            {sessions.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">还没有会话</p>
            ) : (
              sessions.map((s) => (
                <CheckRow
                  key={s.id}
                  checked={sessionIds.has(s.id)}
                  label={s.name}
                  hint={groupPath(groups, s.groupId)}
                  onToggle={() => toggle(sessionIds, s.id, onSessionIds)}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
