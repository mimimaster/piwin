import { describe, expect, it } from 'vitest';
import {
  MAX_WARM_INACTIVE_SESSIONS,
  WARM_SNAPSHOT_MAX_AGE_MS,
  countResidentTranscriptSessions,
  createEmptyWarmSessionCache,
  getWarmSessionSnapshot,
  putWarmSessionSnapshot,
  registerWarmCache,
  removeWarmSessionSnapshot,
  trimAllWarmSessionCaches,
  trimWarmSessionCache,
} from './session-warm-cache.js';
import type { ChatMessageUi } from '../conversation/chat-reducer.js';

function msg(id: string, text: string): ChatMessageUi {
  return {
    id,
    role: 'user',
    text,
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
  };
}

function snap(sessionId: string, text: string) {
  return {
    sessionId,
    messages: [msg(`${sessionId}-m`, text)],
    transcriptWindow: null,
    outline: [],
    runRecordsById: {},
    walkthroughsByMessageId: {},
    contextUsage: null,
  };
}

describe('session warm cache', () => {
  it(`keeps at most ${MAX_WARM_INACTIVE_SESSIONS} inactive sessions and evicts oldest`, () => {
    let cache = createEmptyWarmSessionCache();
    cache = putWarmSessionSnapshot(cache, snap('s1', 'one'));
    cache = putWarmSessionSnapshot(cache, snap('s2', 'two'));
    expect(cache.order).toEqual(['s1', 's2']);
    expect(Object.keys(cache.byId)).toHaveLength(MAX_WARM_INACTIVE_SESSIONS);

    cache = putWarmSessionSnapshot(cache, snap('s3', 'three'));
    expect(cache.order).toEqual(['s2', 's3']);
    expect(getWarmSessionSnapshot(cache, 's1')).toBeNull();
    expect(getWarmSessionSnapshot(cache, 's3')?.messages[0]?.text).toBe('three');
  });

  it('refreshing an existing id moves it to newest without growing past cap', () => {
    let cache = createEmptyWarmSessionCache();
    cache = putWarmSessionSnapshot(cache, snap('s1', 'one'));
    cache = putWarmSessionSnapshot(cache, snap('s2', 'two'));
    cache = putWarmSessionSnapshot(cache, snap('s1', 'one-updated'));
    expect(cache.order).toEqual(['s2', 's1']);
    expect(getWarmSessionSnapshot(cache, 's1')?.messages[0]?.text).toBe('one-updated');
    expect(Object.keys(cache.byId)).toHaveLength(2);
  });

  it('clones message arrays so later mutation of the source list cannot corrupt warm', () => {
    let cache = createEmptyWarmSessionCache();
    const messages = [msg('m1', 'original')];
    cache = putWarmSessionSnapshot(cache, {
      ...snap('s1', 'x'),
      messages,
    });
    messages[0] = msg('m1', 'mutated-source');
    expect(getWarmSessionSnapshot(cache, 's1')?.messages[0]?.text).toBe('original');
  });

  it('does not warm empty transcripts', () => {
    let cache = createEmptyWarmSessionCache();
    cache = putWarmSessionSnapshot(cache, {
      ...snap('empty', 'x'),
      messages: [],
    });
    expect(cache.order).toEqual([]);
    expect(getWarmSessionSnapshot(cache, 'empty')).toBeNull();
  });

  it('remove drops an entry', () => {
    let cache = createEmptyWarmSessionCache();
    cache = putWarmSessionSnapshot(cache, snap('s1', 'one'));
    cache = removeWarmSessionSnapshot(cache, 's1');
    expect(cache.order).toEqual([]);
    expect(getWarmSessionSnapshot(cache, 's1')).toBeNull();
  });

  it('counts active + inactive residents for the three-session budget story', () => {
    let cache = createEmptyWarmSessionCache();
    cache = putWarmSessionSnapshot(cache, snap('s1', 'one'));
    cache = putWarmSessionSnapshot(cache, snap('s2', 'two'));
    // Active session with messages + 2 warm inactive = 3.
    expect(countResidentTranscriptSessions(5, cache)).toBe(3);
    expect(countResidentTranscriptSessions(0, cache)).toBe(2);
  });
});

