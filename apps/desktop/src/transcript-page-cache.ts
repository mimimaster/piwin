import type { SessionTranscriptMessage } from '@piwin/contracts';
import type { ChatMessageUi, ChatUiState } from './chat-reducer';

export const MAX_TRANSCRIPT_CACHE_MESSAGES = 160;
/**
 * History view (reading older pages) keeps more rows than the live tail. One
 * agent turn can hold hundreds of tool-only messages that render as a single
 * closed "已工作 · N 个工具" fold; at 160 the window was shorter than that
 * invisible run, so paging older evicted the one reply the reader was looking
 * at. Folded rows do not render, and the byte cap still bounds memory.
 */
export const MAX_HISTORY_VIEW_MESSAGES = 600;
export const MAX_TRANSCRIPT_CACHE_BYTES = 2 * 1024 * 1024;

export type TranscriptPageCacheMerge = {
  messages: ChatMessageUi[];
  retainedBytes: number;
  acceptedOlderCount: number;
  cacheLimitReached: boolean;
};

export type BoundedTranscriptWindow = {
  messages: ChatMessageUi[];
  retainedBytes: number;
  droppedCount: number;
  cacheLimitReached: boolean;
};

/**
 * Keep the newest messages that fit while always retaining explicitly
 * protected tail/live messages. This is used for live appends as well as page
 * hydration so a long-running renderer cannot grow only because it never
 * reconnects.
 */
export function retainBoundedTranscriptWindow(
  messages: readonly ChatMessageUi[],
  protectedMessageIds: ReadonlySet<string> = new Set(),
): BoundedTranscriptWindow {
  const retainedIndexes = new Set<number>();
  let retainedCount = 0;
  let retainedBytes = 2;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message === undefined || !protectedMessageIds.has(message.id)) continue;
    const messageBytes = measureTranscriptMessageBytes(message);
    retainedIndexes.add(index);
    retainedBytes += messageBytes + (retainedCount === 0 ? 0 : 1);
    retainedCount += 1;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (retainedIndexes.has(index)) continue;
    const message = messages[index];
    if (message === undefined) continue;
    const messageBytes = measureTranscriptMessageBytes(message);
    if (
      retainedCount + 1 > MAX_TRANSCRIPT_CACHE_MESSAGES ||
      retainedBytes + messageBytes + (retainedCount === 0 ? 0 : 1) > MAX_TRANSCRIPT_CACHE_BYTES
    ) {
      continue;
    }
    retainedIndexes.add(index);
    retainedBytes += messageBytes + (retainedCount === 0 ? 0 : 1);
    retainedCount += 1;
  }

  const retainedMessages = messages.filter((_message, index) => retainedIndexes.has(index));
  return {
    messages: retainedMessages,
    retainedBytes,
    droppedCount: messages.length - retainedMessages.length,
    cacheLimitReached: retainedMessages.length < messages.length,
  };
}

/**
 * Prepend the newest suffix of an older page that fits. Existing messages are
 * the active tail and are never evicted by history navigation.
 */
export function prependBoundedTranscriptPage(
  currentMessages: readonly ChatMessageUi[],
  olderMessages: readonly ChatMessageUi[],
): TranscriptPageCacheMerge {
  const currentIds = new Set(currentMessages.map((message) => message.id));
  const candidates = olderMessages.filter((message) => !currentIds.has(message.id));
  let merged = [...currentMessages];
  let acceptedOlderCount = 0;

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (candidate === undefined) continue;
    const next = [candidate, ...merged];
    if (
      next.length > MAX_TRANSCRIPT_CACHE_MESSAGES ||
      measureTranscriptCacheBytes(next) > MAX_TRANSCRIPT_CACHE_BYTES
    ) {
      break;
    }
    merged = next;
    acceptedOlderCount += 1;
  }

  return {
    messages: merged,
    retainedBytes: measureTranscriptCacheBytes(merged),
    acceptedOlderCount,
    cacheLimitReached: acceptedOlderCount < candidates.length,
  };
}

export function measureTranscriptCacheBytes(messages: readonly ChatMessageUi[]): number {
  return new TextEncoder().encode(JSON.stringify(messages)).byteLength;
}

/** Newest-first bound for Host transcript rows (inspector / raw session/messages). */
export function retainBoundedSessionTranscript(
  messages: readonly SessionTranscriptMessage[],
): SessionTranscriptMessage[] {
  const newest =
    messages.length > MAX_TRANSCRIPT_CACHE_MESSAGES
      ? messages.slice(-MAX_TRANSCRIPT_CACHE_MESSAGES)
      : [...messages];
  let retainedBytes = 2;
  let start = 0;
  for (let index = newest.length - 1; index >= 0; index -= 1) {
    const message = newest[index];
    if (message === undefined) {
      continue;
    }
    const messageBytes = new TextEncoder().encode(JSON.stringify(message)).byteLength;
    if (
      retainedBytes + messageBytes + (retainedBytes === 2 ? 0 : 1) > MAX_TRANSCRIPT_CACHE_BYTES &&
      index < newest.length - 1
    ) {
      start = index + 1;
      break;
    }
    retainedBytes += messageBytes + (retainedBytes === 2 ? 0 : 1);
  }
  return start === 0 ? newest : newest.slice(start);
}

function measureTranscriptMessageBytes(message: ChatMessageUi): number {
  return new TextEncoder().encode(JSON.stringify(message)).byteLength;
}

/** Even a never-resumed live session must remember that it evicted history. */
export function createTranscriptCacheMetadata(
  source: { revision: string | null; totalCount: number; olderCursor?: string; cacheLimitReached?: boolean } | null | undefined,
  bounded: { cacheLimitReached: boolean; retainedBytes: number },
  messageCount: number,
): ChatUiState['transcriptWindow'] {
  const cacheLimitReached = source?.cacheLimitReached === true || bounded.cacheLimitReached;
  if (!source && !cacheLimitReached) return null;
  return {
    revision: source?.revision ?? null,
    totalCount: source?.totalCount ?? messageCount,
    ...(!cacheLimitReached && source?.olderCursor ? { olderCursor: source.olderCursor } : {}),
    retainedBytes: bounded.retainedBytes,
    cacheLimitReached,
  };
}
