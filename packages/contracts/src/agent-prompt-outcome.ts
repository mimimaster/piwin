/**
 * Final result of one Agent session prompt after Pi (and native retry) settle.
 * No Pi imports — native stop-reason strings are mapped by name only.
 */

import {
  createUnknownAgentFailure,
  isAgentFailure,
  type AgentFailure,
  normalizeAgentFailure,
} from './agent-failure.js';

export type AgentCompletedStopReason = 'stop' | 'length' | 'toolUse' | 'handled';
export type AgentFailedStopReason = 'error';
export type AgentAbortedStopReason = 'aborted';
export type AgentPromptStopReason =
  AgentCompletedStopReason | AgentFailedStopReason | AgentAbortedStopReason;

export type AgentPromptOutcome =
  | {
      status: 'completed';
      stopReason: AgentCompletedStopReason;
    }
  | {
      status: 'failed';
      stopReason: 'error';
      failure: AgentFailure;
    }
  | {
      status: 'aborted';
      stopReason: 'aborted';
      message?: string;
    };

export const COMPLETED_STOP_OUTCOME: AgentPromptOutcome = {
  status: 'completed',
  stopReason: 'stop',
};

export const ABORTED_PROMPT_OUTCOME: AgentPromptOutcome = {
  status: 'aborted',
  stopReason: 'aborted',
};

const COMPLETED_REASONS: ReadonlySet<string> = new Set(['stop', 'length', 'toolUse', 'handled']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isAgentPromptOutcome(value: unknown): value is AgentPromptOutcome {
  if (
    !isRecord(value) ||
    typeof value.status !== 'string' ||
    typeof value.stopReason !== 'string'
  ) {
    return false;
  }
  if (value.status === 'completed') {
    return COMPLETED_REASONS.has(value.stopReason);
  }
  if (value.status === 'failed') {
    return value.stopReason === 'error' && isAgentFailure(value.failure);
  }
  if (value.status === 'aborted') {
    return (
      value.stopReason === 'aborted' &&
      (value.message === undefined || typeof value.message === 'string')
    );
  }
  return false;
}

export function completedAgentPromptOutcome(
  stopReason: AgentCompletedStopReason,
): AgentPromptOutcome {
  return { status: 'completed', stopReason };
}

export function failedAgentPromptOutcome(failure: AgentFailure): AgentPromptOutcome {
  return {
    status: 'failed',
    stopReason: 'error',
    failure: normalizeAgentFailure(failure, failure.message),
  };
}

export function abortedAgentPromptOutcome(message?: string): AgentPromptOutcome {
  return message === undefined
    ? ABORTED_PROMPT_OUTCOME
    : { status: 'aborted', stopReason: 'aborted', message };
}

/**
 * Map a native Pi-like stopReason string. Unexpected values become
 * `backend-protocol-error` and never silently complete.
 */
export function mapNativeStopReason(
  stopReason: string,
  options?: { failure?: AgentFailure; message?: string },
): AgentPromptOutcome {
  if (
    stopReason === 'stop' ||
    stopReason === 'length' ||
    stopReason === 'toolUse' ||
    stopReason === 'handled'
  ) {
    return completedAgentPromptOutcome(stopReason);
  }
  if (stopReason === 'aborted') {
    return abortedAgentPromptOutcome(options?.message);
  }
  if (stopReason === 'error') {
    return failedAgentPromptOutcome(
      options?.failure ?? createUnknownAgentFailure(options?.message ?? 'native stopReason: error'),
    );
  }
  return failedAgentPromptOutcome({
    code: 'backend-protocol-error',
    origin: 'protocol',
    message: options?.message ?? `unexpected native stopReason: ${stopReason}`,
    retriable: false,
  });
}
