import type { AttentionKind, AttentionSource } from './attention-signal.js';

export type AttentionCopyLocale = 'zh-CN' | 'en';

export const ATTENTION_COPY_SEGMENT_MAX = 48;

const ELLIPSIS = '…';
const SEGMENT_SEP = ' · ';

function truncateSegment(value: string): string {
  if (value.length <= ATTENTION_COPY_SEGMENT_MAX) return value;
  return `${value.slice(0, ATTENTION_COPY_SEGMENT_MAX - ELLIPSIS.length)}${ELLIPSIS}`;
}

function isPresent(value: string | undefined): value is string {
  return value != null && value.trim() !== '';
}

function projectSegment(projectName: string | undefined): string | undefined {
  if (!isPresent(projectName) || projectName === 'General') return undefined;
  return truncateSegment(projectName);
}

function sessionSegment(locale: AttentionCopyLocale, sessionTitle: string | undefined): string {
  const raw = isPresent(sessionTitle)
    ? sessionTitle
    : locale === 'en'
      ? 'Untitled session'
      : '未命名会话';
  return truncateSegment(raw);
}

function actionSegment(permissionAction: string | undefined): string | undefined {
  if (!isPresent(permissionAction)) return undefined;
  return truncateSegment(permissionAction);
}

function joinSegments(parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(SEGMENT_SEP);
}

function formatTitle(input: {
  locale: AttentionCopyLocale;
  kind: AttentionKind | 'summary';
  source?: AttentionSource;
  count: number;
}): string {
  const { locale, kind, source, count } = input;
  const en = locale === 'en';
  if (kind === 'summary') {
    if (en) return count === 1 ? '1 session needs you' : `${count} sessions need you`;
    return `${count} 个会话需要你`;
  }
  if (kind === 'turn-complete') return en ? 'Finished' : '已完成';
  if (kind === 'turn-failed') return en ? 'Run failed' : '运行失败';
  if (source === 'permission') return en ? 'Approval needed' : '需要你的批准';
  return en ? 'Agent is asking' : 'Agent 在等你回答';
}

export function formatAttentionNotification(input: {
  locale: AttentionCopyLocale;
  kind: AttentionKind | 'summary';
  source?: AttentionSource;
  projectName?: string;
  sessionTitle?: string;
  permissionAction?: string;
  count?: number;
  needsInputCount?: number;
}): { title: string; body: string } {
  const locale = input.locale;
  const count = input.count ?? 0;
  const needsInputCount = input.needsInputCount ?? 0;
  const title = formatTitle({
    locale,
    kind: input.kind,
    count,
    ...(input.source !== undefined ? { source: input.source } : {}),
  });

  if (input.kind === 'summary') {
    if (needsInputCount <= 0) return { title, body: '' };
    const body =
      locale === 'en' ? `${needsInputCount} waiting for approval` : `有 ${needsInputCount} 个等待批准`;
    return { title, body };
  }

  const body = joinSegments([
    projectSegment(input.projectName),
    sessionSegment(locale, input.sessionTitle),
    actionSegment(input.permissionAction),
  ]);
  return { title, body };
}
