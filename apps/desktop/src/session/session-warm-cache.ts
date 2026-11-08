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
import type { CacheBudget } from '../notes/cache-budget.js';
import { registerDisposableCache } from '../notes/cache-budget.js';
import { desktopMetrics, utf8ByteLength } from '../run-activity/diagnostic-metrics.js';

/** Inactive sessions kept warm. Active is always extra on top. */
export const MAX_WARM_INACTIVE_SESSIONS = 2;

/** @deprecated Use MAX_WARM_INACTIVE_SESSIONS — name was ambiguous. */
export const MAX_WARM_SESSIONS = MAX_WARM_INACTIVE_SESSIONS;

/**
 * Warm projections expire: a snapshot stashed longer than this is painted
 * from a stale view anyway, so admission drops it rather than paying the RAM.
 */
export const WARM_SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;

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

function isWarmSnapshotExpired(snapshot: SessionWarmSnapshot, maxAgeMs: number): boolean {
  return Date.now() - snapshot.touchedAt > maxAgeMs;
}

/**
 * Trim one warm cache to a budget: drop expired entries, then evict LRU-first
 * until within maxEntries/maxBytes. A single snapshot larger than maxBytes is
 * simply not kept (admission rejects oversized entries — no evict-all-then-
 * admit loop). Returns the same object when nothing was dropped.
 */
export function trimWarmSessionCache(
  cache: WarmSessionCache,
  budget: CacheBudget,
  now: number = Date.now(),
): WarmSessionCache {
  const maxAgeMs = budget.maxAgeMs;
  const maxEntries = budget.maxEntries ?? Number.POSITIVE_INFINITY;
  const maxBytes = budget.maxBytes ?? Number.POSITIVE_INFINITY;
  const keepIds = new Set<string>();
  let keptCount = 0;
  let keptBytes = 0;
  // Newest → oldest.
  for (let index = cache.order.length - 1; index >= 0; index -= 1) {
    const id = cache.order[index];
    if (id === undefined) continue;
    const snapshot = cache.byId[id];
    if (snapshot === undefined) continue;
    if (maxAgeMs !== undefined && now - snapshot.touchedAt > maxAgeMs) continue;
    const bytes = safeJsonByteLength(snapshot);
    if (keptCount >= maxEntries) continue;
    if (keptBytes + bytes > maxBytes) continue;
    keepIds.add(id);
    keptCount += 1;
    keptBytes += bytes;
  }
  if (keepIds.size === cache.order.length) {
    return cache;
  }
  const nextById: Record<string, SessionWarmSnapshot> = {};
  const nextOrder: string[] = [];
  for (const id of cache.order) {
    if (!keepIds.has(id)) continue;
    const snapshot = cache.byId[id];
    if (snapshot === undefined) continue;
    nextById[id] = snapshot;
    nextOrder.push(id);
  }
  const next = { byId: nextById, order: nextOrder };
  reportWarmSessionCacheEstimate(next);
  return next;
}

/**
 * Registered warm-cache instances. The cache is an immutable value owned by
 * (dirty) reducers, so the registry holds get/set handles instead of cache
 * objects; handle owners keep `set` wired to wherever they store the value.
 */
type WarmCacheHandle = { get(): WarmSessionCache; set(cache: WarmSessionCache): void };
const warmCacheHandles = new Set<WarmCacheHandle>();

/**
 * Governor-pushed admission budget shared by EVERY put, including caches that
 * never register a handle (the dirty reducers). trimAllWarmSessionCaches
 * applies registered handles' union trim; this default additionally enforces
 * the byte/age budget on admission inside putWarmSessionSnapshot so even
 * unregistered instances cannot grow past it.
 */
let warmAdmissionBudget: Pick<CacheBudget, 'maxBytes' | 'maxAgeMs'> = {};

/** Set the module-wide admission budget (governor calls on every transition). */
export function applyGlobalWarmAdmissionBudget(
  budget: Pick<CacheBudget, 'maxBytes' | 'maxAgeMs'>,
): void {
  warmAdmissionBudget = budget;
}

/** Register one warm-cache instance for GLOBAL trims. Dedupes by identity. */
export function registerWarmCache(handle: WarmCacheHandle): () => void {
  warmCacheHandles.add(handle);
  return () => {
    warmCacheHandles.delete(handle);
  };
}

/** Live handle count — diagnostics/tests only. */
export function getWarmCacheHandleCount(): number {
  return warmCacheHandles.size;
}

/**
 * Governor-driven GLOBAL trim: the warm budget applies to the union of every
 * registered instance, not per pane. Across all handles, snapshots are ranked
 * by recency (touchedAt); only the globally-newest maxEntries/maxBytes worth
 * survive, and each handle gets back just its own survivors.
 */
