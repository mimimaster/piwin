import { describe, expect, it } from 'vitest';
import {
  MAX_WARM_INACTIVE_SESSIONS,
  countResidentTranscriptSessions,
  createEmptyWarmSessionCache,
  getWarmSessionSnapshot,
  putWarmSessionSnapshot,
  removeWarmSessionSnapshot,
} from './session-warm-cache.js';
import type { ChatMessageUi } from './chat-reducer.js';

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
