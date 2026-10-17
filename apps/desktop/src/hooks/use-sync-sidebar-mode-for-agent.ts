import { useEffect } from 'react';
import { isPiwinConversationAgent } from '../is-conversation-session';
import type { SidebarMode } from '../sidebar-mode';

/**
 * Project-scoped external agents (Grok in a repo folder) live in the code
 * pane. Snap there when such a session becomes active. A Loose / Conversations
 * Grok session stays in chat — do not bounce it under the project list.
 *
 * Depend on agent + scope kind, not the current pane, so clicking the other
 * tab on an already-active session does not fight the user.
 */
export function useSyncSidebarModeForAgent(
  activeAgentId: string | undefined,
  setSidebarMode: (mode: SidebarMode) => void,
  activeScopeKind?: 'general' | 'project',
): void {
  useEffect(() => {
    if (activeAgentId === undefined || isPiwinConversationAgent(activeAgentId)) {
      return;
    }
    if (activeScopeKind === 'project') {
      setSidebarMode('code');
    } else if (activeScopeKind === 'general') {
      setSidebarMode('chat');
    }
  }, [activeAgentId, activeScopeKind, setSidebarMode]);
}
