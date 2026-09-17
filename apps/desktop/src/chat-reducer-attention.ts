import type { ChatUiAction, ChatUiState } from './chat-ui-types';

export function isChatSessionSeen(state: ChatUiState, sessionId: string): boolean {
  return state.activeSessionId === sessionId;
}

export function shouldMarkTurnAttention(state: ChatUiState, sessionId: string): boolean {
  return !isChatSessionSeen(state, sessionId);
}

export function reduceAttentionAction(
  state: ChatUiState,
  action: Extract<ChatUiAction, { type: 'attention/presence' | 'attention/visible-sessions' }>,
): ChatUiState {
  void action;
  return state;
}
