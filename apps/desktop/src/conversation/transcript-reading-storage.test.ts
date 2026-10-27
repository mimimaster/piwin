import { describe, expect, it, vi } from 'vitest';
import {
  MAX_STORED_READING_POSITIONS,
  TRANSCRIPT_READING_STORAGE_KEY,
  parseTranscriptReadingPosition,
  readStoredTranscriptReadingPosition,
  removeStoredTranscriptReadingPosition,
  writeStoredTranscriptReadingPosition,
  type TranscriptReadingPosition,
} from './transcript-reading-storage';

function createMemoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & {
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function readingAt(messageId: string): TranscriptReadingPosition {
  return {
    followTail: false,
    anchor: { messageId, offset: -24 },
    lastSeenMessageId: 'seen-1',
    lastUserMessageId: 'user-1',
  };
}

describe('transcript reading storage', () => {
  it('round-trips a reading position per session', () => {
    const storage = createMemoryStorage();
    writeStoredTranscriptReadingPosition('session-a', readingAt('msg-1'), storage);
    writeStoredTranscriptReadingPosition('session-b', readingAt('msg-2'), storage);
    expect(readStoredTranscriptReadingPosition('session-a', storage)).toEqual(readingAt('msg-1'));
    expect(readStoredTranscriptReadingPosition('session-b', storage)).toEqual(readingAt('msg-2'));
    expect(readStoredTranscriptReadingPosition('session-c', storage)).toBeNull();
  });

  it('keeps the most recently written sessions only', () => {
    const storage = createMemoryStorage();
    for (let index = 0; index <= MAX_STORED_READING_POSITIONS; index += 1) {
      writeStoredTranscriptReadingPosition(`session-${index}`, readingAt(`msg-${index}`), storage);
    }
    expect(readStoredTranscriptReadingPosition('session-0', storage)).toBeNull();
    expect(readStoredTranscriptReadingPosition('session-1', storage)).not.toBeNull();
    // Rewriting an old session refreshes it instead of duplicating it.
    writeStoredTranscriptReadingPosition('session-1', readingAt('msg-again'), storage);
    const raw = JSON.parse(storage.values.get(TRANSCRIPT_READING_STORAGE_KEY) ?? '[]') as unknown[];
    expect(raw).toHaveLength(MAX_STORED_READING_POSITIONS);
    expect(readStoredTranscriptReadingPosition('session-1', storage)?.anchor?.messageId).toBe(
      'msg-again',
    );
  });

  it('removes one session and clears the key when nothing is left', () => {
    const storage = createMemoryStorage();
    writeStoredTranscriptReadingPosition('session-a', readingAt('msg-1'), storage);
    removeStoredTranscriptReadingPosition('session-a', storage);
    expect(readStoredTranscriptReadingPosition('session-a', storage)).toBeNull();
    expect(storage.values.has(TRANSCRIPT_READING_STORAGE_KEY)).toBe(false);
  });

  it('treats a corrupt store as empty and replaces it on the next write', () => {
    const storage = createMemoryStorage();
    storage.values.set(TRANSCRIPT_READING_STORAGE_KEY, '{not json');
    expect(readStoredTranscriptReadingPosition('session-a', storage)).toBeNull();
    writeStoredTranscriptReadingPosition('session-a', readingAt('msg-1'), storage);
    expect(readStoredTranscriptReadingPosition('session-a', storage)).toEqual(readingAt('msg-1'));
  });

  it('survives a storage that throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    expect(() =>
      writeStoredTranscriptReadingPosition('session-a', readingAt('msg-1'), storage),
    ).not.toThrow();
    expect(readStoredTranscriptReadingPosition('session-a', storage)).toBeNull();
    warn.mockRestore();
  });

  it('rejects positions that cannot be restored', () => {
    expect(parseTranscriptReadingPosition(null)).toBeNull();
    expect(parseTranscriptReadingPosition({ followTail: 'yes' })).toBeNull();
    // In history without a message to return to.
    expect(parseTranscriptReadingPosition({ followTail: false, anchor: null })).toBeNull();
    expect(
      parseTranscriptReadingPosition({
        followTail: false,
        anchor: { messageId: 'm', offset: Number.NaN },
      }),
    ).toBeNull();
    // At the tail the anchor is irrelevant and dropped.
    expect(
      parseTranscriptReadingPosition({
        followTail: true,
        anchor: { messageId: 'm', offset: 3 },
        lastSeenMessageId: 42,
      }),
    ).toEqual({ followTail: true, anchor: null, lastSeenMessageId: null, lastUserMessageId: null });
  });
});
