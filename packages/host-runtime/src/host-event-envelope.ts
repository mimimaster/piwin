import type { AgentEventEnvelope } from '@piwin/contracts';

/**
 * Host egress is the only producer of AgentEventEnvelope (PTA-17).
 * agent-host returns plain AgentEvent values.
 */
export function createEventEnvelopeGenerator(runId?: string): {
  next: (runIdOverride?: string) => AgentEventEnvelope;
} {
  let sequence = 0;
  return {
    next(runIdOverride?: string): AgentEventEnvelope {
      sequence += 1;
      const envelope: AgentEventEnvelope = {
        eventId: `evt-${Date.now().toString(36)}-${String(sequence)}`,
        sequence,
      };
      const resolvedRunId = runIdOverride ?? runId;
      if (resolvedRunId !== undefined) {
        envelope.runId = resolvedRunId;
      }
      return envelope;
    },
  };
}
