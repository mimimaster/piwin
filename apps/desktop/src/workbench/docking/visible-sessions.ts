import type { ConversationPaneLayout } from '../../conversation-pane-layout';
import type { WorkspaceState } from './types';

export function selectVisibleSessionIds(input: {
  dockingState: WorkspaceState | null;
  paneLayout: ConversationPaneLayout | null;
  activeSessionId: string | null;
  conversationCovered: boolean;
}): string[] {
  void input;
  throw new Error('AN-R2 not implemented');
}
