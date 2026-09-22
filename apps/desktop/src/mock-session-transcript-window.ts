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
  // Mirrors the Host (@piwin/session transcriptWindow): slimmed UI projection,
  // anchor first, newer then older, stopping at the first message that does
  // not fit so the window stays contiguous, and indexes from what was kept.
  const project = (message: SessionTranscriptMessage): SessionTranscriptMessage =>
    message.tools && message.tools.length > 0
      ? { ...message, tools: message.tools.map((tool) => ({ ...tool, output: '' })) }
      : message;
  const firstIndex = Math.max(0, anchorIndex - query.beforeItems);
  const lastIndex = Math.min(messages.length - 1, anchorIndex + query.afterItems);
  const selected = new Map<number, SessionTranscriptMessage>();
  let messageBytes = 2;
  const add = (index: number, force = false): boolean => {
    const source = messages[index];
    if (source === undefined) return false;
    let projected = project(source);
    let candidateBytes = serializedBytes(projected);
    const delimiterBytes = selected.size === 0 ? 0 : 1;
    if (messageBytes + delimiterBytes + candidateBytes > query.maximumBytes) {
      if (!force) return false;
      projected = clipMessage(projected, query.maximumBytes - 2);
      candidateBytes = serializedBytes(projected);
    }
    selected.set(index, projected);
    messageBytes += delimiterBytes + candidateBytes;
    return true;
  };
  add(anchorIndex, true);
  for (let index = anchorIndex + 1; index <= lastIndex && add(index); index += 1);
  for (let index = anchorIndex - 1; index >= firstIndex && add(index); index -= 1);
  const keptIndexes = [...selected.keys()].sort((left, right) => left - right);
  const startIndex = keptIndexes[0] ?? anchorIndex;
  const endIndex = (keptIndexes.at(-1) ?? anchorIndex) + 1;
  return {
    status: 'window',
    messages: keptIndexes.flatMap((index) => selected.get(index) ?? []),
    window: {
      revision: mockWindowRevision(messages),
      totalCount: messages.length,
      startIndex,
      endIndex,
      messageBytes,
      anchorMessageId: query.anchorMessageId,
      anchorOffset: Math.max(0, anchorIndex - startIndex),
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
