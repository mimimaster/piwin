import { shouldAcceptContextUsage, type ContextUsageSnapshot } from '@piwin/contracts';
import type { ChatUiState } from './chat-ui-types';

export function contextUsageForSessionSet(input: {
  warmHit: { contextUsage: ContextUsageSnapshot | null } | null;
  keepPreviousWhileLoading: boolean;
  activeSessionId: string | null;
  nextSessionId: string;
  current: ContextUsageSnapshot | null;
}): ContextUsageSnapshot | null {
  return input.warmHit
    ? input.warmHit.contextUsage
    : input.keepPreviousWhileLoading
      ? input.current
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
  if (!shouldAcceptContextUsage(state.contextUsage, usage)) {
    return state;
  }
  return { ...state, contextUsage: usage };
}
