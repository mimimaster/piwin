import type { DockBadge } from './desktop-attention-os';

export function selectAttentionSessionIds(input: {
  completedAttentionSessionIds: Readonly<Record<string, true>>;
  failedAttentionSessionIds: Readonly<Record<string, true>>;
  permissionQueue: ReadonlyArray<{ sessionId: string }>;
  questionSessionId: string | null;
}): string[] {
  void input;
  throw new Error('AN-R2 not implemented');
}

export function formatDockBadge(count: number): DockBadge {
  void count;
  throw new Error('AN-R2 not implemented');
}
