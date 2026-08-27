import type { AgentEvent, AgentMessageRole } from '@piwin/contracts';
import { mapAgentEndProviderFailures, mapStandalonePiErrorEvent } from './agent-failure-map.js';
import {
  mapAgentEndFallbackUsageEvent,
  mapAgentEndMessageUsageEvents,
  mapPiUsageEvent,
} from './agent-usage-map.js';
import {
  filterDuplicateSearchEvidence,
  mapMessageEndEvent,
  mapMessageStartEvent,
  mapMessageUpdateEvent,
} from './message-event-map.js';
import { buildNativeContextEvent } from './native-context-event-map.js';
import { mapCompactionEndEvent } from './compaction-event-map.js';
import { mapPiAutoRetryEvent } from './model-retry-event-map.js';
import { readNestedId, readNestedRole, readRole, readString } from './pi-event-read.js';
import {
  enrichMappedToolEvent,
  mapToolExecutionEndEvent,
  mapToolExecutionStartEvent,
  mapToolExecutionUpdateEvent,
  type ToolPresentationSeed,
} from './tool-event-map.js';

export type PiSessionEventMapper = {
  map: (raw: unknown) => AgentEvent[];
  reset?: () => void;
};

export function createPiSessionEventMapper(): PiSessionEventMapper {
  let activeMessageId: string | null = null;
  let activeMessageRole: AgentMessageRole | null = null;
  let lastAssistantMessageId: string | null = null;
  let generatedMessageSequence = 0;
  const toolNamesById = new Map<string, string>();
  const presentationSeedsByToolId = new Map<string, ToolPresentationSeed>();
  const responseMessageIdsByToolId = new Map<string, string>();
  const rawToolOutputById = new Map<string, string>();
  const citationUrlsByMessageId = new Map<string, Set<string>>();
  const surfacedProviderErrorMessages = new Set<string>();
  const streamedThinkingMessageIds = new Set<string>();
  let retryLifecycleActive = false;

  const reset = (): void => {
    activeMessageId = null;
    activeMessageRole = null;
    lastAssistantMessageId = null;
    toolNamesById.clear();
    presentationSeedsByToolId.clear();
    responseMessageIdsByToolId.clear();
    rawToolOutputById.clear();
    citationUrlsByMessageId.clear();
    surfacedProviderErrorMessages.clear();
    streamedThinkingMessageIds.clear();
    retryLifecycleActive = false;
  };

  return {
    reset,
    map(raw: unknown): AgentEvent[] {
      if (!raw || typeof raw !== 'object') {
        return [];
      }

      const record = raw as Record<string, unknown>;
      const type = typeof record.type === 'string' ? record.type : '';
      if (type === 'auto_retry_start') {
        retryLifecycleActive = true;
      } else if (type === 'auto_retry_end') {
        retryLifecycleActive = false;
      } else if (type === 'agent_start' && !retryLifecycleActive) {
        surfacedProviderErrorMessages.clear();
      }
      if (type === 'message_start') {
        const explicitMessageId = readString(record.messageId) ?? readNestedId(record, 'message');
        activeMessageId = explicitMessageId ?? `pi-message-${++generatedMessageSequence}`;
        activeMessageRole =
          readRole(record.role) ?? readNestedRole(record, 'message') ?? 'assistant';
      }

      let mappedEvents: AgentEvent[] = mapPiSessionEvent(
        raw,
        activeMessageId,
        lastAssistantMessageId,
        activeMessageRole,
      )
        .flatMap((event) => filterDuplicateSearchEvidence(event, citationUrlsByMessageId))
        .filter((event) => {
          if (event.type !== 'error') {
            return true;
          }
          const key = event.message.trim();
          if (key.length === 0) {
            return true;
          }
          if (surfacedProviderErrorMessages.has(key)) {
            return false;
          }
          surfacedProviderErrorMessages.add(key);
          return true;
        })
        .map((event) =>
          enrichMappedToolEvent(event, record, {
            toolNamesById,
            presentationSeedsByToolId,
            responseMessageIdsByToolId,
            rawToolOutputById,
          }),
        );
      if (type === 'message_end') {
        mappedEvents = mappedEvents.filter((event) => {
          if (event.type !== 'message/thinking_delta') {
            return true;
          }
          return !streamedThinkingMessageIds.has(event.messageId);
        });
      } else {
        for (const event of mappedEvents) {
          if (event.type === 'message/thinking_delta' && event.delta.length > 0) {
            streamedThinkingMessageIds.add(event.messageId);
          }
        }
      }
      if (type === 'agent_end') {
        toolNamesById.clear();
        presentationSeedsByToolId.clear();
        responseMessageIdsByToolId.clear();
        rawToolOutputById.clear();
        streamedThinkingMessageIds.clear();
      }
      if (type === 'message_end') {
        const endedMessage = mappedEvents.find((event) => event.type === 'message/end');
        const endedMessageRole =
          readRole(record.role) ?? readNestedRole(record, 'message') ?? activeMessageRole;
        if (endedMessage?.type === 'message/end') {
          const nativeEvent = buildNativeContextEvent(
            record,
            endedMessage.messageId,
            lastAssistantMessageId,
          );
          if (nativeEvent !== undefined) {
            mappedEvents.push(nativeEvent);
          }
        }
        if (endedMessage?.type === 'message/end' && endedMessageRole === 'assistant') {
          lastAssistantMessageId = endedMessage.messageId;
          citationUrlsByMessageId.delete(endedMessage.messageId);
        }
        activeMessageId = null;
        activeMessageRole = null;
      }
      return mappedEvents;
    },
  };
}

