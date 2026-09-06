import type { ContextUsageSnapshot } from '@piwin/contracts';
import type { ChatUiState } from './chat-ui-types';

export function contextUsageForSessionSet(input: {
  warmHit: { contextUsage: ContextUsageSnapshot | null } | null;
  activeSessionId: string | null;
  nextSessionId: string;
  current: ContextUsageSnapshot | null;
}): ContextUsageSnapshot | null {
  return input.warmHit
    ? input.warmHit.contextUsage
    : input.activeSessionId === input.nextSessionId
      ? input.current
      : null;
}

export function contextUsageForLoadMessages(
  incoming: ContextUsageSnapshot | null | undefined,
  current: ContextUsageSnapshot | null,
): ContextUsageSnapshot | null {
  return incoming !== undefined ? incoming : current;
}

export function applyCompactionEndContextUsage(
  current: ContextUsageSnapshot | null,
  event: { ok?: boolean; tokensAfter?: number },
): ContextUsageSnapshot | null {
  return event.ok !== false && typeof event.tokensAfter === 'number' && current
    ? {
        ...current,
        tokensUsed: event.tokensAfter,
        totalTokens: event.tokensAfter,
        ...(typeof current.tokensLimit === 'number' && current.tokensLimit > 0
          ? { contextRatio: event.tokensAfter / current.tokensLimit }
          : {}),
        updatedAt: new Date().toISOString(),
        source: 'pi-contextUsage' as const,
      }
    : current;
}

export function applyUsageUpdate(state: ChatUiState, usage: ContextUsageSnapshot): ChatUiState {
  // Occupancy authority is SessionContextSnapshot, not this leftover field.
  return { ...state, contextUsage: usage };
}
