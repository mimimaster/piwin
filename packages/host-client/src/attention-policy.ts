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
  conversationCovered: boolean;
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
  context: Pick<
    AttentionContext,
    'presence' | 'visibleSessionIds' | 'activeSessionId' | 'conversationCovered'
  >,
): boolean {
  if (context.presence !== 'active') {
    return false;
  }
  if (context.conversationCovered) {
    return false;
  }
  if (context.visibleSessionIds.has(sessionId)) {
    return true;
  }
  return context.visibleSessionIds.size === 0 && sessionId === context.activeSessionId;
}

export function decideAttention(signal: AttentionRaise, context: AttentionContext): AttentionDecision {
  const seen = isAttentionSessionSeen(signal.sessionId, context);
  const none = (seenValue: boolean): AttentionDecision => ({
    seen: seenValue,
    delivery: 'none',
    bounce: false,
  });

  if (context.preferences.enabled === false) {
    return none(seen);
  }
  if (context.alreadyNotified) {
    return none(seen);
  }
  if (seen) {
    return none(true);
  }
  if (context.catchingUp || isStaleTerminal(signal.endedAt, context.now)) {
    return { seen: false, delivery: 'catch-up-summary', bounce: false };
  }
  if (!isKindPreferenceEnabled(signal.kind, context.preferences)) {
    return none(false);
  }
  if (context.presence === 'active') {
    return {
      seen: false,
      delivery: context.preferences.foregroundToast ? 'in-app' : 'none',
      bounce: false,
    };
  }
  return {
    seen: false,
    delivery: 'system',
    bounce: signal.kind === 'needs-input' && context.preferences.bounceOnNeedsInput,
  };
}

function isKindPreferenceEnabled(
  kind: AttentionRaise['kind'],
  preferences: AttentionPreferences,
): boolean {
  if (kind === 'needs-input') {
    return preferences.onNeedsInput;
  }
  if (kind === 'turn-complete') {
    return preferences.onComplete;
  }
  return preferences.onFailure;
}

function isStaleTerminal(endedAt: string | undefined, now: number): boolean {
  if (endedAt === undefined) {
    return false;
  }
  const endedMs = Date.parse(endedAt);
  if (Number.isNaN(endedMs)) {
    return false;
  }
  return endedMs < now - ATTENTION_STALE_TERMINAL_MS;
}
