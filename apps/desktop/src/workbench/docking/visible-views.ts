import { listStageGroupIds } from './topology.js';
import type { WorkspaceState, WorkspaceView } from './types.js';

export function isStageGroupVisible(state: WorkspaceState, groupId: string, phone: boolean): boolean {
  if (phone || state.displayMode === 'focused') return groupId === state.activeGroupId;
  if (state.displayMode === 'maximized') return groupId === state.maximizedGroupId;
  return true;
}

/** Only the active tab of a rendered group has presentation demand. */
export function selectVisibleWorkspaceViews(
  state: WorkspaceState,
  input: { phone: boolean; rightPanelOpen: boolean },
): WorkspaceView[] {
  const groupIds = listStageGroupIds(state.stage).filter((groupId) =>
    isStageGroupVisible(state, groupId, input.phone));
  const rightGroupId = state.rightPanel.groupIds[0];
  if (input.rightPanelOpen && rightGroupId !== undefined) groupIds.push(rightGroupId);
  const views: WorkspaceView[] = [];
  for (const groupId of groupIds) {
    const activeViewId = state.groups[groupId]?.activeViewId;
    const view = activeViewId === undefined || activeViewId === null ? undefined : state.views[activeViewId];
    if (view !== undefined) views.push(view);
  }
  return views;
}
