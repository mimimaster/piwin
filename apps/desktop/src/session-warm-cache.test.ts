import { describe, expect, it } from 'vitest';
import {
  MAX_WARM_SESSIONS,
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
  it('stores up to MAX_WARM_SESSIONS and evicts the oldest', () => {
    let cache = createEmptyWarmSessionCache();
    cache = putWarmSessionSnapshot(cache, snap('s1', 'one'));
    cache = putWarmSessionSnapshot(cache, snap('s2', 'two'));
    cache = putWarmSessionSnapshot(cache, snap('s3', 'three'));
    expect(cache.order).toEqual(['s1', 's2', 's3']);
    expect(Object.keys(cache.byId)).toHaveLength(MAX_WARM_SESSIONS);

    cache = putWarmSessionSnapshot(cache, snap('s4', 'four'));
    expect(cache.order).toEqual(['s2', 's3', 's4']);
    expect(getWarmSessionSnapshot(cache, 's1')).toBeNull();
    expect(getWarmSessionSnapshot(cache, 's4')?.messages[0]?.text).toBe('four');
  });

  it('refreshing an existing id moves it to the newest slot without growing', () => {
    let cache = createEmptyWarmSessionCache();
    cache = putWarmSessionSnapshot(cache, snap('s1', 'one'));
    cache = putWarmSessionSnapshot(cache, snap('s2', 'two'));
    cache = putWarmSessionSnapshot(cache, snap('s3', 'three'));
    cache = putWarmSessionSnapshot(cache, snap('s1', 'one-updated'));
    expect(cache.order).toEqual(['s2', 's3', 's1']);
    expect(getWarmSessionSnapshot(cache, 's1')?.messages[0]?.text).toBe('one-updated');
    expect(Object.keys(cache.byId)).toHaveLength(3);
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
});
