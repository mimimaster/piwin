import { isAttentionSessionSeen } from '@piwin/host-client';
import type { ChatUiAction, ChatUiState } from './chat-ui-types';
import { removeSessionIdMarker } from './chat-reducer-session-helpers';

export function isChatSessionSeen(state: ChatUiState, sessionId: string): boolean {
  const attentionContext = {
    presence: state.attentionPresence,
    visibleSessionIds: new Set(Object.keys(state.attentionVisibleSessionIds)),
    activeSessionId: state.activeSessionId,
    conversationCovered: state.attentionConversationCovered,
  };
  return isAttentionSessionSeen(sessionId, attentionContext);
}

export function shouldMarkTurnAttention(state: ChatUiState, sessionId: string): boolean {
  return !isChatSessionSeen(state, sessionId);
}

export function reduceAttentionAction(
  state: ChatUiState,
  action: Extract<ChatUiAction, { type: 'attention/presence' | 'attention/visible-sessions' }>,
): ChatUiState {
  if (action.type === 'attention/presence') {
    return reduceAttentionPresence(state, action.presence);
  }
  return reduceAttentionVisibleSessions(
    state,
    action.sessionIds,
    action.conversationCovered === true,
  );
}

function reduceAttentionPresence(
  state: ChatUiState,
  presence: ChatUiState['attentionPresence'],
): ChatUiState {
  if (state.attentionPresence === presence) {
    return state;
  }
  const next: ChatUiState = { ...state, attentionPresence: presence };
  if (state.attentionPresence === 'inactive' && presence === 'active') {
    return clearCompleteFailedMarkers(next, Object.keys(state.attentionVisibleSessionIds));
  }
  return next;
}

function reduceAttentionVisibleSessions(
  state: ChatUiState,
  sessionIds: readonly string[],
  conversationCovered: boolean,
): ChatUiState {
  const attentionVisibleSessionIds = sessionIdRecordFromIds(sessionIds);
  if (
    state.attentionConversationCovered === conversationCovered &&
    sameSessionIdRecord(state.attentionVisibleSessionIds, attentionVisibleSessionIds)
  ) {
    return state;
  }
  const previousVisible = state.attentionVisibleSessionIds;
  let next: ChatUiState = {
    ...state,
    attentionVisibleSessionIds,
    attentionConversationCovered: conversationCovered,
  };
  if (state.attentionPresence === 'active') {
    const newlyVisible: string[] = [];
    for (const sessionId of sessionIds) {
      if (!(sessionId in previousVisible)) {
        newlyVisible.push(sessionId);
      }
    }
    next = clearCompleteFailedMarkers(next, newlyVisible);
  }
  return next;
}

function sessionIdRecordFromIds(sessionIds: readonly string[]): Record<string, true> {
  const record: Record<string, true> = {};
  for (const sessionId of sessionIds) {
    record[sessionId] = true;
  }
  return record;
}

function sameSessionIdRecord(
  left: Record<string, true>,
  right: Record<string, true>,
): boolean {
  const leftIds = Object.keys(left);
  const rightIds = Object.keys(right);
  if (leftIds.length !== rightIds.length) {
    return false;
  }
  for (const id of leftIds) {
    if (!(id in right)) {
      return false;
    }
  }
  return true;
}

function clearCompleteFailedMarkers(
  state: ChatUiState,
  sessionIds: readonly string[],
): ChatUiState {
  let completedAttentionSessionIds = state.completedAttentionSessionIds;
  let failedAttentionSessionIds = state.failedAttentionSessionIds;
  for (const sessionId of sessionIds) {
    completedAttentionSessionIds = removeSessionIdMarker(completedAttentionSessionIds, sessionId);
    failedAttentionSessionIds = removeSessionIdMarker(failedAttentionSessionIds, sessionId);
  }
  if (
    completedAttentionSessionIds === state.completedAttentionSessionIds &&
    failedAttentionSessionIds === state.failedAttentionSessionIds
  ) {
    return state;
  }
  return {
    ...state,
    completedAttentionSessionIds,
    failedAttentionSessionIds,
  };
}
