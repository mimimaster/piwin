import type { AttentionRaise } from './attention-signal.js';

export type AttentionPresence = 'active' | 'inactive';

export type AttentionPreferences = {
  enabled: boolean;
  onNeedsInput: boolean;
  onComplete: boolean;
  onFailure: boolean;
  foregroundToast: boolean;
  badge: boolean;
  sound: boolean;
  bounceOnNeedsInput: boolean;
};

export const DEFAULT_ATTENTION_PREFERENCES: AttentionPreferences = {
  enabled: true,
  onNeedsInput: true,
  onComplete: true,
  onFailure: true,
  foregroundToast: true,
  badge: true,
  sound: true,
  bounceOnNeedsInput: true,
};

export type AttentionContext = {
  presence: AttentionPresence;
  visibleSessionIds: ReadonlySet<string>;
  activeSessionId: string | null;
  catchingUp: boolean;
  preferences: AttentionPreferences;
  alreadyNotified: boolean;
  now: number;
};

export type AttentionDelivery = 'none' | 'in-app' | 'system' | 'catch-up-summary';

export type AttentionDecision = {
  seen: boolean;
  delivery: AttentionDelivery;
  bounce: boolean;
};

export const ATTENTION_STALE_TERMINAL_MS = 900_000;

export function isAttentionSessionSeen(
  sessionId: string,
  context: Pick<AttentionContext, 'presence' | 'visibleSessionIds' | 'activeSessionId'>,
): boolean {
  void sessionId;
  void context;
  throw new Error('AN-S2 not implemented');
}

export function decideAttention(signal: AttentionRaise, context: AttentionContext): AttentionDecision {
  void signal;
  void context;
  throw new Error('AN-S2 not implemented');
}
