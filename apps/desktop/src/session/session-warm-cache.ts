/**
 * Inactive-session transcript warm cache (Desktop shell only).
 *
 * ## What this is / is not
 *
 * - **Is**: LRU of recently *left* sessions' message JSON so switching back is
 *   instant paint (Host still refreshes via resume + load-messages).
 * - **Is not**: multi-session live UI. Only the *active* session mounts
 *   Markdown / Artifact iframes. Warm entries never keep sandboxed documents.
 * - **Is not** the main WebContent memory fix. Message JSON is cheap next to
 *   iframes/GPU; the real wins are unmount-on-switch + live iframe cap.
 *
 * ## Resident budget
 *
 *   active session (always) + up to MAX_WARM_INACTIVE_SESSIONS warm
 *   ⇒ at most (1 + MAX_WARM_INACTIVE_SESSIONS) transcripts of message rows.
 *
 * Default MAX_WARM_INACTIVE_SESSIONS = 2 → **3 sessions of message data** total
 * (matches the product intent "最近三个会话" without counting the active
 * session twice).
 */

import type {
  ContextUsageSnapshot,
  SessionOutlineNode,
  WalkthroughArtifact,
} from '@piwin/contracts';
import type { ChatMessageUi, ChatUiState, RunRecordUi } from '../conversation/chat-reducer.js';
import { desktopMetrics, utf8ByteLength } from '../run-activity/diagnostic-metrics.js';

/** Inactive sessions kept warm. Active is always extra on top. */
export const MAX_WARM_INACTIVE_SESSIONS = 2;

/** @deprecated Use MAX_WARM_INACTIVE_SESSIONS — name was ambiguous. */
export const MAX_WARM_SESSIONS = MAX_WARM_INACTIVE_SESSIONS;

export type SessionWarmSnapshot = {
  sessionId: string;
  messages: ChatMessageUi[];
  transcriptWindow: ChatUiState['transcriptWindow'];
  outline: SessionOutlineNode[];
  runRecordsById: Record<string, RunRecordUi>;
  walkthroughsByMessageId: Record<string, WalkthroughArtifact>;
  contextUsage: ContextUsageSnapshot | null;
  /** LRU recency — higher = more recently left/restored. */
  touchedAt: number;
};

export type WarmSessionCache = {
  byId: Record<string, SessionWarmSnapshot>;
  /** Oldest → newest. Length ≤ MAX_WARM_INACTIVE_SESSIONS. */
  order: string[];
};

export function createEmptyWarmSessionCache(): WarmSessionCache {
  return { byId: {}, order: [] };
}

function safeJsonByteLength(value: unknown): number {
  try {
    return utf8ByteLength(JSON.stringify(value));
  } catch {
    return 0;
  }
}

/**
 * Rough resident-size estimate of a warm cache: serialized byte length of
 * every retained snapshot. Diagnostics, not accounting — message rows stay
 * shared with the reducer and V8 dedupes references, so this over-counts.
 */
export function estimateWarmSessionCacheBytes(cache: WarmSessionCache): number {
  let bytes = 0;
  for (const snapshot of Object.values(cache.byId)) {
    bytes += safeJsonByteLength(snapshot);
  }
  return bytes;
}

/** Push the current estimate into the observability collector. */
function reportWarmSessionCacheEstimate(cache: WarmSessionCache): void {
  desktopMetrics.setCacheEstimate('warmSessions', {
    entries: cache.order.length,
    bytes: estimateWarmSessionCacheBytes(cache),
  });
}

export function getWarmSessionSnapshot(
  cache: WarmSessionCache,
  sessionId: string,
): SessionWarmSnapshot | null {
  return cache.byId[sessionId] ?? null;
}

function cloneTranscriptWindow(
  window: SessionWarmSnapshot['transcriptWindow'],
): SessionWarmSnapshot['transcriptWindow'] {
  if (!window) {
    return null;
  }
  return {
    revision: window.revision,
    totalCount: window.totalCount,
    retainedBytes: window.retainedBytes,
    cacheLimitReached: window.cacheLimitReached,
    ...(window.olderCursor !== undefined ? { olderCursor: window.olderCursor } : {}),
  };
}

