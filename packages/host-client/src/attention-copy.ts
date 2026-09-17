import type { AttentionKind, AttentionSource } from './attention-signal.js';

export type AttentionCopyLocale = 'zh-CN' | 'en';

export const ATTENTION_COPY_SEGMENT_MAX = 48;

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
  void input;
  throw new Error('AN-S4 not implemented');
}
