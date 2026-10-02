/**
 * Pure composer-dock assembly helpers. The React hook that builds ComposerDockProps
 * lives in hooks/use-composer-dock-props.ts so App does not own this policy.
 */

import type { ChatUiState } from './chat-reducer.js';
import { findSessionForLookup } from './session-list-lookup.js';

/** Sidebar paging and delayed catalogs must not change the session's agent. */
export function resolveActiveComposerAgentId(state: Pick<ChatUiState,
  | 'activeSessionId'
  | 'sessionEntitiesById'
  | 'sessions'
  | 'generalSessions'
  | 'projectSessionsByPath'
  | 'backendCapabilitiesBySession'
  | 'backendOptionsBySession'
>): string | undefined {
  const sessionId = state.activeSessionId;
  if (sessionId === null) return undefined;
  const session = state.sessionEntitiesById[sessionId] ?? findSessionForLookup(sessionId, state);
  return session?.backend?.agentId ??
    state.backendCapabilitiesBySession[sessionId]?.agentId ??
    state.backendOptionsBySession[sessionId]?.agentId ?? 'pi';
}

export function listSessionUserPrompts(
  messages: readonly { role: string; text: string }[],
  limit = 10,
): string[] {
  const prompts: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') {
      continue;
    }
    const text = message.text.trim();
    if (!text || prompts.includes(text)) {
      continue;
    }
    prompts.push(text);
    if (prompts.length >= limit) {
      break;
    }
  }
  return prompts;
}

export function resolveComposerLayoutMode(input: {
  messageCount: number;
  awaitingTranscript: boolean;
}): 'centered' | 'docked' {
  // While resuming a session, keep docked layout even if paint is still
  // previous/warm rows or briefly empty — never treat that as a brand-new chat.
  return input.messageCount === 0 && !input.awaitingTranscript ? 'centered' : 'docked';
}

export function isGoalExtensionEnabled(disabledIds: readonly string[] | undefined): boolean {
  return !(disabledIds ?? []).some((id) => id.toLowerCase() === 'goal');
}
