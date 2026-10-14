import { useEffect } from 'react';
import { isPiwinConversationAgent } from '../is-conversation-session';
import type { SidebarMode } from '../sidebar-mode';

/**
 * Non-pi agents (Grok, etc.) live in the code pane. Snap there when such a
 * session becomes active.
 *
 * Depend only on `activeAgentId` — not the current pane. Clicking Chat while
 * Grok is still selected must not bounce the sidebar back to code.
 */
export function useSyncSidebarModeForAgent(
  activeAgentId: string | undefined,
  setSidebarMode: (mode: SidebarMode) => void,
): void {
  useEffect(() => {
    if (activeAgentId !== undefined && !isPiwinConversationAgent(activeAgentId)) {
      setSidebarMode('code');
    }
  }, [activeAgentId, setSidebarMode]);
}
