import type { ChatUiState, SessionListItemUi } from '../conversation/chat-reducer';
import { findSessionForLookup } from '../session/session-list-lookup';
import { findSideChatBinding } from '../session/side-chat-sessions';

export type AttentionLookupSession = SessionListItemUi & {
  title?: string;
  parentSessionId?: string;
  projectPath?: string;
  projectId?: string;
};

/**
 * Find a session named by a notification. Sidebar pages only hold what is
 * paged in; the canonical entity map also knows rows the sidebar trimmed.
 */
export function lookupAttentionSession(
  state: ChatUiState,
  sessionId: string,
): AttentionLookupSession | undefined {
  const listed = findSessionForLookup(sessionId, {
    sessions: state.sessions,
    generalSessions: state.generalSessions,
    projectSessionsByPath: state.projectSessionsByPath,
  });
  return (listed ?? state.sessionEntitiesById[sessionId]) as AttentionLookupSession | undefined;
}

/** A child session notification opens its parent conversation. */
export function resolveActivationSessionId(state: ChatUiState, sessionId: string): string | null {
  const session = lookupAttentionSession(state, sessionId);
  if (!session) {
    return null;
  }
  if (typeof session.parentSessionId === 'string' && session.parentSessionId !== '') {
    return session.parentSessionId;
  }
  return sessionId;
}

/**
 * Where a notification's "Jump" lands. A side chat is hidden from every
 * session list, so it resolves through its right-panel binding: open the main
 * conversation, then the side-chat tab — never the side chat as a main view.
 */
export type AttentionJumpTarget = { sessionId: string; sideChatTabId?: string };

export function resolveAttentionJumpTarget(
  state: ChatUiState,
  sessionId: string,
): AttentionJumpTarget | null {
  const sideChat = findSideChatBinding(sessionId);
  if (sideChat) {
    return { sessionId: sideChat.mainSessionId, sideChatTabId: sideChat.tabId };
  }
  const target = resolveActivationSessionId(state, sessionId);
  return target === null ? null : { sessionId: target };
}
