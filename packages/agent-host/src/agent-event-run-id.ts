/**
 * Stamp product Run identity onto Agent events before they leave agent-host.
 */

import type { AgentEvent } from '@piwin/contracts';
import { agentFailureFromPiFacts } from './pi-agent-failure.js';

export class AgentEventRunIdMismatchError extends Error {
  readonly name = 'AgentEventRunIdMismatchError';
  constructor(
    readonly eventRunId: string,
    readonly expectedRunId: string,
  ) {
    super(`worker event runId ${eventRunId} does not match frame runId ${expectedRunId}`);
  }
}

type UnownedAgentEventType =
  | 'session/started'
  | 'session/ended'
  | 'usage/update'
  | 'memory/extraction_start'
  | 'memory/extraction_end';

export type AgentEventWithRunId = Exclude<AgentEvent, { type: UnownedAgentEventType }>;

export function canCarryAgentEventRunId(event: AgentEvent): event is AgentEventWithRunId {
  return (
    event.type !== 'session/started' &&
    event.type !== 'session/ended' &&
    event.type !== 'usage/update' &&
    event.type !== 'memory/extraction_start' &&
    event.type !== 'memory/extraction_end'
  );
}

export function stampAgentEventRunId(event: AgentEvent, runId: string): AgentEvent {
  if (!canCarryAgentEventRunId(event)) {
    return event;
  }
  const existing = 'runId' in event && typeof event.runId === 'string' ? event.runId : undefined;
  if (existing !== undefined && existing !== runId) {
    throw new AgentEventRunIdMismatchError(existing, runId);
  }
  if (event.type === 'error') {
    const failure = event.failure ?? agentFailureFromPiFacts({ errorMessage: event.message });
    return {
      ...event,
      runId,
      failure,
      retriable: event.retriable ?? failure.retriable,
    };
  }
  return { ...event, runId };
}

export function stampAgentEventRunIdIfPresent(
  event: AgentEvent,
  runId: string | undefined,
): AgentEvent {
  return runId === undefined ? event : stampAgentEventRunId(event, runId);
}

/**
 * Stamp for publication. A mismatched event runId is dropped — Host must not
 * guess the current Run, and the prompt outcome still carries the failure.
 */
export function stampPublishedAgentEvent(
  event: AgentEvent,
  runId: string | undefined,
): AgentEvent | undefined {
  if (runId === undefined) {
    return event;
  }
  try {
    return stampAgentEventRunId(event, runId);
  } catch (error) {
    if (error instanceof AgentEventRunIdMismatchError) {
      return undefined;
    }
    throw error;
  }
}
