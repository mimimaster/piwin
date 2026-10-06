/**
 * Pure composer-dock assembly helpers. The React hook that builds ComposerDockProps
 * lives in hooks/use-composer-dock-props.ts so App does not own this policy.
 */

import type { SessionBackendBinding } from '@piwin/contracts';
import type { ChatUiState } from './chat-reducer.js';
import { findSessionForLookup } from './session-list-lookup.js';

type ComposerSessionLookupState = Pick<ChatUiState,
  | 'activeSessionId'
  | 'sessionEntitiesById'
  | 'sessions'
  | 'generalSessions'
  | 'projectSessionsByPath'
  | 'backendCapabilitiesBySession'
  | 'backendOptionsBySession'
>;

/** Resolve retained bindings even after a session leaves the current sidebar page. */
export function resolveActiveComposerBackendBinding(
  state: ComposerSessionLookupState,
): SessionBackendBinding | undefined {
  const sessionId = state.activeSessionId;
  if (sessionId === null) return undefined;
  return (state.sessionEntitiesById[sessionId] ?? findSessionForLookup(sessionId, state))?.backend;
}

/** Sidebar paging and delayed catalogs must not change the session's agent. */
export function resolveActiveComposerAgentId(state: ComposerSessionLookupState): string | undefined {
  const sessionId = state.activeSessionId;
  if (sessionId === null) return undefined;
  return resolveActiveComposerBackendBinding(state)?.agentId ??
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
