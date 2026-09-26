import { extractUserFacingBody } from '@piwin/contracts';
import type {
  ActivitySummaryItem,
  RemoteProjectSummary,
  RemoteSessionSummary,
} from '@piwin/contracts';
import type { RemotePermissionRequest } from '../../mobile-transcript.js';

export type InkstoneDotStatus = 'running' | 'done' | 'waiting';

/** Session row for the Inkstone session tree; mirrors the prototype's row grammar. */
export interface InkstoneSessionRow {
  sessionId: string;
  title: string;
  subtitle: string;
  status: InkstoneDotStatus;
  time: string;
  pinned: boolean;
}

export interface InkstoneProjectGroup {
  projectId: string | undefined;
  project: string;
  rows: InkstoneSessionRow[];
}

/** HH:MM clock label for message heads. */
export function formatClock(iso: string | undefined): string {
  if (iso === undefined) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** Compact relative label matching the prototype's session list wording. */
export function relativeTime(updatedAt: string | undefined, now: number): string {
  if (updatedAt === undefined) {
    return '';
  }
  const then = new Date(updatedAt).getTime();
  if (Number.isNaN(then)) {
    return '';
  }
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 1) {
    return '刚刚';
  }
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} 小时`;
  }
  const days = Math.round(hours / 24);
  if (days === 1) {
    return '昨天';
  }
  const date = new Date(then);
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

/**
 * Session previews and user transcript bubbles can contain model-facing text
 * in older Host indexes. Strip transport-only context/layout envelopes before
 * showing them in a shell; the raw Host transcript remains available for
 * forwarding/copying outside this display projection.
 */
/** One-line, shell-facing text for a user row or session preview (see contracts). */
export function cleanSessionPreview(value: string | undefined): string {
  if (value === undefined) {
    return '';
  }
  return extractUserFacingBody(value).replace(/\s+/g, ' ').trim();
}

function projectDisplayName(
  projects: RemoteProjectSummary[],
  projectId: string | undefined,
): string {
  if (projectId === undefined) {
    return '一般会话';
  }
  return projects.find((project) => project.projectId === projectId)?.displayName ?? '一般会话';
}

function sessionSubtitle(
  session: RemoteSessionSummary,
  running: boolean,
  pendingPermission: boolean,
): string {
  if (pendingPermission) {
    return '等你批准 1 项操作';
  }
  if (running) {
    return '正在工作';
  }
  const preview = cleanSessionPreview(session.lastPreview);
  if (preview !== undefined && preview.length > 0) {
    return preview.length > 42 ? `${preview.slice(0, 42)}…` : preview;
  }
  // "3 条消息" or "等待继续" tells the reader nothing the title does not.
  return '';
}

export function mapSessionGroups(args: {
  sessions: RemoteSessionSummary[];
  projects: RemoteProjectSummary[];
  runningSessionIds: ReadonlySet<string>;
  pendingPermissionSessionIds: ReadonlySet<string>;
  now: number;
}): InkstoneProjectGroup[] {
  const groups = new Map<string, InkstoneProjectGroup>();
  for (const session of args.sessions) {
    if (session.archived === true) {
      continue;
    }
    const key = session.projectId ?? '__general__';
    let group = groups.get(key);
    if (group === undefined) {
      group = {
        projectId: session.projectId,
        project: projectDisplayName(args.projects, session.projectId),
        rows: [],
      };
      groups.set(key, group);
    }
    const running = args.runningSessionIds.has(session.sessionId);
    const pendingPermission = args.pendingPermissionSessionIds.has(session.sessionId);
    group.rows.push({
      sessionId: session.sessionId,
      title: session.name?.trim() || '未命名会话',
      subtitle: sessionSubtitle(session, running, pendingPermission),
      status: pendingPermission ? 'waiting' : running ? 'running' : 'done',
      time: relativeTime(session.updatedAt, args.now),
      pinned: session.pinned === true,
    });
  }
  const list = [...groups.values()];
  for (const group of list) {
    group.rows.sort((left, right) => Number(right.pinned) - Number(left.pinned));
  }
  return list;
}

/** The continue card: the running session if any, else the most recent one. */
export function pickContinueSession(
  sessions: RemoteSessionSummary[],
  runningSessionIds: ReadonlySet<string>,
): RemoteSessionSummary | undefined {
  const visible = sessions.filter((session) => session.archived !== true);
  return visible.find((session) => runningSessionIds.has(session.sessionId)) ?? visible[0];
}

/** Clean human-readable model label for message heads. */
export function formatModelLabel(modelId: string | undefined): string {
  if (!modelId || modelId === 'assistant' || modelId === 'piwin') {
    return 'piwin';
  }
  const clean = modelId.trim();
  const lower = clean.toLowerCase();
  if (lower.startsWith('claude') || lower.includes('sonnet') || lower.includes('haiku') || lower.includes('opus')) {
    if (lower.includes('3-5') || lower.includes('3.5')) return 'Claude 3.5 Sonnet';
    if (lower.includes('3-7') || lower.includes('3.7')) return 'Claude 3.7 Sonnet';
    if (lower.includes('haiku')) return 'Claude Haiku';
    if (lower.includes('opus')) return 'Claude Opus';
    return 'Claude Sonnet';
  }
  if (lower.includes('gpt-4o-mini')) return 'GPT-4o mini';
  if (lower.includes('gpt-4o')) return 'GPT-4o';
  if (lower.includes('gpt-4')) return 'GPT-4';
  if (lower.includes('gpt-5') || lower.includes('codex')) return 'GPT-5 Codex';
  if (lower.startsWith('o1')) return 'o1';
  if (lower.startsWith('o3')) return 'o3';
  if (lower.startsWith('grok')) {
    const match = lower.match(/grok[-_.]?(\d+(?:[.-]\d+)?)/);
    if (match?.[1]) {
      return `Grok ${match[1].replace('-', '.')}`;
    }
    return 'Grok';
  }
  if (lower.startsWith('deepseek')) {
    if (lower.includes('r1') || lower.includes('reasoner')) return 'DeepSeek R1';
    return 'DeepSeek V3';
  }
  if (lower.startsWith('gemini')) {
    if (lower.includes('flash')) return 'Gemini Flash';
    if (lower.includes('pro')) return 'Gemini Pro';
    return 'Gemini';
  }
  return clean;
}

export interface InkstonePermissionGateView {
  requestId: string;
  title: string;
  detail: string;
  command?: string | undefined;
  cwd?: string | undefined;
  destructive: boolean;
}

export function mapPermissionGate(
  request: RemotePermissionRequest | undefined,
): InkstonePermissionGateView | undefined {
  if (request === undefined) {
    return undefined;
  }
  return {
    requestId: request.requestId,
    title: request.context?.summary ?? request.action,
    detail: request.detail,
    command: request.context?.command,
    cwd: request.context?.cwd,
    destructive: request.context?.destructive === true,
  };
}

export interface InkstoneActivityRow {
  sessionId: string;
  title: string;
  subtitle: string;
  status: InkstoneDotStatus;
}

export function mapActivityRows(args: {
  items: ActivitySummaryItem[];
  sessions: RemoteSessionSummary[];
  projects: RemoteProjectSummary[];
}): { pending: InkstoneActivityRow[]; running: InkstoneActivityRow[] } {
  const title = (sessionId: string): string =>
    args.sessions.find((session) => session.sessionId === sessionId)?.name?.trim() || '未命名会话';
  const pending: InkstoneActivityRow[] = [];
  const running: InkstoneActivityRow[] = [];
  for (const item of args.items) {
    const row: InkstoneActivityRow = {
      sessionId: item.sessionId,
      title: title(item.sessionId),
      subtitle: item.pendingPermission ? '等待批准 · 点按前往' : '进行中 · 点按前往',
      status: item.pendingPermission ? 'waiting' : 'running',
    };
    if (item.pendingPermission) {
      pending.push(row);
    } else {
      running.push(row);
    }
  }
  return { pending, running };
}

export function collectRunningSessionIds(items: ActivitySummaryItem[]): Set<string> {
  return new Set(items.filter((item) => !item.pendingPermission).map((item) => item.sessionId));
}

export function collectPendingPermissionSessionIds(items: ActivitySummaryItem[]): Set<string> {
  return new Set(items.filter((item) => item.pendingPermission).map((item) => item.sessionId));
}
