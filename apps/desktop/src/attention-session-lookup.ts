import type { ChatUiState, SessionListItemUi } from './chat-reducer';
import { findSessionForLookup } from './session-list-lookup';

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
