/** The harmless no-op outcome reported by Pi's manual compaction API. */
export type CompactionNoOpKind = 'already-compacted' | 'too-small';

/**
 * A durable compaction boundary used when a Pi runtime is rebuilt.
 *
 * The summary is model-facing context, not a transcript message. Keeping it
 * separate lets a replacement runtime restore Pi's native compaction shape
 * without injecting a synthetic user-visible message into the product chat.
 */
export type SessionCompactionSeed = {
  summary: string;
  tokensBefore?: number;
};

/** Durable product-side record of one successful native compaction. */
export type SessionCompactionRecord = SessionCompactionSeed & {
  compactionId: string;
  sessionId: string;
  /** Product transcript leaf at the moment the compaction was committed. */
  anchorMessageId: string | null;
  /** Pi-native retained-entry boundary, when the adapter exposes it. */
  firstKeptEntryId?: string;
  tokensAfter?: number;
  runtimeGenerationId?: string;
  createdAt: string;
};

/** Input to a transcript store; the store supplies the owning session id. */
export type SessionCompactionRecordInput = Omit<SessionCompactionRecord, 'sessionId'>;

/** Stable context-boundary key shared by live events and durable replay. */
export function formatCompactionBoundary(input: {
  tokensBefore?: number;
  tokensAfter?: number;
}): string {
  return `compact:${input.tokensBefore ?? 'na'}:${input.tokensAfter ?? 'unknown'}`;
}

/**
 * Classify Pi's narrow no-op messages. Provider failures and malformed
 * results return undefined and must remain visible to callers.
 */
export function classifyCompactionNoOp(
  message: string | undefined,
): CompactionNoOpKind | undefined {
  const normalized = (message ?? '').toLowerCase();
  if (normalized.includes('already compacted')) return 'already-compacted';
  if (normalized.includes('nothing to compact') || normalized.includes('session too small')) {
    return 'too-small';
  }
  return undefined;
}
