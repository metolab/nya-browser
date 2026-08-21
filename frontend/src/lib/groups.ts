import type { Session, SessionGroup } from '@nya/shared';

export const ALL_KEY = '__all__';
export const NONE_KEY = '__none__';

export function groupLabel(groups: SessionGroup[], id: string) {
  const parts: string[] = [];
  let current: string | null = id;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const g = groups.find((x) => x.id === current);
    if (!g) break;
    parts.unshift(g.name);
    current = g.parentId;
  }
  return parts.join(' / ');
}

export function groupPath(groups: SessionGroup[], id: string | null) {
  if (!id) return '未归类';
  return groupLabel(groups, id) || '未归类';
}

export function groupSelectOptions(groups: SessionGroup[]) {
  return [...groups]
    .sort((a, b) => groupLabel(groups, a.id).localeCompare(groupLabel(groups, b.id), 'zh'))
    .map((g) => ({ value: g.id, label: groupLabel(groups, g.id) }));
}

export function subtreeIds(groups: SessionGroup[], id: string): Set<string> {
  const ids = new Set<string>([id]);
  const walk = (parent: string) => {
    for (const g of groups) {
      if (g.parentId === parent) {
        ids.add(g.id);
        walk(g.id);
      }
    }
  };
  walk(id);
  return ids;
}

export function groupSessionCount(groups: SessionGroup[], sessions: Session[], groupId: string) {
  const ids = subtreeIds(groups, groupId);
  return sessions.filter((s) => s.groupId && ids.has(s.groupId)).length;
}

export function filterSessionsByGroup(
  sessions: Session[],
  groups: SessionGroup[],
  key: string,
): Session[] {
  if (key === ALL_KEY) return sessions;
  if (key === NONE_KEY) return sessions.filter((s) => !s.groupId);
  const ids = subtreeIds(groups, key);
  return sessions.filter((s) => s.groupId && ids.has(s.groupId));
}

export function groupTitle(groups: SessionGroup[], key: string) {
  if (key === ALL_KEY) return '全部会话';
  if (key === NONE_KEY) return '未归类';
  return groups.find((g) => g.id === key)?.name || '会话';
}

export function childrenOf(groups: SessionGroup[], parentId: string | null) {
  return groups.filter((g) => g.parentId === parentId);
}
