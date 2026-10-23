import type { SessionScope } from '@piwin/contracts';
import type { SidebarMode } from '../sidebar/sidebar-mode';

/** Chat-mode special handling is piwin-only. External agents (Grok) are agent sessions. */
export function isPiwinConversationAgent(agentId: string | undefined): boolean {
  return agentId === undefined || agentId === '' || agentId === 'pi';
}

/**
 * Conversation chrome belongs to the chat pane and a piwin `{ kind: 'general' }`
 * session. Grok can live in Conversations, but it still uses agent chrome
 * (CLI default, backend picker) rather than Pi chat chrome.
 */
export function isConversationSessionChrome(
  scope: SessionScope,
  sidebarMode: SidebarMode,
  agentId?: string,
): boolean {
  return isPiwinConversationAgent(agentId) && scope.kind === 'general' && sidebarMode === 'chat';
}
