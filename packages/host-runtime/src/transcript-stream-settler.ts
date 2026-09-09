import type {
  AgentFailure,
  AgentPromptStopReason,
  RunInterventionRecord,
  RunInterventionTerminalReason,
  SessionRunOutcome,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import { createUnknownAgentFailure } from '@piwin/contracts';
import type { SessionTranscriptStore } from '@piwin/session';

export const ORPHAN_STREAM_TERMINAL_MESSAGE =
  'The previous run was interrupted before this response finished.';

export async function settleStreamingMessages(
  store: SessionTranscriptStore,
  input: {
    runId?: string;
    outcome: SessionRunOutcome;
    terminalMessage?: string;
    failure?: AgentFailure | null;
    agentStopReason?: AgentPromptStopReason;
    updatedAt?: string;
  },
): Promise<SessionTranscriptMessage[]> {
  return store.settleStreamingMessages({
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    outcome: input.outcome,
    ...(input.terminalMessage !== undefined ? { terminalMessage: input.terminalMessage } : {}),
    ...(input.failure !== undefined ? { failure: input.failure } : {}),
    ...(input.agentStopReason !== undefined ? { agentStopReason: input.agentStopReason } : {}),
  });
}

export async function settleOrphanStreamingMessages(
  store: SessionTranscriptStore,
): Promise<SessionTranscriptMessage[]> {
  return settleStreamingMessages(store, {
    outcome: 'cancelled',
    terminalMessage: ORPHAN_STREAM_TERMINAL_MESSAGE,
  });
}

export async function finalizeRunTranscriptArtifacts(
  store: SessionTranscriptStore,
  input: {
    runId: string;
    outcome: SessionRunOutcome;
    interventionReason: RunInterventionTerminalReason;
    terminalMessage?: string;
    failure?: AgentFailure | null;
    agentStopReason?: AgentPromptStopReason;
  },
): Promise<{ settled: SessionTranscriptMessage[]; expired: RunInterventionRecord[] }> {
  const fallbackFailureMessage =
    input.terminalMessage ?? `Run ${input.runId} failed before structured failure was recorded.`;
  const failedFailure =
    input.outcome === 'failed'
      ? (input.failure ?? createUnknownAgentFailure(fallbackFailureMessage))
      : undefined;
  const settled = await settleStreamingMessages(store, {
    runId: input.runId,
    outcome: input.outcome,
    ...(input.terminalMessage !== undefined ? { terminalMessage: input.terminalMessage } : {}),
    ...(failedFailure !== undefined
      ? { failure: failedFailure }
      : input.failure !== undefined
        ? { failure: input.failure }
        : {}),
    ...(input.agentStopReason !== undefined ? { agentStopReason: input.agentStopReason } : {}),
  });
  const expired = await store.expirePendingRunInterventions(
    input.runId,
    input.interventionReason,
    new Date().toISOString(),
  );
  if (failedFailure !== undefined) {
    const ensured = await store.ensureFailedRunAssistant({
      runId: input.runId,
      updatedAt: new Date().toISOString(),
      terminalMessage: input.terminalMessage ?? failedFailure.message,
      failure: failedFailure,
    });
    const withoutDuplicate = settled.filter((message) => message.id !== ensured.id);
    return { settled: [...withoutDuplicate, ensured], expired };
  }
  return { settled, expired };
}