describe('session warm cache — governor trims', () => {
  it('drops snapshots past the 5-minute TTL on admission', () => {
    let cache = createEmptyWarmSessionCache();
    cache = putWarmSessionSnapshot(cache, {
      ...snap('old', 'stale'),
      touchedAt: Date.now() - WARM_SNAPSHOT_MAX_AGE_MS - 1000,
    });
    expect(cache.order).toEqual([]);
  });

  it('per-cache trim evicts LRU-first until within maxEntries/maxBytes', () => {
    const now = Date.now();
    let cache = createEmptyWarmSessionCache();
    cache = putWarmSessionSnapshot(cache, { ...snap('s1', 'one'), touchedAt: now - 300 });
    cache = putWarmSessionSnapshot(cache, { ...snap('s2', 'two'), touchedAt: now - 200 });
    cache = putWarmSessionSnapshot(cache, { ...snap('s3', 'three'), touchedAt: now - 100 });
    // put capped the cache at MAX_WARM_INACTIVE_SESSIONS=2 already
    expect(cache.order).toEqual(['s2', 's3']);

    const trimmed = trimWarmSessionCache(cache, { maxEntries: 1 }, now);
    expect(trimmed.order).toEqual(['s3']);

    const cleared = trimWarmSessionCache(cache, { maxEntries: 0, maxBytes: 0 }, now);
    expect(cleared.order).toEqual([]);
  });

  it('per-cache trim does not admit a single oversized snapshot over the byte budget', () => {
    const now = Date.now();
    let cache = createEmptyWarmSessionCache();
    cache = putWarmSessionSnapshot(cache, { ...snap('small', 'x'), touchedAt: now - 200 });
    cache = putWarmSessionSnapshot(cache, {
      ...snap('huge', 'y'.repeat(5000)),
      touchedAt: now - 100,
    });
    // Budget fits the small snapshot but not the huge one: the huge entry is
    // skipped without the small one being evicted to make room.
    const trimmed = trimWarmSessionCache(cache, { maxBytes: 1500 }, now);
    expect(trimmed.order).toEqual(['small']);
    expect(getWarmSessionSnapshot(trimmed, 'huge')).toBeNull();
    expect(getWarmSessionSnapshot(trimmed, 'small')?.messages[0]?.text).toBe('x');
  });

  it('global trim across two registered caches keeps the newest union', () => {
    const unregisters: Array<() => void> = [];
    try {
      const now = Date.now();
      let cacheA = createEmptyWarmSessionCache();
      let cacheB = createEmptyWarmSessionCache();
      cacheA = putWarmSessionSnapshot(cacheA, { ...snap('a-old', 'A1'), touchedAt: now - 300 });
      cacheA = putWarmSessionSnapshot(cacheA, { ...snap('a-new', 'A2'), touchedAt: now - 100 });
      cacheB = putWarmSessionSnapshot(cacheB, { ...snap('b-mid', 'B1'), touchedAt: now - 200 });
      cacheB = putWarmSessionSnapshot(cacheB, { ...snap('b-old', 'B0'), touchedAt: now - 400 });

      unregisters.push(
        registerWarmCache({
          get: () => cacheA,
          set: (next) => {
            cacheA = next;
          },
        }),
        registerWarmCache({
          get: () => cacheB,
          set: (next) => {
            cacheB = next;
          },
        }),
      );

      // Reclaim budget: globally keep only the single newest snapshot.
      trimAllWarmSessionCaches({ maxEntries: 1 }, now);
      expect(cacheA.order).toEqual(['a-new']);
      expect(cacheB.order).toEqual([]);

      // Critical: zero budget drains every instance.
      trimAllWarmSessionCaches({ maxEntries: 0, maxBytes: 0 }, now);
      expect(cacheA.order).toEqual([]);
      expect(cacheB.order).toEqual([]);
    } finally {
      for (const unregister of unregisters) unregister();
    }
  });
});
