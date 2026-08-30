/**
 * Selection/resume identity for late Host callbacks.
 * User selection is the activation authority; request sequence beats arrival time.
 * Never order by Date.now.
 */
export type ResumeSelectionTicket = {
  hostInstanceId: string | null;
  sessionId: string;
  selectionEpoch: number;
  requestId: number;
};

export type SessionSelectionGuard = {
  hostInstanceId: string | null;
  selectedSessionId: string | null;
  selectionEpoch: number;
  /** Monotonic per guard lifetime; compared as "latest request wins". */
  issuedRequestId: number;
};

export function createSessionSelectionGuard(
  hostInstanceId: string | null = null,
): SessionSelectionGuard {
  return {
    hostInstanceId,
    selectedSessionId: null,
    selectionEpoch: 0,
    issuedRequestId: 0,
  };
}

/** New, leave scope, delete current, or HostInstance change. */
export function bumpSelectionEpoch(
  guard: SessionSelectionGuard,
  next: { selectedSessionId: string | null; hostInstanceId?: string | null },
): SessionSelectionGuard {
  const hostInstanceId =
    next.hostInstanceId !== undefined ? next.hostInstanceId : guard.hostInstanceId;
  return {
    hostInstanceId,
    selectedSessionId: next.selectedSessionId,
    selectionEpoch: guard.selectionEpoch + 1,
    issuedRequestId: guard.issuedRequestId,
  };
}

/**
 * HostInstance change: drop the previous identity so in-flight callbacks cannot
 * apply. Caller still clears transport cursor separately.
 */
export function resetGuardHostInstance(
  guard: SessionSelectionGuard,
  hostInstanceId: string | null,
): SessionSelectionGuard {
  if (guard.hostInstanceId === hostInstanceId) {
    return guard;
  }
  return {
    hostInstanceId,
    selectedSessionId: guard.selectedSessionId,
    selectionEpoch: guard.selectionEpoch + 1,
    issuedRequestId: guard.issuedRequestId,
  };
}

/** Switch to a session. Same id + instance does not bump epoch. */
export function selectSessionForResume(
  guard: SessionSelectionGuard,
  sessionId: string,
  hostInstanceId?: string | null,
): SessionSelectionGuard {
  const nextHost =
    hostInstanceId !== undefined ? hostInstanceId : guard.hostInstanceId;
  if (guard.selectedSessionId === sessionId && guard.hostInstanceId === nextHost) {
    return guard;
  }
  return bumpSelectionEpoch(guard, {
    selectedSessionId: sessionId,
    hostInstanceId: nextHost,
  });
}

export function beginResumeRequest(
  guard: SessionSelectionGuard,
  sessionId: string,
): { guard: SessionSelectionGuard; ticket: ResumeSelectionTicket } {
  const issuedRequestId = guard.issuedRequestId + 1;
  const next: SessionSelectionGuard = { ...guard, issuedRequestId };
  return {
    guard: next,
    ticket: {
      hostInstanceId: next.hostInstanceId,
      sessionId,
      selectionEpoch: next.selectionEpoch,
      requestId: issuedRequestId,
    },
  };
}

export function resumeTicketMatches(
  guard: SessionSelectionGuard,
  ticket: ResumeSelectionTicket,
): boolean {
  return (
    guard.hostInstanceId === ticket.hostInstanceId &&
    guard.selectedSessionId === ticket.sessionId &&
    guard.selectionEpoch === ticket.selectionEpoch &&
    guard.issuedRequestId === ticket.requestId
  );
}
