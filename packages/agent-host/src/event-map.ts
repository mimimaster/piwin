import type { AgentEvent, AgentMessageRole } from '@piwin/contracts';
import { mapUsageSnapshot } from './usage-map.js';

/**
 * Map Pi SDK / RPC-like session events into normalized AgentEvent[].
 * Defensive: unknown shapes return [] (never throw).
 */
export function mapPiSessionEvent(raw: unknown): AgentEvent[] {
  if (!raw || typeof raw !== 'object') {
    return [];
  }

  const event = raw as Record<string, unknown>;
  const type = typeof event.type === 'string' ? event.type : '';

  switch (type) {
    case 'message_start': {
      const messageId = readString(event.messageId) ?? readNestedId(event, 'message') ?? 'unknown';
      const role = readRole(event.role) ?? readNestedRole(event, 'message') ?? 'assistant';
      return [{ type: 'message/start', messageId, role }];
    }
    case 'message_update': {
      const messageId = readString(event.messageId) ?? 'unknown';
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
      const messageId = readString(event.messageId) ?? readNestedId(event, 'message') ?? 'unknown';
      return [{ type: 'message/end', messageId }];
    }
    case 'tool_execution_start': {
      const toolCallId = readString(event.toolCallId) ?? readString(event.id) ?? 'unknown';
      const toolName = readString(event.toolName) ?? readString(event.name) ?? 'unknown';
      return [{ type: 'tool/start', toolCallId, toolName }];
    }
    case 'tool_execution_update': {
      const toolCallId = readString(event.toolCallId) ?? readString(event.id) ?? 'unknown';
      const delta = readString(event.delta) ?? readString(event.output) ?? '';
      return [{ type: 'tool/update', toolCallId, delta }];
    }
    case 'tool_execution_end': {
      const toolCallId = readString(event.toolCallId) ?? readString(event.id) ?? 'unknown';
      const isError = Boolean(event.isError ?? event.error);
      return [{ type: 'tool/end', toolCallId, isError }];
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
