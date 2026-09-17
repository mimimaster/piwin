import type { DockBadge } from './desktop-attention-os';

function uniqueSorted(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort();
}

export function selectAttentionSessionIds(input: {
  completedAttentionSessionIds: Readonly<Record<string, true>>;
  failedAttentionSessionIds: Readonly<Record<string, true>>;
  permissionQueue: ReadonlyArray<{ sessionId: string }>;
  questionSessionId: string | null;
}): string[] {
  const ids = [
    ...Object.keys(input.completedAttentionSessionIds),
    ...Object.keys(input.failedAttentionSessionIds),
    ...input.permissionQueue.map((item) => item.sessionId),
  ];
  if (input.questionSessionId !== null) {
    ids.push(input.questionSessionId);
  }
  return uniqueSorted(ids);
}

export function formatDockBadge(count: number): DockBadge {
  if (count >= 100) {
    return { kind: 'label', value: '99+' };
  }
  if (count >= 1) {
    return { kind: 'count', value: count };
  }
  return { kind: 'clear' };
}
