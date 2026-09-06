import type { ExecutionRunRecord, SessionTranscriptMessage } from '@piwin/contracts';
import { markLatestAssistantFailure } from './run-failure-message';
import type { ChatMessageUi, ChatUiAction, ChatUiState, RunRecordUi } from './chat-ui-types';
import {
  applyBackgroundSessionTurnWorkingMarker,
  isUserControlInFlight,
  withoutEmptyAssistantPlaceholders,
  withoutFailureEvidence,
} from './chat-reducer-envelope';
import { removeSessionIdMarker, removeWorkingSessionId } from './chat-reducer-session-helpers';
import {
  enforceBoundedTranscriptWindow,
  parseAcceptedAt,
  parseEventTime,
} from './chat-reducer-transcript';
import {
  dropPermissionPromptsForRun,
  permissionQueueFields,
} from './permission-queue';

export type ChatUiRunAction = Extract<
  ChatUiAction,
  {
    type:
      | 'user/send'
      | 'user/steer'
      | 'user/send-rollback'
      | 'run/pausing'
      | 'run/pause-failed'
      | 'run/aborting'
      | 'run/abort-failed'
      | 'run/accepted'
      | 'run/updated'
      | 'run/terminal'
      | 'run/stale-clear'
      | 'run/intervention-updated'
      | 'run/terminal-dismiss'
      | 'foreground/admission';
  }
>;

