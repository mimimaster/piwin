import type { SessionScope } from '@piwin/contracts';
import type { SidebarMode } from './sidebar-mode';

/**
 * Conversation chrome belongs to the chat pane.
 *
 * No Repo is the general-scope workspace in the code pane: it has no git
 * checkout, but it is still an agent session (orchestration, run mode, tools).
 * Project folders are always agent.
 */
export function isConversationSessionChrome(
  scope: SessionScope,
  sidebarMode: SidebarMode,
): boolean {
  return scope.kind === 'general' && sidebarMode === 'chat';
}
