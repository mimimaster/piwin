import type { AgentEvent } from './host.js';
import { normalizeAgentErrorEvent } from './agent-failure.js';

/** Compatibility decode for released frames that omit `failure`. */
export function normalizeDecodedAgentEvent(event: AgentEvent): AgentEvent {
  return event.type === 'error' ? normalizeAgentErrorEvent(event) : event;
}
