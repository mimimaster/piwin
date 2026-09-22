/**
 * Sidebar working spinner: the open session follows runPhase so an idle
 * composer cannot keep spinning; background rows follow the run map.
 */
export type SessionRowRunPhase = 'idle' | 'streaming' | 'pausing' | 'aborting';

export function sessionRowIsWorking(input: {
  sessionId: string;
  isDraft: boolean;
  activeSessionId: string | null;
  runPhase: SessionRowRunPhase;
  workingSessionIds?: Record<string, true> | undefined;
}): boolean {
  if (input.isDraft) {
    return false;
  }
  if (input.sessionId === input.activeSessionId) {
    return input.runPhase === 'streaming';
  }
  return input.workingSessionIds != null && input.sessionId in input.workingSessionIds;
}

/**
 * Same live states that replace the relative-time slot with an activity
 * indicator. Used by the row view and by recency sort so in-progress
 * sessions stay at the top of the project list while they run.
 */
export function sessionRowHasOrderingActivity(input: {
  sessionId: string;
  isDraft?: boolean;
  activeSessionId: string | null;
  runPhase: SessionRowRunPhase;
  workingSessionIds?: Record<string, true> | undefined;
  backendServiceSessionIds?: Record<string, true> | undefined;
  waitingPermissionSessionIds?: Record<string, true> | undefined;
}): boolean {
  if (input.isDraft === true) {
    return false;
  }
  // Selection temporarily resets the foreground run projection while resume
  // reconciles. The global run marker must keep the row in the same sort slot.
  if (input.workingSessionIds != null && input.sessionId in input.workingSessionIds) {
    return true;
  }
  return sessionRowHasLiveActivity(input);
}

export function sessionRowHasLiveActivity(input: {
  sessionId: string;
  isDraft?: boolean;
  activeSessionId: string | null;
  runPhase: SessionRowRunPhase;
  workingSessionIds?: Record<string, true> | undefined;
  backendServiceSessionIds?: Record<string, true> | undefined;
  waitingPermissionSessionIds?: Record<string, true> | undefined;
}): boolean {
  if (input.isDraft === true) {
    return false;
  }
  if (
    sessionRowIsWorking({
      sessionId: input.sessionId,
      isDraft: false,
      activeSessionId: input.activeSessionId,
      runPhase: input.runPhase,
      ...(input.workingSessionIds !== undefined
        ? { workingSessionIds: input.workingSessionIds }
        : {}),
    })
  ) {
    return true;
  }
  if (
    input.backendServiceSessionIds != null &&
    input.sessionId in input.backendServiceSessionIds
  ) {
    return true;
  }
  if (
    input.waitingPermissionSessionIds != null &&
    input.sessionId in input.waitingPermissionSessionIds
  ) {
    return true;
  }
  return false;
}
