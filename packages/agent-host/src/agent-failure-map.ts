import type { AgentEvent } from '@piwin/contracts';
import { asRecord, readString, readUpstreamErrorMessage } from './pi-event-read.js';

export function mapStandalonePiErrorEvent(event: Record<string, unknown>): AgentEvent[] {
  const message =
    readUpstreamErrorMessage(event) ??
    readString(event.message) ??
    readString(event.error) ??
    'unknown error';
  return [{ type: 'error', message, retriable: Boolean(event.retriable) }];
}

export function mapAssistantStopReasonFailure(
  endedMessage: Record<string, unknown> | null,
  rawEvent: Record<string, unknown>,
): AgentEvent | undefined {
  const stopReason = endedMessage ? readString(endedMessage.stopReason) : undefined;
  const errorMessage = readUpstreamErrorMessage(endedMessage, rawEvent);
  if (stopReason === 'error') {
    return {
      type: 'error',
      message: errorMessage ?? 'Model request failed',
    };
  }
  if (stopReason === 'aborted' && errorMessage) {
    return { type: 'error', message: errorMessage };
  }
  return undefined;
}

export function mapAgentEndProviderFailures(event: Record<string, unknown>): AgentEvent[] {
  if (!Array.isArray(event.messages)) {
    return [];
  }
  const providerErrorEvents: AgentEvent[] = [];
  for (const message of event.messages) {
    const assistantMessage = asRecord(message);
    if (assistantMessage?.role !== 'assistant') {
      continue;
    }
    const failure = mapAssistantStopReasonFailure(assistantMessage, assistantMessage);
    if (failure) {
      providerErrorEvents.push(failure);
    }
  }
  return providerErrorEvents;
}