/** Reduce the authoritative top-level RunHostPush projection. */
export function applyRunRecord(
  state: ChatUiState,
  run: ExecutionRunRecord,
  isTerminalEvent: boolean,
): ChatUiState {
  const previousRecord = state.runRecordsById[run.runId];
  if (previousRecord !== undefined && !isTerminalEvent) {
    const sameOrOlderRevision =
      (run.revision !== undefined &&
        previousRecord.revision !== undefined &&
        run.revision <= previousRecord.revision) ||
      (run.revision === undefined && isLegacyRunProjectionEqual(previousRecord, run));
    if (sameOrOlderRevision) {
      // Dedup only while the projection is already live / resting at a known
      // terminal. After switching back to a still-running session, session/set
      // reset activeRunId and lastTerminalRunId to null while the warm cache
      // restored the last record (revision N). Host's
      // `session/foreground-run` snapshot carries the SAME revision — the run
      // registry only bumps on phase transitions, so an uninterrupted text
      // stream never advances it — and must re-establish the projection
      // instead of being swallowed as a duplicate. At-rest state is the only
      // shape where re-applying a same-revision record is legitimate; any
      // remembered terminal or live run keeps the replay guard.
      if (state.activeRunId !== null || state.lastTerminalRunId !== null) {
        return state;
      }
    }
  }
  const phaseAt = parseEventTime(run.phaseUpdatedAt ?? run.startedAt ?? run.endedAt ?? '');
  const lastPhase = previousRecord?.phaseHistory.at(-1);
  const phaseHistory =
    run.phase !== undefined &&
    (lastPhase?.phase !== run.phase || lastPhase.detail !== run.phaseDetail)
      ? [
          ...(previousRecord?.phaseHistory ?? []),
          {
            phase: run.phase,
            at: phaseAt,
            ...(run.phaseDetail ? { detail: run.phaseDetail } : {}),
          },
        ]
      : (previousRecord?.phaseHistory ?? []);
  const outcome =
    run.status === 'completed'
      ? ('completed' as const)
      : run.status === 'interrupted' && run.terminalCode === 'paused'
        ? ('paused' as const)
        : run.status === 'cancelled' || run.status === 'interrupted'
          ? ('cancelled' as const)
          : run.status === 'failed'
            ? ('failed' as const)
            : undefined;
  const nextRecord: RunRecordUi = {
    runId: run.runId,
    ...(run.revision !== undefined
      ? { revision: run.revision }
      : previousRecord?.revision !== undefined
        ? { revision: previousRecord.revision }
        : {}),
    status: run.status,
    ...(run.phase !== undefined
      ? { phase: run.phase }
      : previousRecord?.phase !== undefined
        ? { phase: previousRecord.phase }
        : {}),
    ...(run.phaseDetail !== undefined
      ? { phaseDetail: run.phaseDetail }
      : previousRecord?.phaseDetail !== undefined
        ? { phaseDetail: previousRecord.phaseDetail }
        : {}),
    phaseHistory,
    startedAt: run.startedAt ? parseEventTime(run.startedAt) : (previousRecord?.startedAt ?? null),
    endedAt: run.endedAt ? parseEventTime(run.endedAt) : (previousRecord?.endedAt ?? null),
    ...(outcome ? { outcome } : previousRecord?.outcome ? { outcome: previousRecord.outcome } : {}),
    ...(run.error
      ? { terminalMessage: run.error }
      : previousRecord?.terminalMessage
        ? { terminalMessage: previousRecord.terminalMessage }
        : {}),
  };
  const records = { ...state.runRecordsById, [run.runId]: nextRecord };

  if (run.kind !== 'session-turn') {
    return { ...state, runRecordsById: records };
  }
  if (outcome === undefined) {
    if (state.activeRunId === null && state.lastTerminalRunId === run.runId) {
      return { ...state, runRecordsById: records };
    }
    if (
      state.activeRunId !== null &&
      state.activeRunId !== run.runId &&
      run.status === 'cancelling'
    ) {
      return { ...state, runRecordsById: records };
    }
    // Pause and Stop both enter cancelling. Never revive the sidebar spinner or
    // streaming chrome while control is in flight — later abort errors used to
    // clear it, then a still-running run/updated put it right back before Host
    // had acknowledged the pause.
    const controlPending =
      run.status === 'cancelling' || run.phase === 'pausing' || isUserControlInFlight(state);
    return {
      ...state,
      activeRunId: run.runId,
      activeRunPhase: run.phase ?? state.activeRunPhase,
      activeRunPhaseDetail: run.phaseDetail ?? null,
      activeRunStartedAt: run.startedAt ? parseEventTime(run.startedAt) : state.activeRunStartedAt,
      activeRunPhaseUpdatedAt: run.phaseUpdatedAt
        ? parseEventTime(run.phaseUpdatedAt)
        : state.activeRunPhaseUpdatedAt,
      runPhase:
        run.phase === 'pausing' || state.runPhase === 'pausing'
          ? 'pausing'
          : run.status === 'cancelling' || state.runPhase === 'aborting'
            ? 'aborting'
            : 'streaming',
      streaming: !controlPending,
      lastTerminalRunId: null,
      runTerminal: { kind: 'none' },
      workingSessionIds: controlPending
        ? removeWorkingSessionId(state.workingSessionIds, run.sessionId)
        : { ...state.workingSessionIds, [run.sessionId]: true },
      runRecordsById: records,
    };
  }

  if (state.activeRunId !== null && state.activeRunId !== run.runId) {
    return { ...state, runRecordsById: records };
  }
  if (
    state.activeRunId === null &&
    state.lastTerminalRunId !== null &&
    state.lastTerminalRunId !== run.runId
  ) {
    return { ...state, runRecordsById: records };
  }
  if (state.activeRunId === null && state.lastTerminalRunId === run.runId) {
    return state;
  }
  const errorMessage = outcome === 'failed' ? run.error?.trim() || 'Run failed' : undefined;
  let messages = state.messages;
  if (outcome !== 'failed') {
    messages = messages.map((message) =>
      message.runId === run.runId ? withoutFailureEvidence(message) : message,
    );
  }
  if (errorMessage !== undefined) {
    const failureProjection = markLatestAssistantFailure(
      state.messages,
      run.runId,
      errorMessage,
      false,
      true,
      run.failure === undefined ? undefined : { failure: run.failure },
    );
    messages = failureProjection.messages;
    if (!failureProjection.stamped) {
      let lastAssistantIndex = -1;
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (messages[index]?.role === 'assistant') {
          lastAssistantIndex = index;
          break;
        }
      }
      if (lastAssistantIndex >= 0) {
        messages = messages.map((message, index) =>
          index === lastAssistantIndex
            ? {
                ...message,
                status: 'error' as const,
                error: message.error ?? errorMessage,
                ...(message.runId === undefined ? { runId: run.runId } : {}),
                ...(run.failure === undefined ? {} : { failure: run.failure }),
              }
            : message,
        );
      } else {
        messages = [
          ...messages,
          {
            id: `piw-m-error-${run.runId}`,
            role: 'assistant',
            text: '',
            thinking: '',
            tools: [],
            attachments: [],
            status: 'error',
            error: errorMessage,
            runId: run.runId,
            ...(run.failure === undefined ? {} : { failure: run.failure }),
          },
        ];
      }
    }
  }
  return {
    ...state,
    messages,
    activeRunId: null,
    activeRunPhase: null,
    activeRunPhaseDetail: null,
    activeRunStartedAt: null,
    activeRunPhaseUpdatedAt: null,
    lastTerminalRunId: run.runId,
    runPhase: 'idle',
    streaming: false,
    activeSkill: null,
    pendingTurnModel: null,
    ...permissionQueueFields(dropPermissionPromptsForRun(state.permissionQueue, run.runId)),
    error: outcome === 'failed' ? (run.error ?? 'Run failed') : state.error,
    runTerminal:
      outcome === 'paused'
        ? {
            kind: 'paused',
            at: Date.now(),
            ...(run.resumeCheckpointId ? { checkpointId: run.resumeCheckpointId } : {}),
          }
        : outcome === 'cancelled'
          ? { kind: 'stopped', at: Date.now() }
          : outcome === 'failed'
            ? { kind: 'failed', message: run.error ?? 'Run failed', at: Date.now() }
            : { kind: 'complete', at: Date.now() },
    runRecordsById: records,
    workingSessionIds: removeWorkingSessionId(state.workingSessionIds, run.sessionId),
    // Host implementations may publish a terminal-shaped `run/updated`
    // immediately before `run/terminal`; derive the sidebar cue here so both
    // delivery forms have identical completion behavior. The active session
    // is already visible, so only a background session needs the cue.
    // Completed and failed route to separate markers (Inkstone six-state
    // vocabulary distinguishes success from failed); each clears the other so
    // a session never shows both a mint checkmark and a coral node at once.
    completedAttentionSessionIds:
      outcome === 'completed' && state.activeSessionId !== run.sessionId
        ? { ...state.completedAttentionSessionIds, [run.sessionId]: true }
        : removeSessionIdMarker(state.completedAttentionSessionIds, run.sessionId),
    failedAttentionSessionIds:
      outcome === 'failed' && state.activeSessionId !== run.sessionId
        ? { ...state.failedAttentionSessionIds, [run.sessionId]: true }
        : removeSessionIdMarker(state.failedAttentionSessionIds, run.sessionId),
  };
}