export function mapPiSessionEvent(
  raw: unknown,
  activeMessageId?: string | null,
  lastAssistantMessageId?: string | null,
  activeMessageRole?: AgentMessageRole | null,
): AgentEvent[] {
  if (!raw || typeof raw !== 'object') {
    return [];
  }

  const event = raw as Record<string, unknown>;
  const type = typeof event.type === 'string' ? event.type : '';

  switch (type) {
    case 'message_start':
      return mapMessageStartEvent(event, activeMessageId);
    case 'message_update':
      return mapMessageUpdateEvent(event, activeMessageId);
    case 'message_end':
      return mapMessageEndEvent(event, activeMessageId, activeMessageRole);
    case 'tool_execution_start':
      return mapToolExecutionStartEvent(event, activeMessageId, lastAssistantMessageId);
    case 'tool_execution_update':
      return mapToolExecutionUpdateEvent(event, activeMessageId, lastAssistantMessageId);
    case 'tool_execution_end':
      return mapToolExecutionEndEvent(event, activeMessageId, lastAssistantMessageId);
    case 'auto_retry_start':
    case 'auto_retry_end':
      return mapPiAutoRetryEvent(event);
    case 'compaction_start':
      return [{ type: 'compaction/start' }];
    case 'compaction_end':
      return [mapCompactionEndEvent(event)];
    case 'error':
      return mapStandalonePiErrorEvent(event);
    case 'context_usage':
    case 'usage':
    case 'token_usage':
      return mapPiUsageEvent(event);
    case 'agent_end':
      return mapAgentEndEvent(event);
    default:
      return [];
  }
}

function mapAgentEndEvent(event: Record<string, unknown>): AgentEvent[] {
  const assistantUsageEvents = mapAgentEndMessageUsageEvents(event);
  const providerErrorEvents = mapAgentEndProviderFailures(event);
  if (assistantUsageEvents.length > 0 || providerErrorEvents.length > 0) {
    return [...assistantUsageEvents, ...providerErrorEvents];
  }
  return mapAgentEndFallbackUsageEvent(event);
}

export { mapCompactionEndEvent } from './compaction-event-map.js';

export {
  extractToolResultAttachments,
  extractToolResultHealthDetails,
  extractToolResultText,
} from './tool-result-extract.js';
