import type {
  AgentEvent,
  AgentEventEnvelope,
  ExecutionRunRecord,
  ModelRef,
} from '@piwin/contracts';
import { isRunTerminal } from '@piwin/contracts';
import { isAssistantContentEmpty } from './assistant-message-content';
import type { ChatMessageUi, ChatUiState } from './chat-ui-types';
import { shouldMarkTurnAttention } from './chat-reducer-attention';
import { removeSessionIdMarker, removeWorkingSessionId } from './chat-reducer-session-helpers';

/** C1: maximum event ids retained for replay detection per session. */
const MAX_RETAINED_EVENT_IDS = 10_000;
/** C1: when the event id ring exceeds the max, drop this many oldest entries. */
const EVENT_ID_TRIM_BATCH = 5_000;

export function envelopeRunKey(envelope: AgentEventEnvelope): string {
  return envelope.runId ?? '_global';
}

/**
 * Check whether an envelope represents a stale or replayed event.
 */
export function isEnvelopeStale(state: ChatUiState, envelope: AgentEventEnvelope): boolean {
  // Replay: eventId already seen
  if (state.receivedEventIds.has(envelope.eventId)) {
    return true;
  }
  // Stale: sequence not advancing
  const runKey = envelopeRunKey(envelope);
  const lastSeq = state.lastAcceptedSequenceByRun[runKey] ?? 0;
  if (envelope.sequence <= lastSeq) {
    return true;
  }
  return false;
}

/**
 * Record an envelope into the dedup state (bounded eventId ring + max sequence).
 */
export function recordEnvelope(state: ChatUiState, envelope: AgentEventEnvelope): ChatUiState {
  const runKey = envelopeRunKey(envelope);
  const lastSeq = state.lastAcceptedSequenceByRun[runKey] ?? 0;

  let nextReceivedEventIds = state.receivedEventIds;
  if (!nextReceivedEventIds.has(envelope.eventId)) {
    nextReceivedEventIds = new Set(nextReceivedEventIds);
    nextReceivedEventIds.add(envelope.eventId);
    // Bounded ring: drop oldest when over limit (Set keeps insertion order).
    if (nextReceivedEventIds.size > MAX_RETAINED_EVENT_IDS) {
      let toDrop = EVENT_ID_TRIM_BATCH;
      for (const oldestId of nextReceivedEventIds) {
        if (toDrop <= 0) break;
        nextReceivedEventIds.delete(oldestId);
        toDrop -= 1;
      }
    }
  }

  return {
    ...state,
    receivedEventIds: nextReceivedEventIds,
    lastAcceptedSequenceByRun: {
      ...state.lastAcceptedSequenceByRun,
      [runKey]: Math.max(lastSeq, envelope.sequence),
    },
  };
}

/**
 * Extract optional envelope from an event action and check for staleness.
 * Returns true when the event should be dropped.
 */
export function isStaleByEnvelope(
  state: ChatUiState,
  action: { event: AgentEvent } & Record<string, unknown>,
): boolean {
  const envelope = action.envelope as AgentEventEnvelope | undefined;
  if (!envelope) {
    return false;
  }
  return isEnvelopeStale(state, envelope);
}

/**
 * Record the envelope from an event action into dedup state.
 * Returns the updated state (unchanged when no envelope present).
 */
export function recordEventEnvelope(
  state: ChatUiState,
  action: { event: AgentEvent } & Record<string, unknown>,
): ChatUiState {
  const envelope = action.envelope as AgentEventEnvelope | undefined;
  if (!envelope) {
    return state;
  }
  return recordEnvelope(state, envelope);
}

/**
 * Background `run/updated` must not paint another session's transcript, but it
 * still owns the sidebar spinner. Host may publish a terminal-shaped update
 * without a following `run/terminal` after the user has already switched away.
 */
