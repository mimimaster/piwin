/**
 * Observe one Pi prompt's native events and return the final AgentPromptOutcome.
 * Intermediate native retries are ignored until the last settled attempt.
 */

import {
  completedAgentPromptOutcome,
  failedAgentPromptOutcome,
  mapNativeStopReason,
  type AgentPromptOutcome,
} from '@piwin/contracts';
import { agentFailureFromPiEvent } from './pi-agent-failure.js';
import { asRecord, readString, readUpstreamErrorMessage } from './pi-event-read.js';

export type PiPromptOutcomeTracker = {
  observe(raw: unknown): void;
  finalize(): AgentPromptOutcome;
};

export function createPiPromptOutcomeTracker(): PiPromptOutcomeTracker {
  let sawAgentStart = false;
  let latestStopReason: string | undefined;
  let latestSources: unknown[] = [];

  const startAttempt = (): void => {
    latestStopReason = undefined;
    latestSources = [];
  };

  const recordAssistantStop = (source: Record<string, unknown>): void => {
    const stopReason = readString(source.stopReason);
    if (stopReason === undefined) {
      return;
    }
    if (stopReason === latestStopReason) {
      latestSources = [...latestSources, source];
      return;
    }
    latestStopReason = stopReason;
    latestSources = [source];
  };

  return {
    observe(raw: unknown): void {
      const event = asRecord(raw);
      if (!event) {
        return;
      }
      const type = readString(event.type);
      if (type === 'agent_start' || type === 'auto_retry_start') {
        if (type === 'agent_start') {
          sawAgentStart = true;
        }
        startAttempt();
        return;
      }
      if (type === 'message_end') {
        const message = asRecord(event.message) ?? asRecord(event.assistantMessage) ?? event;
        if (readString(message.role) === 'assistant' || readString(event.role) === 'assistant') {
          recordAssistantStop(message);
        }
        return;
      }
      if (type === 'agent_end') {
        const messages = Array.isArray(event.messages) ? event.messages : [];
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          const message = asRecord(messages[index]);
          if (message?.role !== 'assistant') {
            continue;
          }
          recordAssistantStop(message);
          break;
        }
      }
    },

    finalize(): AgentPromptOutcome {
      if (latestStopReason !== undefined) {
        const failure =
          latestSources.length > 0 ? agentFailureFromPiEvent(...latestSources) : undefined;
        const message =
          latestSources.length > 0 ? readUpstreamErrorMessage(...latestSources) : undefined;
        return mapNativeStopReason(
          latestStopReason,
          failure === undefined && message === undefined
            ? undefined
            : {
                ...(failure === undefined ? {} : { failure }),
                ...(message === undefined ? {} : { message }),
              },
        );
      }
      if (!sawAgentStart) {
        return completedAgentPromptOutcome('handled');
      }
      return failedAgentPromptOutcome({
        code: 'backend-protocol-error',
        origin: 'protocol',
        message: 'Pi prompt settled without a native stopReason',
        retriable: false,
      });
    },
  };
}

export async function runTrackedPiPrompt(input: {
  prompt: () => Promise<void>;
  subscribe: (listener: (raw: unknown) => void) => () => void;
}): Promise<AgentPromptOutcome> {
  const tracker = createPiPromptOutcomeTracker();
  const unsubscribe = input.subscribe((raw) => {
    tracker.observe(raw);
  });
  try {
    await input.prompt();
    return tracker.finalize();
  } finally {
    unsubscribe();
  }
}
