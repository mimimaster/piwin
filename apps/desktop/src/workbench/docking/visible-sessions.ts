import { listConversationPaneLeaves, type ConversationPaneLayout } from '../../conversation-pane-layout.js';
import { listStageGroupIds } from './topology.js';
import type { WorkspaceState } from './types.js';

function uniqueSorted(ids: Iterable<string>): string[] {
  return [...new Set(ids)].sort();
}

export function selectVisibleSessionIds(input: {
  dockingState: WorkspaceState | null;
  paneLayout: ConversationPaneLayout | null;
  activeSessionId: string | null;
  conversationCovered: boolean;
}): string[] {
  if (input.conversationCovered) {
    return [];
  }

  if (input.dockingState) {
    const ids: string[] = [];
    for (const groupId of listStageGroupIds(input.dockingState.stage)) {
      const group = input.dockingState.groups[groupId];
      const viewId = group?.activeViewId;
      if (!viewId) continue;
      const view = input.dockingState.views[viewId];
      if (view?.kind === 'session' && typeof view.sessionId === 'string') {
        ids.push(view.sessionId);
      }
    }
    return uniqueSorted(ids);
  }

  if (input.paneLayout) {
    const ids: string[] = [];
    for (const leaf of listConversationPaneLeaves(input.paneLayout.root)) {
      if (leaf.sessionId !== null) {
        ids.push(leaf.sessionId);
      }
    }
    return uniqueSorted(ids);
  }

  return input.activeSessionId !== null ? [input.activeSessionId] : [];
}