export function applyBackgroundSessionTurnWorkingMarker(
  state: ChatUiState,
  run: ExecutionRunRecord,
): ChatUiState {
  if (run.kind !== 'session-turn') {
    return state;
  }
  const stopWorking =
    isRunTerminal(run.status) || run.status === 'cancelling' || run.phase === 'pausing';
  if (stopWorking) {
    const nextWorking = removeWorkingSessionId(state.workingSessionIds, run.sessionId);
    const nextCompletedAttention: Record<string, true> =
      run.status === 'completed' && shouldMarkTurnAttention(state, run.sessionId)
        ? { ...state.completedAttentionSessionIds, [run.sessionId]: true }
        : removeSessionIdMarker(state.completedAttentionSessionIds, run.sessionId);
    const nextFailedAttention: Record<string, true> =
      run.status === 'failed' && shouldMarkTurnAttention(state, run.sessionId)
        ? { ...state.failedAttentionSessionIds, [run.sessionId]: true }
        : removeSessionIdMarker(state.failedAttentionSessionIds, run.sessionId);
    if (
      nextWorking === state.workingSessionIds &&
      nextCompletedAttention === state.completedAttentionSessionIds &&
      nextFailedAttention === state.failedAttentionSessionIds
    ) {
      return state;
    }
    return {
      ...state,
      workingSessionIds: nextWorking,
      completedAttentionSessionIds: nextCompletedAttention,
      failedAttentionSessionIds: nextFailedAttention,
    };
  }
  if (run.status !== 'queued' && run.status !== 'running') {
    return state;
  }
  if (run.sessionId in state.workingSessionIds) {
    return state;
  }
  return {
    ...state,
    workingSessionIds: { ...state.workingSessionIds, [run.sessionId]: true },
  };
}

/**
 * Pause/Stop stay sticky until Host terminals the Run or the request fails.
 * Later live events (message/start, message/end, still-running run/updated)
 * must not put the sidebar spinner or "thinking" chrome back on.
 */
export function isUserControlInFlight(state: ChatUiState): boolean {
  return (
    state.runPhase === 'pausing' ||
    state.runPhase === 'aborting' ||
    state.activeRunPhase === 'pausing'
  );
}

/**
 * Frozen send-time model for the in-flight turn. Do not read the session
 * list / composer picker — those follow the next prompt, not this reply.
 */
export function resolveAssistantModelFallback(state: ChatUiState): ModelRef | undefined {
  return state.pendingTurnModel ?? undefined;
}

/** Pi ends the tool-call assistant row before tool/start. Keep it until the next answer. */
export function isEmptyAssistantPlaceholder(message: ChatMessageUi): boolean {
  return (
    message.status !== 'streaming' &&
    message.status !== 'error' &&
    !message.error &&
    message.failure === undefined &&
    isAssistantContentEmpty(message)
  );
}

export function withoutFailureEvidence(message: ChatMessageUi): ChatMessageUi {
  if (message.error === undefined && message.failure === undefined && message.status !== 'error') {
    return message;
  }
  const { error: _error, failure: _failure, ...rest } = message;
  return {
    ...rest,
    status: message.status === 'error' ? 'done' : message.status,
  };
}

export function withoutEmptyAssistantPlaceholders(
  messages: readonly ChatMessageUi[],
): ChatMessageUi[] {
  return messages.filter((message) => !isEmptyAssistantPlaceholder(message));
}

export function isStaleRunEvent(state: ChatUiState, runId: string): boolean {
  // Only drop frames that belong to a different live run. Trailing deltas
  // for a run can sit in the paint buffer when `run/terminal` used to
  // dispatch in the same JS turn; treating them as stale hid the whole reply
  // until transcript hydrate dumped it.
  return state.activeRunId !== null && state.activeRunId !== runId;
}

export function isStaleOptionalRunEvent(state: ChatUiState, runId: string | undefined): boolean {
  if (runId !== undefined) {
    return isStaleRunEvent(state, runId);
  }
  // Legacy foreground events have no run identity. Once a terminal state is
  // visible, accepting one would reopen a completed run in the transcript.
  return state.lastTerminalRunId !== null;
}
