import type { AgentEvent, AgentEventEnvelope, AgentMessageRole } from '@piwin/contracts';
import { mapUsageSnapshot } from './usage-map.js';
import { boundToolOutput, buildToolPresentation } from './tool-presentation.js';

/**
 * Wrapped event with an envelope for idempotent delivery.
 * The envelope carries a unique eventId and ascending sequence number so the
 * consumer can detect replayed, reordered, or stale events.
 */
export type WrappedAgentEvent = {
  event: AgentEvent;
  envelope: AgentEventEnvelope;
};

/**
 * Creates a sequential envelope generator scoped to an optional runId.
 * Each call to `next()` produces a monotonically increasing sequence number
 * paired with a unique eventId.
 */
export function createEventEnvelopeGenerator(runId?: string): {
  next: (runIdOverride?: string) => AgentEventEnvelope;
} {
  let sequence = 0;
  return {
    next(runIdOverride?: string): AgentEventEnvelope {
      sequence++;
      const envelope: AgentEventEnvelope = {
        eventId: `evt-${Date.now().toString(36)}-${sequence}`,
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

/**
 * Wraps a single AgentEvent with the next envelope from a generator.
 */
export function wrapEvent(
  event: AgentEvent,
  envelopeGenerator: ReturnType<typeof createEventEnvelopeGenerator>,
): WrappedAgentEvent {
  return {
    event,
    envelope: envelopeGenerator.next(),
  };
}

/**
 * Wraps an array of AgentEvent objects with sequential envelopes.
 */
export function wrapEvents(
  events: AgentEvent[],
  envelopeGenerator: ReturnType<typeof createEventEnvelopeGenerator>,
): WrappedAgentEvent[] {
  return events.map((event) => ({
    event,
    envelope: envelopeGenerator.next(extractRunId(event)),
  }));
}

/**
 * Extract a runId from an event if it has one, for envelope scoping.
 */
function extractRunId(event: AgentEvent): string | undefined {
  return 'runId' in event ? (event as { runId?: string }).runId : undefined;
}

export type PiSessionEventMapper = {
  map: (raw: unknown) => WrappedAgentEvent[];
};

/**
 * Pi can omit message ids on SDK lifecycle events. The mapper must keep the
 * generated id for the whole message lifecycle; a constant fallback such as
 * "unknown" merges separate thinking/tool turns in the renderer.
 *
 * Returned events are wrapped with sequential envelopes for idempotent delivery.
 */
export function createPiSessionEventMapper(): PiSessionEventMapper {
  let activeMessageId: string | null = null;
  let generatedMessageSequence = 0;
  const toolNamesById = new Map<string, string>();
  const rawToolOutputById = new Map<string, string>();
  const envelopeGenerator = createEventEnvelopeGenerator();

  return {
    map(raw: unknown): WrappedAgentEvent[] {
      if (!raw || typeof raw !== 'object') {
        return [];
      }

      const record = raw as Record<string, unknown>;
      const type = typeof record.type === 'string' ? record.type : '';
      if (type === 'message_start') {
        const explicitMessageId = readString(record.messageId) ?? readNestedId(record, 'message');
        activeMessageId =
          explicitMessageId ?? `pi-message-${++generatedMessageSequence}`;
      }

      const mappedEvents = mapPiSessionEvent(raw, activeMessageId).map((event) => {
        if (event.type === 'tool/start') {
          toolNamesById.set(event.toolCallId, event.toolName);
          rawToolOutputById.set(event.toolCallId, '');
          return event;
        }
        if (event.type === 'tool/update') {
          const rawEvent = raw as Record<string, unknown>;
          const rawDelta =
            typeof rawEvent.delta === 'string'
              ? rawEvent.delta
              : typeof rawEvent.output === 'string'
                ? rawEvent.output
                : event.delta;
          const fullOutput = `${rawToolOutputById.get(event.toolCallId) ?? ''}${rawDelta}`;
          // Keep the cross-chunk redaction buffer bounded. This still preserves
          // enough cumulative context to catch secrets split across chunks,
          // while preventing a long-running tool from growing host memory.
          const boundedOutput = boundToolOutput(fullOutput).text;
          rawToolOutputById.set(event.toolCallId, boundedOutput);
          const toolName = toolNamesById.get(event.toolCallId) ?? 'unknown';
          return {
            ...event,
            presentation: buildToolPresentation({
              toolName,
              outputText: boundedOutput,
            }),
          };
        }
        if (event.type === 'tool/end') {
          toolNamesById.delete(event.toolCallId);
          rawToolOutputById.delete(event.toolCallId);
        }
        return event;
      });
      if (type === 'message_end') {
        activeMessageId = null;
      }
      return wrapEvents(mappedEvents, envelopeGenerator);
    },
  };
}

/**
 * Map Pi SDK / RPC-like session events into normalized AgentEvent[].
 * Defensive: unknown shapes return [] (never throw).
 */
export function mapPiSessionEvent(raw: unknown, activeMessageId?: string | null): AgentEvent[] {
  if (!raw || typeof raw !== 'object') {
    return [];
  }

  const event = raw as Record<string, unknown>;
  const type = typeof event.type === 'string' ? event.type : '';

  switch (type) {
    case 'message_start': {
      const messageId =
        readString(event.messageId) ??
        readNestedId(event, 'message') ??
        activeMessageId ??
        'unknown';
      const role = readRole(event.role) ?? readNestedRole(event, 'message') ?? 'assistant';
      return [{ type: 'message/start', messageId, role }];
    }
    case 'message_update': {
      const messageId = readString(event.messageId) ?? activeMessageId ?? 'unknown';
      const assistantEvent = asRecord(event.assistantMessageEvent);
      if (!assistantEvent) {
        return [];
      }
      const assistantType = readString(assistantEvent.type);
      const delta = readString(assistantEvent.delta) ?? '';
      if (assistantType === 'text_delta') {
        return [{ type: 'message/text_delta', messageId, delta }];
      }
      if (assistantType === 'thinking_delta') {
        return [{ type: 'message/thinking_delta', messageId, delta }];
      }
      return [];
    }
    case 'message_end': {
      const messageId =
        readString(event.messageId) ??
        readNestedId(event, 'message') ??
        activeMessageId ??
        'unknown';
      return [{ type: 'message/end', messageId }];
    }
    case 'tool_execution_start': {
      const toolCallId = readString(event.toolCallId) ?? readString(event.id) ?? 'unknown';
      const toolName = readString(event.toolName) ?? readString(event.name) ?? 'unknown';
      const args = event.args ?? event.arguments ?? event.input;
      const presentation = buildToolPresentation({
        toolName,
        ...(args !== undefined ? { args } : {}),
      });
      return [{ type: 'tool/start', toolCallId, toolName, presentation }];
    }
    case 'tool_execution_update': {
      const toolCallId = readString(event.toolCallId) ?? readString(event.id) ?? 'unknown';
      const rawDelta = readString(event.delta) ?? readString(event.output) ?? '';
      const delta = boundToolOutput(rawDelta).text;
      return [{ type: 'tool/update', toolCallId, delta }];
    }
    case 'tool_execution_end': {
      const toolCallId = readString(event.toolCallId) ?? readString(event.id) ?? 'unknown';
      const isError = Boolean(event.isError ?? event.error);
      const toolName = readString(event.toolName) ?? readString(event.name) ?? 'unknown';
      const outputText =
        readString(event.output) ??
        readString(event.result) ??
        readString(event.delta) ??
        undefined;
      const exitCode =
        typeof event.exitCode === 'number'
          ? event.exitCode
          : typeof event.exit_code === 'number'
            ? event.exit_code
            : undefined;
      const presentation = buildToolPresentation({
        toolName,
        isError,
        ...(outputText !== undefined ? { outputText } : {}),
        ...(exitCode !== undefined ? { exitCode } : {}),
      });
      return [{ type: 'tool/end', toolCallId, isError, presentation }];
    }
    case 'compaction_start':
      return [{ type: 'compaction/start' }];
    case 'compaction_end': {
      // Pi 0.80: { type, reason, result?: CompactionResult, aborted, willRetry, errorMessage? }
      // CompactionResult: { summary, tokensBefore, estimatedTokensAfter?, firstKeptEntryId }
      return [mapCompactionEndEvent(event)];
    }
    case 'error': {
      const message = readString(event.message) ?? readString(event.error) ?? 'unknown error';
      return [{ type: 'error', message, retriable: Boolean(event.retriable) }];
    }
    case 'context_usage':
    case 'usage':
    case 'token_usage': {
      const sessionId = readString(event.sessionId) ?? 'unknown';
      const snapshot = mapUsageSnapshot(sessionId, event, 'pi-contextUsage');
      if (!snapshot) {
        return [];
      }
      return [{ type: 'usage/update', sessionId, usage: snapshot }];
    }
    case 'agent_end': {
      // Prefer nested usage when Pi includes it on agent_end.
      const sessionId = readString(event.sessionId) ?? 'unknown';
      const snapshot =
        mapUsageSnapshot(sessionId, event, 'assistant-usage') ??
        mapUsageSnapshot(sessionId, asRecord(event.usage) ?? {}, 'assistant-usage');
      if (!snapshot) {
        return [];
      }
      return [{ type: 'usage/update', sessionId, usage: snapshot }];
    }
    default:
      return [];
  }
}

/**
 * Map Pi compaction_end (+ host-enriched fields) into AgentEvent.
 * Never invents token counts — only maps numbers when present.
 */
export function mapCompactionEndEvent(event: Record<string, unknown>): Extract<
  AgentEvent,
  { type: 'compaction/end' }
> {
  const endEvent: Extract<AgentEvent, { type: 'compaction/end' }> = {
    type: 'compaction/end',
  };

  const aborted = event.aborted === true;
  if (typeof event.ok === 'boolean') {
    endEvent.ok = event.ok;
  } else if (typeof event.isError === 'boolean') {
    endEvent.ok = !event.isError;
  } else if (aborted) {
    endEvent.ok = false;
  } else if (event.result !== undefined) {
    endEvent.ok = event.result !== null;
  }

  const msg =
    readString(event.message) ??
    readString(event.errorMessage) ??
    readString(event.error);
  if (msg) {
    endEvent.message = msg;
  } else if (aborted) {
    endEvent.message = 'Compaction aborted';
  }

  const result = asRecord(event.result);
  if (result) {
    const summary = readString(result.summary);
    if (summary) {
      endEvent.summary = summary;
      if (!endEvent.message) {
        endEvent.message = summary.slice(0, 200);
      }
    }
    const tokensBefore = readNumber(result.tokensBefore) ?? readNumber(event.tokensBefore);
    if (tokensBefore !== undefined) {
      endEvent.tokensBefore = tokensBefore;
    }
    const tokensAfter =
      readNumber(result.estimatedTokensAfter) ??
      readNumber(result.tokensAfter) ??
      readNumber(event.tokensAfter);
    if (tokensAfter !== undefined) {
      endEvent.tokensAfter = tokensAfter;
    }
  } else {
    const tokensBefore = readNumber(event.tokensBefore);
    if (tokensBefore !== undefined) {
      endEvent.tokensBefore = tokensBefore;
    }
    const tokensAfter = readNumber(event.tokensAfter);
    if (tokensAfter !== undefined) {
      endEvent.tokensAfter = tokensAfter;
    }
    const summary = readString(event.summary);
    if (summary) {
      endEvent.summary = summary;
    }
  }

  const durationMs = readNumber(event.durationMs);
  if (durationMs !== undefined) {
    endEvent.durationMs = durationMs;
  }

  return endEvent;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readRole(value: unknown): AgentMessageRole | undefined {
  if (value === 'user' || value === 'assistant' || value === 'system' || value === 'tool') {
    return value;
  }
  return undefined;
}

function readNestedId(event: Record<string, unknown>, key: string): string | undefined {
  const nested = asRecord(event[key]);
  return nested ? readString(nested.id) : undefined;
}

function readNestedRole(event: Record<string, unknown>, key: string): AgentMessageRole | undefined {
  const nested = asRecord(event[key]);
  return nested ? readRole(nested.role) : undefined;
}
