import type { AgentEvent, ModelRef } from '@piwin/contracts';

/**
 * Pin the session's last-applied runtime model onto assistant `message/start`.
 * That snapshot is the generation identity for the row.
 */
export function enrichAgentEventSessionModel(
  event: AgentEvent,
  model: ModelRef | undefined,
): AgentEvent {
  if (event.type !== 'message/start' || event.role !== 'assistant' || !model) {
    return event;
  }
  if (event.model) {
    return event;
  }
  return { ...event, model };
}
