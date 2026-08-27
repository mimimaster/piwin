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