export function isLegacyRunProjectionEqual(
  previous: RunRecordUi,
  run: ExecutionRunRecord,
): boolean {
  const outcome =
    run.status === 'completed'
      ? 'completed'
      : run.status === 'cancelled' || run.status === 'interrupted'
        ? 'cancelled'
        : run.status === 'failed'
          ? 'failed'
          : undefined;
  const previousOutcome = previous.outcome;
  const previousStartedAt = previous.startedAt;
  const previousEndedAt = previous.endedAt;
  const nextStartedAt = run.startedAt ? parseEventTime(run.startedAt) : null;
  const nextEndedAt = run.endedAt ? parseEventTime(run.endedAt) : null;
  const nextTerminalMessage = run.error;

  return (
    previous.status === run.status &&
    previous.phase === run.phase &&
    previous.phaseDetail === run.phaseDetail &&
    previousOutcome === outcome &&
    previousStartedAt === nextStartedAt &&
    previousEndedAt === nextEndedAt &&
    previous.terminalMessage === nextTerminalMessage
  );
}

export function reduceChatRun(state: ChatUiState, action: ChatUiRunAction): ChatUiState {
  switch (action.type) {
    case 'user/send': {
      const userMessage: ChatMessageUi = {
        id: action.clientMessageId ?? crypto.randomUUID(),
        role: 'user',
        text: action.text,
        thinking: '',
        tools: [],
        attachments: action.attachments ?? [],
        ...(action.contextRefs && action.contextRefs.length > 0
          ? { contextRefs: action.contextRefs }
          : {}),
        status: 'done',
        createdAt: new Date().toISOString(),
        ...(action.agentMode !== undefined ? { agentMode: action.agentMode } : {}),
      };
      return enforceBoundedTranscriptWindow({
        ...state,
        messages: [...state.messages, userMessage],
        historyView: null,
        userMessageIndex: null,
        userMessageIndexEpoch: state.userMessageIndexEpoch + 1,
        runPhase: 'streaming',
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        activeRunPhaseUpdatedAt: null,
        streaming: true,
        runTerminal: { kind: 'none' },
        error: null,
        activeSkill: action.skill ?? null,
        pendingTurnModel: action.model ?? state.pendingTurnModel,
        workingSessionIds: state.activeSessionId
          ? { ...state.workingSessionIds, [state.activeSessionId]: true }
          : state.workingSessionIds,
        completedAttentionSessionIds: state.activeSessionId
          ? removeSessionIdMarker(state.completedAttentionSessionIds, state.activeSessionId)
          : state.completedAttentionSessionIds,
        failedAttentionSessionIds: state.activeSessionId
          ? removeSessionIdMarker(state.failedAttentionSessionIds, state.activeSessionId)
          : state.failedAttentionSessionIds,
      });
    }
    case 'user/steer': {
      const userMessage: ChatMessageUi = {
        id: action.clientMessageId,
        role: 'user',
        text: action.text,
        thinking: '',
        tools: [],
        attachments: action.attachments ?? [],
        ...(action.contextRefs && action.contextRefs.length > 0
          ? { contextRefs: action.contextRefs }
          : {}),
        status: 'done',
        createdAt: new Date().toISOString(),
        ...(action.instructionId && action.targetRunId
          ? {
              runId: action.targetRunId,
              instructionDelivery: {
                kind: 'run-intervention' as const,
                instructionId: action.instructionId,
                status: 'pending' as const,
                targetRunId: action.targetRunId,
                revision: 1,
              },
            }
          : {}),
      };
      // A steer is part of the already-active run. Keep run ownership and
      // phase intact while placing the instruction in the visible chain.
      return enforceBoundedTranscriptWindow({
        ...state,
        messages: [...state.messages, userMessage],
        historyView: null,
        userMessageIndex: null,
        userMessageIndexEpoch: state.userMessageIndexEpoch + 1,
        error: null,
      });
    }
    case 'user/send-rollback': {
      const remainingMessages = state.messages.filter(
        (message) => message.id !== action.clientMessageId,
      );
      if (remainingMessages.length === state.messages.length) {
        return state;
      }
      // Only clear streaming if this optimistic bubble was the latest send and
      // no host run has been accepted yet for the turn.
      const shouldClearStreaming =
        state.streaming && state.activeRunId === null && state.runPhase === 'streaming';
      return {
        ...state,
        messages: remainingMessages,
        pendingTurnModel: shouldClearStreaming ? null : state.pendingTurnModel,
        ...(shouldClearStreaming
          ? {
              runPhase: 'idle' as const,
              streaming: false,
              activeRunPhase: null,
              activeRunPhaseDetail: null,
              activeRunStartedAt: null,
              activeRunPhaseUpdatedAt: null,
              activeSkill: null,
              workingSessionIds: removeWorkingSessionId(
                state.workingSessionIds,
                state.activeSessionId,
              ),
            }
          : {}),
      };
    }
    case 'run/pausing':
      return {
        ...state,
        runPhase: 'pausing',
        streaming: false,
        workingSessionIds:
          state.activeSessionId === null
            ? state.workingSessionIds
            : removeWorkingSessionId(state.workingSessionIds, state.activeSessionId),
      };
    case 'run/pause-failed':
      if (state.runPhase !== 'pausing') {
        return state;
      }
      return {
        ...state,
        runPhase: 'streaming',
        streaming: true,
        workingSessionIds:
          state.activeSessionId === null
            ? state.workingSessionIds
            : { ...state.workingSessionIds, [state.activeSessionId]: true },
      };
    case 'run/aborting':
      return {
        ...state,
        runPhase: 'aborting',
        streaming: false,
        workingSessionIds:
          state.activeSessionId === null
            ? state.workingSessionIds
            : removeWorkingSessionId(state.workingSessionIds, state.activeSessionId),
      };
    case 'run/abort-failed':
      if (state.runPhase !== 'aborting') {
        return state;
      }
      // Abort request failed — run is still live. Re-enable Stop.
      return {
        ...state,
        runPhase: 'streaming',
        streaming: true,
        workingSessionIds:
          state.activeSessionId === null
            ? state.workingSessionIds
            : { ...state.workingSessionIds, [state.activeSessionId]: true },
      };
    case 'run/accepted':
      if (action.sessionId !== undefined && state.activeSessionId !== action.sessionId) {
        return {
          ...state,
          workingSessionIds: { ...state.workingSessionIds, [action.sessionId]: true },
          runRecordsById: {
            ...state.runRecordsById,
            [action.runId]: {
              runId: action.runId,
              phaseHistory: [{ phase: 'accepted', at: Date.now() }],
              startedAt: action.acceptedAt ? parseAcceptedAt(action.acceptedAt) : Date.now(),
              endedAt: null,
            },
          },
        };
      }
      if (state.activeRunId !== null && state.activeRunId !== action.runId) {
        return state;
      }
      {
        const startedAt = action.acceptedAt ? parseAcceptedAt(action.acceptedAt) : Date.now();
        const previous = state.runRecordsById[action.runId];
        return {
          ...state,
          activeRunId: action.runId,
          activeRunPhase: 'accepted',
          activeRunStartedAt: startedAt,
          activeRunPhaseUpdatedAt: startedAt,
          lastTerminalRunId: null,
          runPhase: 'streaming',
          streaming: true,
          runTerminal: { kind: 'none' },
          runRecordsById: {
            ...state.runRecordsById,
            [action.runId]: {
              runId: action.runId,
              phaseHistory: previous?.phaseHistory ?? [{ phase: 'accepted', at: startedAt }],
              startedAt: previous?.startedAt ?? startedAt,
              endedAt: previous?.endedAt ?? null,
              ...(previous?.outcome ? { outcome: previous.outcome } : {}),
              ...(previous?.terminalMessage ? { terminalMessage: previous.terminalMessage } : {}),
            },
          },
        };
      }
    case 'foreground/admission':
      return { ...state, foregroundAdmission: action.admission };
    case 'run/updated':
      if (state.activeSessionId !== action.run.sessionId) {
        return applyBackgroundSessionTurnWorkingMarker(state, action.run);
      }
      return applyRunRecord(state, action.run, false);
    case 'run/terminal':
      if (state.activeSessionId !== action.run.sessionId) {
        // Terminal pushes are global. A run can finish after the user has
        // switched sessions, so still clear its background working marker and
        // optionally mark the session as needing attention.
        if (action.run.kind !== 'session-turn') {
          return state;
        }
        const nextWorking = removeWorkingSessionId(state.workingSessionIds, action.run.sessionId);
        // Only completed / failed turns leave a sticky "done" marker.
        // Cancelled and interrupted runs already communicate stop intent and
        // should not keep demanding attention in the sidebar. Completed and
        // failed route to separate markers so the sidebar node can tell them
        // apart (Inkstone six-state vocabulary).
        return {
          ...state,
          workingSessionIds: nextWorking,
          completedAttentionSessionIds:
            action.run.status === 'completed'
              ? { ...state.completedAttentionSessionIds, [action.run.sessionId]: true }
              : removeSessionIdMarker(state.completedAttentionSessionIds, action.run.sessionId),
          failedAttentionSessionIds:
            action.run.status === 'failed'
              ? { ...state.failedAttentionSessionIds, [action.run.sessionId]: true }
              : removeSessionIdMarker(state.failedAttentionSessionIds, action.run.sessionId),
        };
      }
      {
        const terminalState = applyRunRecord(state, action.run, true);
        return enforceBoundedTranscriptWindow({
          ...terminalState,
          messages: withoutEmptyAssistantPlaceholders(terminalState.messages),
        });
      }
    case 'run/stale-clear': {
      // Reconciliation only ever clears stale liveness; it never invents a
      // terminal outcome. Without an authoritative record the thread returns
      // to its resting state and the sidebar marker drops.
      if (state.activeSessionId !== null && state.activeSessionId !== action.sessionId) {
        return {
          ...state,
          workingSessionIds: removeWorkingSessionId(state.workingSessionIds, action.sessionId),
        };
      }
      if (state.runPhase === 'idle') {
        return {
          ...state,
          workingSessionIds: removeWorkingSessionId(state.workingSessionIds, action.sessionId),
        };
      }
      return {
        ...state,
        runPhase: 'idle',
        streaming: false,
        activeRunId: null,
        activeRunPhase: null,
        activeRunPhaseDetail: null,
        activeRunStartedAt: null,
        activeRunPhaseUpdatedAt: null,
        lastTerminalRunId: null,
        activeSkill: null,
        workingSessionIds: removeWorkingSessionId(state.workingSessionIds, action.sessionId),
      };
    }
    case 'run/intervention-updated': {
      if (state.activeSessionId !== action.intervention.sessionId) return state;
      const delivery: NonNullable<SessionTranscriptMessage['instructionDelivery']> = {
        kind: 'run-intervention',
        instructionId: action.intervention.interventionId,
        status: action.intervention.status,
        targetRunId: action.intervention.runId,
        revision: action.intervention.revision,
      };
      const messageIndex = state.messages.findIndex(
        (message) => message.id === action.intervention.userMessageId,
      );
      if (messageIndex < 0) return state;
      const messages = [...state.messages];
      const previous = messages[messageIndex];
      if (!previous) return state;
      if (
        previous.instructionDelivery?.kind === 'run-intervention' &&
        previous.instructionDelivery.instructionId === action.intervention.interventionId &&
        previous.instructionDelivery.revision > action.intervention.revision
      ) {
        // Pushes are normally sequenced, but an ACK/replay can race a newer
        // lifecycle push. Intervention revisions are monotonic; never regress
        // an edited, applied, or terminal row to an older projection.
        return state;
      }
      messages[messageIndex] = {
        ...previous,
        text: action.intervention.input.text,
        runId: action.intervention.runId,
        instructionDelivery: delivery,
      };
      return { ...state, messages };
    }
    case 'run/terminal-dismiss':
      return {
        ...state,
        runTerminal: { kind: 'none' },
      };
    default:
      return state;
  }
}
