import type {
  SessionScope,
  SessionSummary,
  SubagentBatchProjection,
  SubagentInvocation,
  SubagentResultSummary,
  SubagentTaskResult,
} from '@piwin/contracts';
import type { ChatUiState, SessionListItemUi, SubagentStreamState } from './chat-ui-types';

export const CLEARED_SUBAGENT_UI = {
  subagentStreams: {} as Record<string, SubagentStreamState>,
  subagentChildren: {} as Record<string, SessionSummary>,
  subagentInvocations: {} as Record<string, SubagentInvocation>,
  subagentBatches: {} as Record<string, SubagentBatchProjection>,
  subagentTaskResults: {} as Record<string, SubagentTaskResult>,
  subagentResults: {} as Record<string, SubagentResultSummary>,
  subagentVerifications: {} as Record<
    string,
    {
      verificationId: string;
      revision: number;
      resultId: string;
      status: 'passed' | 'failed';
    }
  >,
};

export function isTerminalSubagentChild(child: SessionSummary): boolean {
  return (
    child.subagentStatus === 'done' ||
    child.subagentStatus === 'failed' ||
    child.subagentStatus === 'cancelled'
  );
}

export function isTerminalSubagentInvocation(invocation: SubagentInvocation): boolean {
  return (
    invocation.status === 'completed' ||
    invocation.status === 'needs-integration' ||
    invocation.status === 'failed' ||
    invocation.status === 'cancelled'
  );
}

export function isTerminalSubagentResult(result: SubagentResultSummary): boolean {
  return (
    result.executionStatus === 'completed' ||
    result.executionStatus === 'failed' ||
    result.executionStatus === 'cancelled'
  );
}

export function refreshActiveSessionMetadata(
  state: ChatUiState,
  next: Partial<ChatUiState>,
): ChatUiState {
  const activeSessionId =
    next.activeSessionId !== undefined ? next.activeSessionId : state.activeSessionId;
  if (activeSessionId === null) {
    return { ...state, ...next, activeSessionMetadata: null };
  }
  const lists: SessionListItemUi[][] = [
    (next.sessions as SessionListItemUi[] | undefined) ?? state.sessions,
    (next.generalSessions as SessionListItemUi[] | undefined) ?? state.generalSessions,
    ...Object.values(
      (next.projectSessionsByPath as Record<string, SessionListItemUi[]> | undefined) ??
        state.projectSessionsByPath,
    ),
  ];
  const entities =
    (next.sessionEntitiesById as Record<string, SessionListItemUi> | undefined) ??
    state.sessionEntitiesById;
  const item =
    lists.flat().find((session) => session.id === activeSessionId) ?? entities[activeSessionId];
  // A changed active session with no list row yet must not inherit the
  // previous session's title (first-send / cold resume). Keep the previous
  // cache only when the active session id did not change (sidebar paging).
  const activeSessionChanged =
    next.activeSessionId !== undefined && next.activeSessionId !== state.activeSessionId;
  return {
    ...state,
    ...next,
    activeSessionMetadata: item
      ? {
          id: item.id,
          name: item.name,
          ...(item.scope ? { scope: item.scope } : {}),
          ...(item.origin ? { origin: item.origin } : {}),
          ...(item.origin?.kind === 'fork' ? { parentSessionId: item.origin.rootSessionId } : {}),
        }
      : activeSessionChanged
        ? null
        : state.activeSessionMetadata,
  };
}

export function dedupeSessionsById(sessions: SessionListItemUi[]): SessionListItemUi[] {
  const seen = new Set<string>();
  const unique: SessionListItemUi[] = [];
  for (const session of sessions) {
    if (seen.has(session.id)) {
      continue;
    }
    seen.add(session.id);
    unique.push(session);
  }
  return unique;
}

export function sessionListContainsId(
  list: readonly SessionListItemUi[],
  sessionId: string,
): boolean {
  return list.some((session) => session.id === sessionId);
}

export function owningScopeFromLists(state: ChatUiState, sessionId: string): SessionScope | null {
  if (sessionListContainsId(state.generalSessions, sessionId)) {
    return { kind: 'general' };
  }
  for (const [projectPath, list] of Object.entries(state.projectSessionsByPath)) {
    if (sessionListContainsId(list, sessionId)) {
      return { kind: 'project', projectPath };
    }
  }
  return null;
}

/** Remove a session ID from a marker set, returning a new record. */
export function removeSessionIdMarker(
  markers: Record<string, true>,
  sessionId: string | null,
): Record<string, true> {
  if (!sessionId || !(sessionId in markers)) {
    return markers;
  }
  const next = { ...markers };
  delete next[sessionId];
  return next;
}

/** Remove a session ID from the working set, returning a new record. */
export function removeWorkingSessionId(
  working: Record<string, true>,
  sessionId: string | null,
): Record<string, true> {
  return removeSessionIdMarker(working, sessionId);
}
