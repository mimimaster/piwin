import { LIVE_SUBSCRIPTION_LIMIT } from './constants.js';
import { isRightGroupId, listStageGroupIds } from './topology.js';
import type { WorkspaceState } from './types.js';

/**
 * Visible stage sessions (≤4) > visible right-tool bound session (≤1) > MRU hidden.
 * Never exceeds 8. Does not invent a Host pause protocol.
 */
export function selectLiveSessionIds(
  state: WorkspaceState,
  hiddenMruSessionIds: readonly string[] = [],
): string[] {
  const selected: string[] = [];
  const seen = new Set<string>();
  const push = (sessionId: string | null | undefined): void => {
    if (!sessionId || seen.has(sessionId) || selected.length >= LIVE_SUBSCRIPTION_LIMIT) return;
    seen.add(sessionId);
    selected.push(sessionId);
  };

  for (const groupId of listStageGroupIds(state.stage)) {
    const group = state.groups[groupId];
    if (!group) continue;
    const active = group.activeViewId ? state.views[group.activeViewId] : undefined;
    if (active?.kind === 'session') push(active.sessionId);
  }

  for (const groupId of state.rightPanel.groupIds) {
    if (!isRightGroupId(state, groupId)) continue;
    const group = state.groups[groupId];
    if (!group) continue;
    const active = group.activeViewId ? state.views[group.activeViewId] : undefined;
    if (active) push(active.boundSessionId ?? active.sessionId);
  }

  for (const sessionId of hiddenMruSessionIds) {
    push(sessionId);
  }
  return selected;
}
