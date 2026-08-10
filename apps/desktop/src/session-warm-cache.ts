/**
 * LRU warm cache for recently active session transcripts in the Desktop shell.
 *
 * Only the *active* session mounts Artifact iframes / Markdown. Warm entries
 * keep message JSON so switching among the last N sessions is instant; older
 * sessions cold-load from Host (session/resume + load-messages).
 *
 * This is deliberately not a multi-session live UI: cached sessions do not
 * keep sandboxed iframes alive.
 */

import type {
  ContextUsageSnapshot,
  SessionOutlineNode,
  WalkthroughArtifact,
} from '@piwin/contracts';
import type { ChatMessageUi, RunRecordUi } from './chat-reducer.js';

/** Codex-style warm window: keep a few recent transcripts in JS heap. */
export const MAX_WARM_SESSIONS = 3;

export type SessionWarmSnapshot = {
  sessionId: string;
  messages: ChatMessageUi[];
  transcriptWindow: {
    revision: string;
    totalCount: number;
    olderCursor?: string;
    retainedBytes: number;
    cacheLimitReached: boolean;
  } | null;
  outline: SessionOutlineNode[];
  runRecordsById: Record<string, RunRecordUi>;
  walkthroughsByMessageId: Record<string, WalkthroughArtifact>;
  contextUsage: ContextUsageSnapshot | null;
  /** LRU recency — higher = more recently activated. */
  touchedAt: number;
};

export type WarmSessionCache = {
  byId: Record<string, SessionWarmSnapshot>;
  /** Oldest → newest. Length ≤ MAX_WARM_SESSIONS. */
  order: string[];
};

export function createEmptyWarmSessionCache(): WarmSessionCache {
  return { byId: {}, order: [] };
}

export function getWarmSessionSnapshot(
  cache: WarmSessionCache,
  sessionId: string,
): SessionWarmSnapshot | null {
  return cache.byId[sessionId] ?? null;
}

/**
 * Insert or refresh a snapshot and trim to MAX_WARM_SESSIONS (evict oldest).
 * Does not store empty transcripts (no point warming an empty shell).
 */
export function putWarmSessionSnapshot(
  cache: WarmSessionCache,
  snapshot: Omit<SessionWarmSnapshot, 'touchedAt'> & { touchedAt?: number },
  maxSessions: number = MAX_WARM_SESSIONS,
): WarmSessionCache {
  if (snapshot.messages.length === 0) {
    return removeWarmSessionSnapshot(cache, snapshot.sessionId);
  }

  const touchedAt = snapshot.touchedAt ?? Date.now();
  const nextById: Record<string, SessionWarmSnapshot> = {
    ...cache.byId,
    [snapshot.sessionId]: { ...snapshot, touchedAt },
  };
  const nextOrder = [
    ...cache.order.filter((id) => id !== snapshot.sessionId),
    snapshot.sessionId,
  ];

  while (nextOrder.length > maxSessions) {
    const evictId = nextOrder.shift();
    if (evictId) {
      delete nextById[evictId];
    }
  }

  return { byId: nextById, order: nextOrder };
}

export function removeWarmSessionSnapshot(
  cache: WarmSessionCache,
  sessionId: string,
): WarmSessionCache {
  if (!cache.byId[sessionId]) {
    return cache;
  }
  const nextById = { ...cache.byId };
  delete nextById[sessionId];
  return {
    byId: nextById,
    order: cache.order.filter((id) => id !== sessionId),
  };
}

export function touchWarmSessionOrder(
  cache: WarmSessionCache,
  sessionId: string,
): WarmSessionCache {
  if (!cache.byId[sessionId]) {
    return cache;
  }
  return {
    byId: {
      ...cache.byId,
      [sessionId]: {
        ...cache.byId[sessionId]!,
        touchedAt: Date.now(),
      },
    },
    order: [...cache.order.filter((id) => id !== sessionId), sessionId],
  };
}
