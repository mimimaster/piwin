// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_STORED_TURN_HEIGHT_SESSIONS,
  MAX_STORED_TURN_HEIGHTS_PER_SESSION,
  TURN_HEIGHT_STORAGE_INDEX_KEY,
  TURN_HEIGHT_STORAGE_KEY_PREFIX,
  clearStoredTurnHeights,
  parseStoredTurnHeights,
  readStoredTurnHeights,
  removeStoredTurnHeights,
  writeStoredTurnHeights,
} from './transcript-turn-height-storage';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

describe('transcript turn height storage', () => {
  afterEach(() => {
    clearStoredTurnHeights();
  });

  it('round-trips heights and the column width per session', () => {
    const storage = memoryStorage();
    writeStoredTurnHeights('a', { widthPx: 720, heights: [['turn-1', 300], ['turn-2', 1200]] }, storage);
    expect(readStoredTurnHeights('a', storage)).toEqual({
      widthPx: 720,
      heights: [['turn-1', 300], ['turn-2', 1200]],
    });
    expect(readStoredTurnHeights('b', storage)).toBeNull();
  });

  it('keeps the newest turns and the most recent sessions only', () => {
    const storage = memoryStorage();
    const many = Array.from(
      { length: MAX_STORED_TURN_HEIGHTS_PER_SESSION + 5 },
      (_, index): [string, number] => [`turn-${index}`, 100 + index],
    );
    writeStoredTurnHeights('long', { widthPx: null, heights: many }, storage);
    const kept = readStoredTurnHeights('long', storage)?.heights ?? [];
    expect(kept).toHaveLength(MAX_STORED_TURN_HEIGHTS_PER_SESSION);
    expect(kept[0]?.[0]).toBe('turn-5');

    for (let index = 0; index < MAX_STORED_TURN_HEIGHT_SESSIONS; index += 1) {
      writeStoredTurnHeights(`s${index}`, { widthPx: null, heights: [['turn', 100]] }, storage);
    }
    // 'long' was the oldest of 25 sessions: its key is gone, not just unindexed.
    expect(storage.values.has(`${TURN_HEIGHT_STORAGE_KEY_PREFIX}long`)).toBe(false);
    expect(readStoredTurnHeights('s0', storage)).not.toBeNull();
    expect(JSON.parse(storage.values.get(TURN_HEIGHT_STORAGE_INDEX_KEY) ?? '[]')).toHaveLength(
      MAX_STORED_TURN_HEIGHT_SESSIONS,
    );
  });

  it('removes one session and drops entries it cannot trust', () => {
    const storage = memoryStorage();
    writeStoredTurnHeights('a', { widthPx: 720, heights: [['turn-1', 300]] }, storage);
    removeStoredTurnHeights('a', storage);
    expect(readStoredTurnHeights('a', storage)).toBeNull();
    expect(storage.values.has(TURN_HEIGHT_STORAGE_INDEX_KEY)).toBe(false);

    expect(
      parseStoredTurnHeights({
        widthPx: -3,
        heights: [['ok', 300], ['tiny', 2], ['huge', 99_999], [42, 300], 'bad'],
      }),
    ).toEqual({ widthPx: null, heights: [['ok', 300]] });
    storage.values.set(`${TURN_HEIGHT_STORAGE_KEY_PREFIX}corrupt`, '{nope');
    expect(readStoredTurnHeights('corrupt', storage)).toBeNull();
  });
});

describe('remembered turn heights across a restart', () => {
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it('writes measured heights after a quiet second and reads them in a fresh run', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const first = await import('./transcript-scroll-memory');
    first.rememberTranscriptTurnHeight('session-r', 'turn-1', 640, 720);
    first.rememberTranscriptTurnHeight('session-r', 'turn-2', 2_400, 720);
    expect(readStoredTurnHeights('session-r')).toBeNull();
    vi.advanceTimersByTime(1_000);
    expect(readStoredTurnHeights('session-r')?.heights).toEqual([
      ['turn-1', 640],
      ['turn-2', 2_400],
    ]);

    vi.resetModules();
    const restarted = await import('./transcript-scroll-memory');
    expect(restarted.readTranscriptTurnHeight('session-r', 'turn-2', 720)).toBe(2_400);
    // A different column re-wraps text: stored heights do not apply.
    vi.resetModules();
    const resized = await import('./transcript-scroll-memory');
    expect(resized.readTranscriptTurnHeight('session-r', 'turn-2', 900)).toBeNull();
  });

  it('flushes pending heights when the window goes away and forgets deleted sessions', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const memory = await import('./transcript-scroll-memory');
    memory.rememberTranscriptTurnHeight('session-f', 'turn-1', 500, 720);
    window.dispatchEvent(new Event('pagehide'));
    expect(readStoredTurnHeights('session-f')?.heights).toEqual([['turn-1', 500]]);
    memory.forgetTranscriptScrollPosition('session-f');
    expect(readStoredTurnHeights('session-f')).toBeNull();
  });
});
