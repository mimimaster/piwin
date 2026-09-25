import { describe, expect, it } from 'vitest';
import type { RemoteSessionSummary } from '@piwin/contracts';
import { readDraft, readSessionSnapshot, writeDraft, writeSessionSnapshot } from './mobile-offline-cache.js';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const sessions: RemoteSessionSummary[] = [
  { sessionId: 's1', name: '重连', scope: 'project', projectId: 'p1', lastPreview: 'x'.repeat(500) },
];

describe('session list snapshot', () => {
  it('round-trips per endpoint, trims previews and drops Host paths', () => {
    const storage = memoryStorage();
    writeSessionSnapshot(storage, 'ws://a:1', sessions, [{ projectId: 'p1', displayName: 'piwin', path: '/Users/me/piwin' }], new Date('2026-09-25T10:00:00Z'));
    const snapshot = readSessionSnapshot(storage, 'ws://a:1');
    expect(snapshot?.savedAt).toBe('2026-09-25T10:00:00.000Z');
    expect(snapshot?.sessions[0]?.lastPreview).toHaveLength(160);
    expect(snapshot?.projects).toEqual([{ projectId: 'p1', displayName: 'piwin' }]);
    expect(readSessionSnapshot(storage, 'ws://b:1')).toBeUndefined();
  });

  it('ignores corrupt or foreign data', () => {
    const storage = memoryStorage();
    storage.setItem(`piwin.mobile.session-snapshot.v1.${encodeURIComponent('ws://a:1')}`, '{"version":9}');
    expect(readSessionSnapshot(storage, 'ws://a:1')).toBeUndefined();
    storage.setItem(`piwin.mobile.session-snapshot.v1.${encodeURIComponent('ws://a:1')}`, 'not json');
    expect(readSessionSnapshot(storage, 'ws://a:1')).toBeUndefined();
    expect(readSessionSnapshot(undefined, 'ws://a:1')).toBeUndefined();
  });
});

describe('drafts', () => {
  it('keeps one draft per session and clears on empty text', () => {
    const storage = memoryStorage();
    writeDraft(storage, 'ws://a:1', 's1', '写了一半');
    writeDraft(storage, 'ws://a:1', 's2', '另一段');
    expect(readDraft(storage, 'ws://a:1', 's1')).toBe('写了一半');
    expect(readDraft(storage, 'ws://a:1', 's2')).toBe('另一段');
    writeDraft(storage, 'ws://a:1', 's1', '  ');
    expect(readDraft(storage, 'ws://a:1', 's1')).toBe('');
    writeDraft(storage, 'ws://a:1', 's2', '');
    expect(storage.data.size).toBe(0);
  });

  it('keeps only the most recent drafts', () => {
    const storage = memoryStorage();
    for (let index = 0; index < 35; index += 1) {
      writeDraft(storage, 'ws://a:1', `s${index}`, 'x', new Date(Date.UTC(2026, 8, 25, 0, index)));
    }
    expect(readDraft(storage, 'ws://a:1', 's0')).toBe('');
    expect(readDraft(storage, 'ws://a:1', 's34')).toBe('x');
  });
});