export function trimAllWarmSessionCaches(budget: CacheBudget, now: number = Date.now()): void {
  // Admission budget is module-global: registered AND unregistered instances
  // respect it on every put from now on.
  applyGlobalWarmAdmissionBudget({
    ...(budget.maxBytes === undefined ? {} : { maxBytes: budget.maxBytes }),
    ...(budget.maxAgeMs === undefined ? {} : { maxAgeMs: budget.maxAgeMs }),
  });
  const maxAgeMs = budget.maxAgeMs;
  const maxEntries = budget.maxEntries ?? Number.POSITIVE_INFINITY;
  const maxBytes = budget.maxBytes ?? Number.POSITIVE_INFINITY;

  const newestById = new Map<string, SessionWarmSnapshot>();
  for (const handle of warmCacheHandles) {
    const cache = handle.get();
    for (const id of cache.order) {
      const snapshot = cache.byId[id];
      if (snapshot === undefined) continue;
      const known = newestById.get(id);
      if (known === undefined || snapshot.touchedAt >= known.touchedAt) {
        newestById.set(id, snapshot);
      }
    }
  }

  const keepIds = new Set<string>();
  let keptCount = 0;
  let keptBytes = 0;
  const ranked = [...newestById.values()].sort((a, b) => b.touchedAt - a.touchedAt);
  for (const snapshot of ranked) {
    if (maxAgeMs !== undefined && now - snapshot.touchedAt > maxAgeMs) continue;
    const bytes = safeJsonByteLength(snapshot);
    if (keptCount >= maxEntries) continue;
    if (keptBytes + bytes > maxBytes) continue;
    keepIds.add(snapshot.sessionId);
    keptCount += 1;
    keptBytes += bytes;
  }

  let totalEntries = 0;
  for (const handle of warmCacheHandles) {
    const cache = handle.get();
    // Each handle keeps only globally-surviving ids (its own copies), and the
    // TTL still applies per entry.
    const nextById: Record<string, SessionWarmSnapshot> = {};
    const nextOrder: string[] = [];
    for (const id of cache.order) {
      if (!keepIds.has(id)) continue;
      const snapshot = cache.byId[id];
      if (snapshot === undefined) continue;
      if (maxAgeMs !== undefined && now - snapshot.touchedAt > maxAgeMs) continue;
      nextById[id] = snapshot;
      nextOrder.push(id);
    }
    if (nextOrder.length !== cache.order.length) {
      const next = { byId: nextById, order: nextOrder };
      reportWarmSessionCacheEstimate(next);
      handle.set(next);
    }
    totalEntries += nextOrder.length;
  }
  desktopMetrics.setCacheEstimate('warmSessions', {
    entries: totalEntries,
    bytes: keptBytes,
  });
}

registerDisposableCache({
  name: 'warmSessions',
  applyBudget(budget: CacheBudget): void {
    trimAllWarmSessionCaches(budget);
  },
});

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
  const nextOrder = [...cache.order.filter((id) => id !== stored.sessionId), stored.sessionId];

  while (nextOrder.length > maxInactive) {
    const evictId = nextOrder.shift();
    if (evictId) {
      delete nextById[evictId];
    }
  }

  // Expired snapshots are dropped on admission as well (5 min TTL).
  for (let index = nextOrder.length - 1; index >= 0; index -= 1) {
    const id = nextOrder[index];
    if (id === undefined) continue;
    const snapshot = nextById[id];
    if (snapshot !== undefined && isWarmSnapshotExpired(snapshot, WARM_SNAPSHOT_MAX_AGE_MS)) {
      nextOrder.splice(index, 1);
      delete nextById[id];
    }
  }

  // Governor-pushed admission budget: byte cap applies on top of the per-call
  // maxInactive count. Oversized single entries are simply not admitted
  // (no evict-all-then-admit), matching the plan's reject rule.
  const byteCap = warmAdmissionBudget.maxBytes;
  if (byteCap !== undefined) {
    let keptBytes = 0;
    const surviving = new Set<string>();
    for (let index = nextOrder.length - 1; index >= 0; index -= 1) {
      const id = nextOrder[index];
      if (id === undefined) continue;
      const snapshot = nextById[id];
      if (snapshot === undefined) continue;
      const bytes = safeJsonByteLength(snapshot);
      if (keptBytes + bytes > byteCap) continue;
      surviving.add(id);
      keptBytes += bytes;
    }
    if (surviving.size !== nextOrder.length) {
      for (let index = nextOrder.length - 1; index >= 0; index -= 1) {
        const id = nextOrder[index];
        if (id !== undefined && !surviving.has(id)) {
          nextOrder.splice(index, 1);
          delete nextById[id];
        }
      }
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