/**
 * Shallow-clone row containers so later active-session updates cannot mutate
 * a warm snapshot in place (reducer is mostly immutable, but this is cheap insurance).
 */
export function cloneSessionWarmSnapshot(
  snapshot: Omit<SessionWarmSnapshot, 'touchedAt'> & { touchedAt?: number },
): SessionWarmSnapshot {
  return {
    sessionId: snapshot.sessionId,
    messages: snapshot.messages.slice(),
    transcriptWindow: cloneTranscriptWindow(snapshot.transcriptWindow),
    outline: snapshot.outline.slice(),
    runRecordsById: { ...snapshot.runRecordsById },
    walkthroughsByMessageId: { ...snapshot.walkthroughsByMessageId },
    contextUsage: snapshot.contextUsage,
    touchedAt: snapshot.touchedAt ?? Date.now(),
  };
}

/**
 * Insert or refresh a snapshot and trim inactive warm set.
 * Skips empty transcripts (nothing useful to restore).
 */
/**
 * Cache the painted transcript under its real owner. Waiting placeholders
 * must not be stored as the destination session's body.
 */
export function stashOwnedTranscript(
  cache: WarmSessionCache,
  snapshot: {
    transcriptOwnerSessionId: string | null;
    messages: ChatMessageUi[];
    transcriptWindow: SessionWarmSnapshot['transcriptWindow'];
    outline: SessionWarmSnapshot['outline'];
    runRecordsById: SessionWarmSnapshot['runRecordsById'];
    walkthroughsByMessageId: SessionWarmSnapshot['walkthroughsByMessageId'];
    contextUsage: SessionWarmSnapshot['contextUsage'];
  },
): WarmSessionCache {
  const ownerSessionId = snapshot.transcriptOwnerSessionId;
  if (!ownerSessionId || snapshot.messages.length === 0) {
    return cache;
  }
  return putWarmSessionSnapshot(cache, {
    sessionId: ownerSessionId,
    messages: snapshot.messages,
    transcriptWindow: snapshot.transcriptWindow,
    outline: snapshot.outline,
    runRecordsById: snapshot.runRecordsById,
    walkthroughsByMessageId: snapshot.walkthroughsByMessageId,
    contextUsage: snapshot.contextUsage,
  });
}

export function putWarmSessionSnapshot(
  cache: WarmSessionCache,
  snapshot: Omit<SessionWarmSnapshot, 'touchedAt'> & { touchedAt?: number },
  maxInactive: number = MAX_WARM_INACTIVE_SESSIONS,
): WarmSessionCache {
  if (snapshot.messages.length === 0) {
    return removeWarmSessionSnapshot(cache, snapshot.sessionId);
  }

  const stored = cloneSessionWarmSnapshot(snapshot);
  const nextById: Record<string, SessionWarmSnapshot> = {
    ...cache.byId,
    [stored.sessionId]: stored,
  };
  const nextOrder = [
    ...cache.order.filter((id) => id !== stored.sessionId),
    stored.sessionId,
  ];

  while (nextOrder.length > maxInactive) {
    const evictId = nextOrder.shift();
    if (evictId) {
      delete nextById[evictId];
    }
  }

  const next = { byId: nextById, order: nextOrder };
  reportWarmSessionCacheEstimate(next);
  return next;
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
  const next = {
    byId: nextById,
    order: cache.order.filter((id) => id !== sessionId),
  };
  reportWarmSessionCacheEstimate(next);
  return next;
}

export function touchWarmSessionOrder(
  cache: WarmSessionCache,
  sessionId: string,
): WarmSessionCache {
  const existing = cache.byId[sessionId];
  if (!existing) {
    return cache;
  }
  return {
    byId: {
      ...cache.byId,
      [sessionId]: {
        ...existing,
        touchedAt: Date.now(),
      },
    },
    order: [...cache.order.filter((id) => id !== sessionId), sessionId],
  };
}

/**
 * Total message-bearing sessions after a switch: active (1 if has messages) + warm.
 * Used by tests / diagnostics — not a hard enforcer.
 */
export function countResidentTranscriptSessions(
  activeMessageCount: number,
  cache: WarmSessionCache,
): number {
  return (activeMessageCount > 0 ? 1 : 0) + cache.order.length;
}
