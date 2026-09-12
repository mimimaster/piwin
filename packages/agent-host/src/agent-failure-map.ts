import type { AgentEvent } from '@piwin/contracts';
import { asRecord, readString, readUpstreamErrorMessage } from './pi-event-read.js';
import { agentFailureFromPiEvent } from './pi-agent-failure.js';

export function mapStandalonePiErrorEvent(event: Record<string, unknown>): AgentEvent[] {
  const message =
    readUpstreamErrorMessage(event) ??
    readString(event.message) ??
    readString(event.error) ??
    'unknown error';
  const failure = agentFailureFromPiEvent(event, { errorMessage: message });
  return [
    {
      type: 'error',
      message: failure.message,
      retriable: event.retriable === undefined ? failure.retriable : Boolean(event.retriable),
      failure,
    },
  ];
}

export function mapAssistantStopReasonFailure(
  endedMessage: Record<string, unknown> | null,
  rawEvent: Record<string, unknown>,
): AgentEvent | undefined {
  const stopReason = endedMessage ? readString(endedMessage.stopReason) : undefined;
  const errorMessage = readUpstreamErrorMessage(endedMessage, rawEvent);
  if (stopReason === 'error') {
    const failure = agentFailureFromPiEvent(
      endedMessage ?? {},
      rawEvent,
      { errorMessage: errorMessage ?? 'Model request failed' },
    );
    return {
      type: 'error',
      message: failure.message,
      retriable: failure.retriable,
      failure,
    };
  }
  // aborted is a lifecycle outcome. Host classifies user-stop / pause /
  // superseded vs a true provider abort. Emitting error here double-fires
  // a red failure after the Host already handled aborted.
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
