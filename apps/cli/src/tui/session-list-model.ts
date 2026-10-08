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
  updatedLabel: string;
  messageCount: number;
  pinned: boolean;
  archived: boolean;
  /** Non-Pi backend id (e.g. `grok`) when the session runs on an external agent. */
  agentId?: string;
  /** Text the fuzzy filter matches against. */
  searchText: string;
};

const GENERAL_LABEL = '对话';
const UNTITLED = '未命名会话';

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
      const scopeLabel =
        session.scope === 'project'
          ? ((session.projectId === undefined ? undefined : projectNames.get(session.projectId)) ?? '项目')
          : GENERAL_LABEL;
      const agentId = session.backend?.agentId;
      const row: SessionRow = {
        sessionId: session.sessionId,
        title: title.replace(/\s+/g, ' '),
        scopeLabel,
        updatedLabel: formatRelativeTime(session.updatedAt, now),
        messageCount: session.messageCount ?? 0,
        pinned: session.pinned === true,
        archived: session.archived === true,
        searchText: `${title} ${scopeLabel} ${session.lastPreview ?? ''}`,
      };
      if (agentId !== undefined && agentId !== 'pi') row.agentId = agentId;
      return { row, updatedAt: session.updatedAt ?? '' };
    })
    .sort((left, right) => {
      if (left.row.pinned !== right.row.pinned) return left.row.pinned ? -1 : 1;
      return right.updatedAt.localeCompare(left.updatedAt);
    })
    .map((item) => item.row);
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
