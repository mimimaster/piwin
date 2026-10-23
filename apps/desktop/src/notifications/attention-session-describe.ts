/**
 * Session line for an attention notice: project + session title. Side chats
 * have no list row of their own and borrow the main conversation's.
 */
import type { ChatUiState } from '../conversation/chat-reducer';
import type { DesktopAttentionSnapshot } from './desktop-attention-controller';
import type { DesktopLocale } from '../i18n/desktop-locale';
import { lookupAttentionSession, type AttentionLookupSession } from './attention-session-lookup';
import { projectLabel } from '../sidebar/project-display-name';
import { findSideChatBinding } from '../session/side-chat-sessions';

function sessionProjectPath(session: AttentionLookupSession, state: ChatUiState): string | null {
  if (typeof session.projectPath === 'string' && session.projectPath !== '') {
    return session.projectPath;
  }
  if (session.scope?.kind === 'project') {
    return session.scope.projectPath;
  }
  if (state.activeScope.kind === 'project') {
    return state.activeScope.projectPath;
  }
  return state.projectPath;
}

export function describeSessionForAttention(
  sessionId: string,
  state: ChatUiState,
  projects: readonly { path: string; displayName?: string }[],
  locale: DesktopLocale,
): ReturnType<DesktopAttentionSnapshot['describeSession']> {
  // A side chat has no list row or title of its own; name it by the
  // conversation it sits beside so the notice is not "Untitled session".
  const sideChat = findSideChatBinding(sessionId);
  if (sideChat) {
    const main = describeSessionForAttention(sideChat.mainSessionId, state, projects, locale);
    const label = locale === 'en' ? 'Side chat' : '侧聊';
    return {
      ...main,
      sessionTitle: main.sessionTitle ? `${label} · ${main.sessionTitle}` : label,
    };
  }
  const session = lookupAttentionSession(state, sessionId);
  if (!session) {
    return {};
  }
  const projectPath = sessionProjectPath(session, state);
  const projectId =
    typeof session.projectId === 'string' && session.projectId !== ''
      ? session.projectId
      : projectPath ?? 'general';
  return {
    sessionTitle: session.title ?? session.name,
    ...(projectPath ? { projectName: projectLabel(projectPath, projects) } : {}),
    projectId,
  };
}
