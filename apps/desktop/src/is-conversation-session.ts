import type { SessionScope } from '@piwin/contracts';
import type { SidebarMode } from './sidebar-mode';

/**
 * Conversation chrome belongs to the chat pane and `{ kind: 'general' }`.
 *
 * No Repo is a built-in project folder (`generalWorkspacePath`). Those
 * sessions are agent chats, same as any other project folder.
 */
export function isConversationSessionChrome(
  scope: SessionScope,
  sidebarMode: SidebarMode,
): boolean {
  return scope.kind === 'general' && sidebarMode === 'chat';
}
