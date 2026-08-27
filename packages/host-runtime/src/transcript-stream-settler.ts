import type {
  RunInterventionRecord,
  RunInterventionTerminalReason,
  SessionRunOutcome,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import type { SessionTranscriptStore } from '@piwin/session';

export const ORPHAN_STREAM_TERMINAL_MESSAGE =
  'The previous run was interrupted before this response finished.';

export async function settleStreamingMessages(
  store: SessionTranscriptStore,
  input: {
    runId?: string;
    outcome: SessionRunOutcome;
    terminalMessage?: string;
    updatedAt?: string;
  },
): Promise<SessionTranscriptMessage[]> {
  return store.settleStreamingMessages({
    ...(input.runId !== undefined ? { runId: input.runId } : {}),
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    outcome: input.outcome,
    ...(input.terminalMessage !== undefined ? { terminalMessage: input.terminalMessage } : {}),
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
  },
): Promise<{ settled: SessionTranscriptMessage[]; expired: RunInterventionRecord[] }> {
  const settled = await settleStreamingMessages(store, {
    runId: input.runId,
    outcome: input.outcome,
    ...(input.terminalMessage !== undefined ? { terminalMessage: input.terminalMessage } : {}),
  });
  const expired = await store.expirePendingRunInterventions(
    input.runId,
    input.interventionReason,
    new Date().toISOString(),
  );
  return { settled, expired };
}
