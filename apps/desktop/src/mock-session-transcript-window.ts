import {
  SESSION_TRANSCRIPT_PAGE_MIN_BYTES,
  SESSION_TRANSCRIPT_PAGE_MAX_BYTES,
  SESSION_TRANSCRIPT_WINDOW_MAX_ITEMS,
  type SessionTranscriptMessage,
  type SessionTranscriptWindowData,
  type SessionTranscriptWindowQuery,
} from '@piwin/contracts';

const TRUNCATION_MARKER = '\n[message truncated in UI history; full content remains on Host]';

export function createMockSessionTranscriptWindow(
  messages: readonly SessionTranscriptMessage[],
  query: SessionTranscriptWindowQuery,
): SessionTranscriptWindowData {
  if (
    query.beforeItems < 0 ||
    query.afterItems < 0 ||
    query.beforeItems + query.afterItems + 1 > SESSION_TRANSCRIPT_WINDOW_MAX_ITEMS ||
    query.maximumBytes < SESSION_TRANSCRIPT_PAGE_MIN_BYTES ||
    query.maximumBytes > SESSION_TRANSCRIPT_PAGE_MAX_BYTES
  ) {
    throw new Error('Mock transcript window limits are invalid');
  }
  const anchorIndex = messages.findIndex((message) => message.id === query.anchorMessageId);
  if (anchorIndex < 0) return { status: 'not-found' };
  const messageOrder = new Map(messages.map((message, index) => [message.id, index]));
  const startIndex = Math.max(0, anchorIndex - query.beforeItems);
  const endIndex = Math.min(messages.length, anchorIndex + query.afterItems + 1);
  const candidates = [
    messages[anchorIndex],
    ...messages.slice(anchorIndex + 1, endIndex),
    ...messages.slice(startIndex, anchorIndex).reverse(),
  ].filter((message): message is SessionTranscriptMessage => message !== undefined);
  const selected: SessionTranscriptMessage[] = [];
  let messageBytes = 2;
  for (const candidate of candidates) {
    let projected = candidate;
    let candidateBytes = serializedBytes(projected);
    const delimiterBytes = selected.length === 0 ? 0 : 1;
    if (messageBytes + delimiterBytes + candidateBytes > query.maximumBytes) {
      if (candidate.id === query.anchorMessageId && selected.length === 0) {
        projected = clipMessage(candidate, query.maximumBytes - 2);
        candidateBytes = serializedBytes(projected);
      } else {
        continue;
      }
    }
    selected.push(projected);
    messageBytes += delimiterBytes + candidateBytes;
  }
  selected.sort(
    (left, right) => (messageOrder.get(left.id) ?? 0) - (messageOrder.get(right.id) ?? 0),
  );
  const anchorOffset = selected.findIndex((message) => message.id === query.anchorMessageId);
  return {
    status: 'window',
    messages: selected,
    window: {
      revision: mockWindowRevision(messages),
      totalCount: messages.length,
      startIndex,
      endIndex,
      messageBytes,
      anchorMessageId: query.anchorMessageId,
      anchorOffset: Math.max(0, anchorOffset),
    },
  };
}

function clipMessage(
  message: SessionTranscriptMessage,
  maximumEncodedBytes: number,
): SessionTranscriptMessage {
  const base: SessionTranscriptMessage = {
    id: message.id,
    role: message.role,
    text: TRUNCATION_MARKER,
    createdAt: message.createdAt,
    status: message.status,
  };
  let lowerBound = 0;
  let upperBound = message.text.length;
  while (lowerBound < upperBound) {
    const midpoint = Math.ceil((lowerBound + upperBound) / 2);
    const candidate = { ...base, text: `${message.text.slice(0, midpoint)}${TRUNCATION_MARKER}` };
    if (serializedBytes(candidate) <= maximumEncodedBytes) {
      lowerBound = midpoint;
    } else {
      upperBound = midpoint - 1;
    }
  }
  return { ...base, text: `${message.text.slice(0, lowerBound)}${TRUNCATION_MARKER}` };
}

function serializedBytes(message: SessionTranscriptMessage): number {
  return new TextEncoder().encode(JSON.stringify(message)).byteLength;
}

function mockWindowRevision(messages: readonly SessionTranscriptMessage[]): string {
  const value = JSON.stringify(messages.map((message) => [message.id, message.text]));
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
