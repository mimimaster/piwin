import {
  SESSION_TRANSCRIPT_PAGE_MAX_BYTES,
  SESSION_TRANSCRIPT_PAGE_MAX_ITEMS,
  SESSION_TRANSCRIPT_PAGE_MIN_BYTES,
  type SessionTranscriptMessage,
  type SessionTranscriptPageQuery,
  type SessionTranscriptPageResult,
} from '@piwin/contracts';

const CURSOR_PATTERN = /^mock\.([a-f0-9]{8})\.(\d+)\.(\d+)\.(\d+)$/;
const TRUNCATION_MARKER = '\n[message truncated in UI history; full content remains on Host]';

/** Browser-only mock equivalent of the Host transcript page contract. */
export function createMockSessionTranscriptPage(
  messages: readonly SessionTranscriptMessage[],
  query: SessionTranscriptPageQuery,
): SessionTranscriptPageResult<SessionTranscriptMessage> {
  validateQuery(query);
  const projected = messages.map(projectMockMessage);
  const revision = mockRevision(projected);
  const cursor = query.beforeCursor ? decodeCursor(query.beforeCursor) : null;
  if (cursor && cursor.revision !== revision) {
    return { status: 'stale-cursor', currentRevision: revision };
  }
  if (cursor && (cursor.limit !== query.limit || cursor.maximumBytes !== query.maximumBytes)) {
    return { status: 'stale-cursor', currentRevision: revision };
  }
  const endIndex = cursor?.endIndex ?? projected.length;
  if (cursor && (endIndex <= 0 || endIndex > projected.length)) {
    throw new Error('Mock transcript cursor boundary is outside the collection');
  }

  const selected: SessionTranscriptMessage[] = [];
  const truncatedMessageIds: string[] = [];
  let startIndex = endIndex;
  let messageBytes = 2;
  while (startIndex > 0 && selected.length < query.limit) {
    const source = projected[startIndex - 1];
    if (source === undefined) break;
    let candidate = source;
    let candidateBytes = serializedBytes(candidate);
    const delimiterBytes = selected.length === 0 ? 0 : 1;
    if (messageBytes + delimiterBytes + candidateBytes > query.maximumBytes) {
      if (selected.length > 0) break;
      candidate = clipMessage(source, query.maximumBytes - 2);
      candidateBytes = serializedBytes(candidate);
      truncatedMessageIds.push(source.id);
    }
    selected.unshift(candidate);
    startIndex -= 1;
    messageBytes += delimiterBytes + candidateBytes;
  }

  const page = {
    revision,
    totalCount: projected.length,
    startIndex,
    endIndex,
    messageBytes,
  };
  const resultPage: typeof page & {
    truncatedMessageIds?: string[];
    olderCursor?: string;
  } = page;
  if (truncatedMessageIds.length > 0) resultPage.truncatedMessageIds = truncatedMessageIds;
  if (startIndex > 0) {
    resultPage.olderCursor = `mock.${revision}.${startIndex}.${query.limit}.${query.maximumBytes}`;
  }
  return { status: 'page', messages: selected, page: resultPage };
}

function projectMockMessage(message: SessionTranscriptMessage): SessionTranscriptMessage {
  if (!message.tools || message.tools.length === 0) return message;
  return {
    ...message,
    tools: message.tools.map((tool) => ({ ...tool, output: '' })),
  };
}

function mockRevision(messages: readonly SessionTranscriptMessage[]): string {
  const value = JSON.stringify(messages);
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function decodeCursor(value: string): {
  revision: string;
  endIndex: number;
  limit: number;
  maximumBytes: number;
} {
  const match = CURSOR_PATTERN.exec(value);
  if (!match) throw new Error('Mock transcript cursor encoding is invalid');
  const revision = match[1];
  const endIndex = Number(match[2]);
  const limit = Number(match[3]);
  const maximumBytes = Number(match[4]);
  if (
    revision === undefined ||
    !Number.isSafeInteger(endIndex) ||
    !Number.isSafeInteger(limit) ||
    !Number.isSafeInteger(maximumBytes)
  ) {
    throw new Error('Mock transcript cursor fields are invalid');
  }
  return { revision, endIndex, limit, maximumBytes };
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
    if (serializedBytes(candidate) <= maximumEncodedBytes) lowerBound = midpoint;
    else upperBound = midpoint - 1;
  }
  return { ...base, text: `${message.text.slice(0, lowerBound)}${TRUNCATION_MARKER}` };
}

function serializedBytes(value: SessionTranscriptMessage): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function validateQuery(query: SessionTranscriptPageQuery): void {
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit <= 0 ||
    query.limit > SESSION_TRANSCRIPT_PAGE_MAX_ITEMS ||
    !Number.isSafeInteger(query.maximumBytes) ||
    query.maximumBytes < SESSION_TRANSCRIPT_PAGE_MIN_BYTES ||
    query.maximumBytes > SESSION_TRANSCRIPT_PAGE_MAX_BYTES
  ) {
    throw new Error('Mock transcript page limits are invalid');
  }
}
