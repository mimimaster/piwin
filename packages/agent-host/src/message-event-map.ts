import type { AgentEvent, AgentMessageRole } from '@piwin/contracts';
import { normalizeNativeSearchCitations } from './native-web-search.js';
import { mapAssistantStopReasonFailure } from './agent-failure-map.js';
import { readAssistantToolArgProgress } from './assistant-tool-arg-progress.js';
import { asRecord, readNestedId, readNestedRole, readRole, readString } from './pi-event-read.js';

export function mapMessageStartEvent(
  event: Record<string, unknown>,
  activeMessageId?: string | null,
): AgentEvent[] {
  const messageId =
    readString(event.messageId) ?? readNestedId(event, 'message') ?? activeMessageId ?? 'unknown';
  const role = readRole(event.role) ?? readNestedRole(event, 'message') ?? 'assistant';
  return [{ type: 'message/start', messageId, role }];
}

export function mapMessageUpdateEvent(
  event: Record<string, unknown>,
  activeMessageId?: string | null,
): AgentEvent[] {
  const messageId = readString(event.messageId) ?? activeMessageId ?? 'unknown';
  const assistantEvent = asRecord(event.assistantMessageEvent);
  if (!assistantEvent) {
    return [];
  }
  const assistantType = readString(assistantEvent.type);
  const delta = readString(assistantEvent.delta) ?? '';
  const mapped: AgentEvent[] = [];
  if (assistantType === 'text_delta') {
    mapped.push({ type: 'message/text_delta', messageId, delta });
  } else if (assistantType === 'thinking_delta') {
    mapped.push({ type: 'message/thinking_delta', messageId, delta });
  }
  const toolArgProgress = readAssistantToolArgProgress(assistantEvent);
  if (toolArgProgress) {
    mapped.push({
      type: 'message/tool_args_progress',
      messageId,
      argumentCharCount: toolArgProgress.chars,
      ...(toolArgProgress.toolName !== undefined ? { toolName: toolArgProgress.toolName } : {}),
    });
  }
  const evidence = normalizeNativeSearchCitations(assistantEvent);
  if (evidence) {
    mapped.push({ type: 'message/search_evidence', messageId, evidence });
  }
  return mapped;
}

export function mapMessageEndEvent(
  event: Record<string, unknown>,
  activeMessageId?: string | null,
  activeMessageRole?: AgentMessageRole | null,
): AgentEvent[] {
  const messageId =
    readString(event.messageId) ?? readNestedId(event, 'message') ?? activeMessageId ?? 'unknown';
  const messagePayload = event.message ?? event.assistantMessage ?? event;
  const evidence = normalizeNativeSearchCitations(messagePayload);
  const endedMessageRole =
    readRole(event.role) ??
    readNestedRole(event, 'message') ??
    readNestedRole(event, 'assistantMessage') ??
    activeMessageRole;
  const snapshot =
    endedMessageRole === 'assistant' ? extractAssistantMessageSnapshot(messagePayload) : null;
  const mapped: AgentEvent[] = [];
  if (snapshot !== null) {
    mapped.push({ type: 'message/start', messageId, role: 'assistant' });
    if (snapshot.thinking.length > 0) {
      mapped.push({ type: 'message/thinking_delta', messageId, delta: snapshot.thinking });
    }
    if (snapshot.text.length > 0) {
      mapped.push({ type: 'message/text_snapshot', messageId, text: snapshot.text });
    }
  }
  if (evidence) {
    mapped.push({ type: 'message/search_evidence', messageId, evidence });
  }
  mapped.push({ type: 'message/end', messageId });
  if (endedMessageRole === 'assistant') {
    const failure = mapAssistantStopReasonFailure(asRecord(messagePayload), event);
    if (failure) {
      mapped.push(failure);
    }
  }
  return mapped;
}

export function filterDuplicateSearchEvidence(
  event: AgentEvent,
  citationUrlsByMessageId: Map<string, Set<string>>,
): AgentEvent[] {
  if (event.type !== 'message/search_evidence') {
    return [event];
  }
  const seenUrls = citationUrlsByMessageId.get(event.messageId) ?? new Set<string>();
  const citations = event.evidence.citations.filter((citation) => {
    const key = citation.url.trim().toLowerCase();
    if (key.length === 0 || seenUrls.has(key)) {
      return false;
    }
    seenUrls.add(key);
    return true;
  });
  citationUrlsByMessageId.set(event.messageId, seenUrls);
  if (citations.length === 0) {
    return [];
  }
  return [
    {
      ...event,
      evidence: {
        ...(event.evidence.query !== undefined ? { query: event.evidence.query } : {}),
        provenance: event.evidence.provenance,
        citations,
      },
    },
  ];
}

type AssistantMessageSnapshot = {
  text: string;
  thinking: string;
};

function extractAssistantMessageSnapshot(value: unknown): AssistantMessageSnapshot | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const textParts: string[] = [];
  const thinkingParts: string[] = [];
  const content = record.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      const part = asRecord(item);
      if (!part) {
        continue;
      }
      if (part.type === 'text') {
        const text = readString(part.text);
        if (text) textParts.push(text);
      } else if (part.type === 'thinking' || part.type === 'reasoning') {
        const thinking = readString(part.thinking) ?? readString(part.text);
        if (thinking) thinkingParts.push(thinking);
      }
    }
  } else if (typeof content === 'string' && content.length > 0) {
    textParts.push(content);
  }

  const directText = readString(record.text);
  if (directText) textParts.push(directText);
  const directThinking = readString(record.thinking) ?? readString(record.reasoning);
  if (directThinking) thinkingParts.push(directThinking);

  const snapshot = {
    text: textParts.join(''),
    thinking: thinkingParts.join(''),
  } satisfies AssistantMessageSnapshot;
  return snapshot.text.length > 0 || snapshot.thinking.length > 0 ? snapshot : null;
}
