import type {
  ActivitySummaryItem,
  RemoteProjectSummary,
  RemoteSessionSummary,
} from '@piwin/contracts';
import type {
  MobileToolCall,
  MobileTranscriptMessage,
  RemotePermissionRequest,
} from '../../mobile-transcript.js';

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
export function cleanSessionPreview(value: string | undefined): string {
  if (value === undefined) {
    return '';
  }
  let cleaned = value;
  // Explicit Skill activation stores a model-facing wrapper in the durable
  // user message. Keep only the request section for shell-facing previews and
  // transcript bubbles; the wrapper remains available in the Host record.
  const skillRequest = cleaned.match(
    /^\s*\[piwin-skill:[^\]]+\][\s\S]*?\n(?:## User request|---)\s*\n([\s\S]*)$/i,
  );
  if (skillRequest?.[1] !== undefined) {
    cleaned = skillRequest[1];
  }
  const userSection = cleaned.match(/(?:^|\n)---\s*\n+\s*User:\s*\n?([\s\S]*)$/i);
  if (userSection?.[1] !== undefined) {
    cleaned = userSection[1];
  } else {
    const currentMessageSection = cleaned.match(/(?:^|\n)---\s*\n+\s*Current user message:\s*\n?([\s\S]*)$/i);
    if (currentMessageSection?.[1] !== undefined) {
      cleaned = currentMessageSection[1];
    }
  }
  return cleaned
    .replace(/\[piwin plan context v\d+[^\]]*\][\s\S]*?\[end plan context\]/gi, '')
    // Search/index previews are bounded and may omit the closing marker. A
    // plan-context prefix is transport metadata, never user-authored text;
    // drop the remainder rather than leaking it into a session row.
    .replace(/\[piwin plan context v\d+[^\]]*\][\s\S]*$/gi, '')
    .replace(/\[piwin-inline-artifact-layout\][\s\S]*?\[\/piwin-inline-artifact-layout\]/gi, '')
    // Older Host indexes truncated the preview before the closing tag.  Once
    // this marker appears, the rest of that bounded preview is transport-only
    // layout context, so do not surface it as if it were user text.
    .replace(/\[piwin-inline-artifact-layout\][\s\S]*$/gi, '')
    .replace(/<context_ref\b[^>]*>[\s\S]*?<\/context_ref>/gi, '')
    .replace(/<startup_context>[\s\S]*?<\/startup_context>/gi, '')
    .replace(/<side_chat_context\b[^>]*>[\s\S]*?<\/side_chat_context>/gi, '')
    .replace(/<walkthrough-context\b[^>]*>[\s\S]*?<\/walkthrough-context>/gi, '')
    .replace(/\[piwin-prompt-meta[^\]]*\][^\n]*/gi, '')
    .replace(/\[piwin-mode:[^\]]*\]/gi, '')
    .replace(/Operating contract for this turn:\s*[\s\S]*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
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
  if ((session.messageCount ?? 0) > 0) {
    return `${session.messageCount} 条消息`;
  }
  return '等待继续';
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

export interface InkstoneToolStep {
  label: string;
  meta: string;
  status: 'done' | 'running' | 'error';
}

function mapToolStep(tool: MobileToolCall): InkstoneToolStep {
  const target = tool.command ?? tool.summary ?? tool.targetPaths?.join(' ') ?? '';
  const label =
    tool.actionVerb !== undefined ? `${tool.actionVerb} ${target}`.trim() : target || tool.name;
  const meta =
    tool.status === 'running'
      ? '进行中'
      : tool.durationMs !== undefined
        ? `${Math.round(tool.durationMs / 100) / 10}s`
        : '';
  return { label, meta, status: tool.status === 'error' ? 'error' : tool.status };
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

export type InkstoneChatRow =
  | { kind: 'user'; id: string; text: string; attachments: string[]; time: string }
  | {
      kind: 'assistant';
      id: string;
      text: string;
      thinking?: string | undefined;
      streaming: boolean;
      model: string;
      time: string;
    }
  | { kind: 'tools'; id: string; label: string; steps: InkstoneToolStep[] };

/** Project the remote transcript onto the prototype's chat row grammar. */
export function mapTranscriptRows(messages: MobileTranscriptMessage[]): InkstoneChatRow[] {
  const rows: InkstoneChatRow[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      const attachments = (message.attachments ?? []).map((item) => item.name ?? '图片');
      const text = cleanSessionPreview(message.text);
      if (text.length === 0 && attachments.length === 0) {
        continue;
      }
      rows.push({
        kind: 'user',
        id: message.id,
        text,
        attachments,
        time: formatClock(message.createdAt),
      });
      continue;
    }
    if (message.role !== 'assistant') {
      continue;
    }
    if (message.toolCalls !== undefined && message.toolCalls.length > 0) {
      const running = message.toolCalls.some((tool) => tool.status === 'running');
      rows.push({
        kind: 'tools',
        id: `${message.id}:tools`,
        label: running ? '正在调用工具' : '已完成本轮工具调用',
        steps: message.toolCalls.map(mapToolStep),
      });
    }
    const hasText = message.text.trim().length > 0;
    const hasThinking = typeof message.thinking === 'string' && message.thinking.trim().length > 0;
    const isStreaming = message.status === 'streaming';
    if (hasText || hasThinking || isStreaming) {
      rows.push({
        kind: 'assistant',
        id: message.id,
        text: message.text,
        ...(message.thinking !== undefined ? { thinking: message.thinking } : {}),
        streaming: isStreaming,
        model: formatModelLabel(message.model?.modelId),
        time: formatClock(message.createdAt),
      });
    }
  }
  return rows;
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
