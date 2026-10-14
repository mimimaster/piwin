import type { SessionListItemUi } from './chat-ui-types.js';
import type { SidebarTreeRowsInput } from './sidebar-tree-rows.js';
import { sessionRowHasOrderingActivity } from './session-row-working.js';

export function sortPinnedThenUpdated(
  list: readonly SessionListItemUi[],
  activityInput?: Pick<
    SidebarTreeRowsInput,
    | 'revealSessionId'
    | 'runPhase'
    | 'workingSessionIds'
    | 'backendServiceSessionIds'
    | 'waitingPermissionSessionIds'
  >,
): SessionListItemUi[] {
  return [...list].sort((left, right) => {
    const leftPinned = left.isPinned === true;
    const rightPinned = right.isPinned === true;
    if (leftPinned !== rightPinned) {
      return leftPinned ? -1 : 1;
    }
    if (leftPinned && rightPinned) {
      const byPinnedAt = (right.pinnedAt ?? '').localeCompare(left.pinnedAt ?? '');
      if (byPinnedAt !== 0) {
        return byPinnedAt;
      }
    }
    if (activityInput) {
      const leftLive = sessionIsLiveActivity(left, activityInput);
      const rightLive = sessionIsLiveActivity(right, activityInput);
      if (leftLive !== rightLive) {
        return leftLive ? -1 : 1;
      }
    }
    const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : Number.POSITIVE_INFINITY;
    const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : Number.POSITIVE_INFINITY;
    const leftSafe = Number.isFinite(leftTime) ? leftTime : 0;
    const rightSafe = Number.isFinite(rightTime) ? rightTime : 0;
    if (rightSafe !== leftSafe) {
      return rightSafe - leftSafe;
    }
    return left.id.localeCompare(right.id);
  });
}

function sessionIsLiveActivity(
  session: SessionListItemUi,
  input: Pick<
    SidebarTreeRowsInput,
    | 'revealSessionId'
    | 'runPhase'
    | 'workingSessionIds'
    | 'backendServiceSessionIds'
    | 'waitingPermissionSessionIds'
  >,
): boolean {
  return sessionRowHasOrderingActivity({
    sessionId: session.id,
    nativeActivity: session.nativeCli?.kind === 'native' ? session.nativeCli.activity : undefined,
    isDraft: false,
    activeSessionId: input.revealSessionId ?? null,
    runPhase: input.runPhase ?? 'idle',
    ...(input.workingSessionIds !== undefined
      ? { workingSessionIds: input.workingSessionIds }
      : {}),
    ...(input.backendServiceSessionIds !== undefined
      ? { backendServiceSessionIds: input.backendServiceSessionIds }
      : {}),
    ...(input.waitingPermissionSessionIds !== undefined
      ? { waitingPermissionSessionIds: input.waitingPermissionSessionIds }
      : {}),
  });
}
