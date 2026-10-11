import type { RemoteProjectSummary, RemoteSessionSummary } from '@piwin/contracts';

/**
 * Session rows for the TUI picker: the same Host session index Desktop's
 * sidebar reads, reduced to what one terminal line can show.
 */
export type SessionRow = {
  sessionId: string;
  title: string;
  /** Project display name, or the general workspace label. */
  scopeLabel: string;
  /** `projectId`, or `general` for a non-project session. */
  projectKey: string;
  updatedLabel: string;
  /** ISO timestamp used to bucket the row; empty when the Host omitted it. */
  updatedAt: string;
  messageCount: number;
  pinned: boolean;
  archived: boolean;
  /** Non-Pi backend id (e.g. `grok`) when the session runs on an external agent. */
  agentId?: string;
  /** Text the fuzzy filter matches against. */
  searchText: string;
};

/** Project-filter key that keeps every loaded row. */
export const SESSION_FILTER_ALL = 'all';
/** Project-filter key for sessions that are not in a project. */
export const SESSION_FILTER_GENERAL = 'general';

export type SessionGroupId = 'pinned' | 'today' | 'earlier' | 'archived';

export type SessionGroup = {
  id: SessionGroupId;
  label: string;
  rows: SessionRow[];
};

export type SessionListEntry =
  | { kind: 'header'; id: SessionGroupId; label: string; count: number; collapsed: boolean }
  | { kind: 'row'; row: SessionRow };

export type SessionRowFilter = {
  /** Case-insensitive substring. The picker uses fuzzy match on top of the project filter. */
  query?: string;
  /** `all`, `general`, or a project id. Omitted means all. */
  projectKey?: string;
};

export type ProjectFilterOption = {
  key: string;
  label: string;
};

const GENERAL_LABEL = '对话';
const UNTITLED = '未命名会话';

const GROUP_ORDER: readonly SessionGroupId[] = ['pinned', 'today', 'earlier', 'archived'];

const GROUP_LABELS: Record<SessionGroupId, string> = {
  pinned: '置顶',
  today: '今天',
  earlier: '更早',
  archived: '已归档',
};

export function buildSessionRows(
  sessions: readonly RemoteSessionSummary[],
  projects: readonly RemoteProjectSummary[],
  now: Date,
): SessionRow[] {
  const projectNames = new Map(projects.map((project) => [project.projectId, project.displayName]));
  return sessions
    .filter((session) => session.kind === undefined || session.kind === 'main')
    .map((session) => {
      const title = session.name?.trim() || session.lastPreview?.trim() || UNTITLED;
      const projectKey = projectKeyOf(session);
      const scopeLabel =
        projectKey === SESSION_FILTER_GENERAL
          ? GENERAL_LABEL
          : (projectNames.get(projectKey) ?? '项目');
      const agentId = session.backend?.agentId;
      const row: SessionRow = {
        sessionId: session.sessionId,
        title: title.replace(/\s+/g, ' '),
        scopeLabel,
        projectKey,
        updatedLabel: formatRelativeTime(session.updatedAt, now),
        updatedAt: session.updatedAt ?? '',
        messageCount: session.messageCount ?? 0,
        pinned: session.pinned === true,
        archived: session.archived === true,
        searchText: `${title} ${scopeLabel} ${session.lastPreview ?? ''}`,
      };
      if (agentId !== undefined && agentId !== 'pi') row.agentId = agentId;
      return row;
    })
    .sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return right.updatedAt.localeCompare(left.updatedAt);
    });
}

/**
 * Bucket active rows into 置顶 / 今天 / 更早. Archived rows, even pinned ones,
 * stay in 已归档 only. Empty groups are omitted. Within a group, newest first.
 */
export function groupSessionRows(rows: readonly SessionRow[], now: Date): SessionGroup[] {
  const buckets: Record<SessionGroupId, SessionRow[]> = {
    pinned: [],
    today: [],
    earlier: [],
    archived: [],
  };
  for (const row of rows) buckets[sessionGroupId(row, now)].push(row);
  return GROUP_ORDER.filter((id) => buckets[id].length > 0).map((id) => ({
    id,
    label: GROUP_LABELS[id],
    rows: buckets[id].slice().sort(byRecency),
  }));
}

