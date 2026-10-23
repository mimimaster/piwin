import {
  SESSION_USER_MESSAGE_INDEX_MAX_TICKS,
  SESSION_USER_MESSAGE_INDEX_MIN_TICKS,
  SESSION_USER_MESSAGE_PREVIEW_CHARS,
  type SessionTranscriptMessage,
  type SessionUserMessageAnchor,
  type SessionUserMessageIndexData,
  type SessionUserMessageIndexQuery,
} from '@piwin/contracts';

/** Browser-only equivalent of the Host's user-message index query. */
export function createMockSessionUserMessageIndex(
  messages: readonly SessionTranscriptMessage[],
  query: SessionUserMessageIndexQuery,
): SessionUserMessageIndexData {
  if (
    !Number.isSafeInteger(query.maximumTicks) ||
    query.maximumTicks < SESSION_USER_MESSAGE_INDEX_MIN_TICKS ||
    query.maximumTicks > SESSION_USER_MESSAGE_INDEX_MAX_TICKS
  ) {
    throw new Error('Mock user-message index tick limit is invalid');
  }
  const userMessages = messages.filter(
    (message) => message.role === 'user' && message.text.trim().length > 0,
  );
  const anchors =
    userMessages.length <= query.maximumTicks
      ? userMessages.map((message, ordinal) => createAnchor(message, ordinal, ordinal, ordinal))
      : sampleAnchors(userMessages, query.maximumTicks);
  return {
    sessionId: query.sessionId,
    revision: mockUserMessageRevision(userMessages),
    totalUserMessages: userMessages.length,
    mode: userMessages.length <= query.maximumTicks ? 'exact' : 'sampled',
    anchors,
    anchorBytes: new TextEncoder().encode(JSON.stringify(anchors)).byteLength,
  };
}

function sampleAnchors(
  messages: readonly SessionTranscriptMessage[],
  maximumTicks: number,
): SessionUserMessageAnchor[] {
  const anchors: SessionUserMessageAnchor[] = [];
  for (let index = 0; index < maximumTicks; index += 1) {
    const spanStartOrdinal = Math.floor((index * messages.length) / maximumTicks);
    const spanEndOrdinal = Math.max(
      spanStartOrdinal,
      Math.floor(((index + 1) * messages.length) / maximumTicks) - 1,
    );
    const representative = messages[spanStartOrdinal];
    if (!representative) continue;
    anchors.push(createAnchor(representative, spanStartOrdinal, spanStartOrdinal, spanEndOrdinal));
  }
  return anchors;
}

function createAnchor(
  message: SessionTranscriptMessage,
  ordinal: number,
  spanStartOrdinal: number,
  spanEndOrdinal: number,
): SessionUserMessageAnchor {
  return {
    messageId: message.id,
    ordinal,
    createdAt: message.createdAt,
    preview: normalizePreview(message.text),
    spanStartOrdinal,
    spanEndOrdinal,
  };
}

function normalizePreview(text: string): string {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  return normalized.length <= SESSION_USER_MESSAGE_PREVIEW_CHARS
    ? normalized
    : `${normalized.slice(0, SESSION_USER_MESSAGE_PREVIEW_CHARS - 1)}…`;
}

function mockUserMessageRevision(messages: readonly SessionTranscriptMessage[]): string {
  const value = JSON.stringify(
    messages.map((message) => [message.id, message.text, message.createdAt]),
  );
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
