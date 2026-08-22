import type { AgentEvent, ModelRef } from '@piwin/contracts';

/**
 * Pin the session's current model onto assistant `message/start` events.
 * Downstream shells must not backfill historic rows from the composer picker.
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