/** Keep rows for one project (or all) and, optionally, a title substring. */
export function filterSessionRows(
  rows: readonly SessionRow[],
  filter: SessionRowFilter = {},
): SessionRow[] {
  const projectKey = filter.projectKey;
  const query = filter.query?.trim().toLowerCase() ?? '';
  const projectAll = projectKey === undefined || projectKey === SESSION_FILTER_ALL;
  if (projectAll && query.length === 0) return [...rows];
  return rows.filter((row) => {
    if (!projectAll && row.projectKey !== projectKey) return false;
    if (query.length === 0) return true;
    return row.title.toLowerCase().includes(query) || row.searchText.toLowerCase().includes(query);
  });
}

/** `全部`, then general if present, then each project that appears in the rows. */
export function listProjectFilterOptions(
  rows: readonly SessionRow[],
  projects: readonly RemoteProjectSummary[] = [],
): ProjectFilterOption[] {
  const names = new Map(projects.map((project) => [project.projectId, project.displayName]));
  const options: ProjectFilterOption[] = [{ key: SESSION_FILTER_ALL, label: '全部' }];
  if (rows.some((row) => row.projectKey === SESSION_FILTER_GENERAL)) {
    options.push({ key: SESSION_FILTER_GENERAL, label: GENERAL_LABEL });
  }
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.projectKey === SESSION_FILTER_GENERAL || seen.has(row.projectKey)) continue;
    seen.add(row.projectKey);
    options.push({ key: row.projectKey, label: names.get(row.projectKey) ?? row.scopeLabel });
  }
  return options;
}

/** Headers plus rows. The archived group is a header only until expanded. */
export function flattenSessionGroups(
  groups: readonly SessionGroup[],
  archivedExpanded: boolean,
): SessionListEntry[] {
  const entries: SessionListEntry[] = [];
  for (const group of groups) {
    const collapsed = group.id === 'archived' && !archivedExpanded;
    entries.push({
      kind: 'header',
      id: group.id,
      label: group.label,
      count: group.rows.length,
      collapsed,
    });
    if (collapsed) continue;
    for (const row of group.rows) entries.push({ kind: 'row', row });
  }
  return entries;
}

export function formatRelativeTime(iso: string | undefined, now: Date): string {
  if (iso === undefined) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor((now.getTime() - then) / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return iso.slice(0, 10);
}

function projectKeyOf(session: RemoteSessionSummary): string {
  if (
    session.scope === 'project' &&
    session.projectId !== undefined &&
    session.projectId.length > 0
  ) {
    return session.projectId;
  }
  return SESSION_FILTER_GENERAL;
}

function sessionGroupId(row: SessionRow, now: Date): SessionGroupId {
  if (row.archived) return 'archived';
  if (row.pinned) return 'pinned';
  return isTodayOrNewer(row.updatedAt, now) ? 'today' : 'earlier';
}

/** Local calendar day. A missing or future stamp is not "earlier". */
function isTodayOrNewer(iso: string, now: Date): boolean {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return false;
  const thenDay = then.getFullYear() * 10000 + then.getMonth() * 100 + then.getDate();
  const nowDay = now.getFullYear() * 10000 + now.getMonth() * 100 + now.getDate();
  return thenDay >= nowDay;
}

function byRecency(left: SessionRow, right: SessionRow): number {
  const leftTime = Date.parse(left.updatedAt);
  const rightTime = Date.parse(right.updatedAt);
  const leftSafe = Number.isNaN(leftTime) ? Number.NEGATIVE_INFINITY : leftTime;
  const rightSafe = Number.isNaN(rightTime) ? Number.NEGATIVE_INFINITY : rightTime;
  if (leftSafe !== rightSafe) return rightSafe - leftSafe;
  return left.title.localeCompare(right.title);
}
