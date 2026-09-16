import { describe, expect, it } from 'vitest';
import {
  COMPOSER_DRAFT_MAX_AGE_MS,
  attachmentHintsFromChips,
  buildComposerDraftStore,
  composerDraftPersistenceKey,
  draftsFromPersistedStore,
  loadComposerDraftStore,
  parseComposerDraftStore,
  readComposerDraftPartitionId,
  saveComposerDraftStore,
} from './composer-draft-persistence';
import type { PendingComposerAttachment } from './media-utils.js';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

describe('composer draft persistence', () => {
  it('partitions storage by host instance and rejects another host', () => {
    expect(composerDraftPersistenceKey('host-a')).toContain('host-a');
    expect(
      parseComposerDraftStore(
        {
          version: 1,
          hostInstanceId: 'host-a',
          savedAt: '2026-09-01T00:00:00.000Z',
          drafts: [],
          sessionSnapshots: [],
        },
        'host-b',
      ),
    ).toBeNull();
  });

  it('keeps text and file refs, drops snapshot bodies and stale rows', () => {
    const now = Date.parse('2026-09-01T00:00:00.000Z');
    const store = parseComposerDraftStore(
      {
        version: 1,
        hostInstanceId: 'host-1',
        savedAt: '2026-09-01T00:00:00.000Z',
        drafts: [
          {
            id: 'd1',
            name: 'Keep',
            text: 'unsent',
            createdAt: '2026-08-20T00:00:00.000Z',
            updatedAt: '2026-08-20T00:00:00.000Z',
            scope: { kind: 'general' },
            contextRefs: [
              { kind: 'file', projectPath: '/p', relativePath: 'a.ts', label: 'a.ts' },
              { kind: 'diff', projectPath: '/p', snapshotText: 'SECRET', label: 'diff' },
            ],
            attachmentHints: [{ name: 'shot.png', mimeType: 'image/png', byteSize: 12 }],
          },
          {
            id: 'old',
            name: 'Expired',
            text: 'gone',
            createdAt: '2020-01-01T00:00:00.000Z',
            updatedAt: '2020-01-01T00:00:00.000Z',
            scope: { kind: 'general' },
            contextRefs: [],
            attachmentHints: [],
          },
        ],
        sessionSnapshots: [
          {
            sessionId: 's1',
            text: 'parked',
            updatedAt: '2026-08-20T00:00:00.000Z',
            contextRefs: [],
            attachmentHints: [],
          },
        ],
      },
      'host-1',
      now,
    );
    expect(store?.drafts).toHaveLength(1);
    expect(store?.drafts[0]?.contextRefs).toEqual([
      { kind: 'file', projectPath: '/p', relativePath: 'a.ts', label: 'a.ts' },
    ]);
    expect(store?.drafts[0]?.attachmentHints).toEqual([
      { name: 'shot.png', mimeType: 'image/png', byteSize: 12 },
    ]);
    expect(now - Date.parse('2020-01-01T00:00:00.000Z')).toBeGreaterThan(COMPOSER_DRAFT_MAX_AGE_MS);
    const restored = draftsFromPersistedStore(store!);
    expect(restored.draftSnapshots.get('d1')?.attachments).toEqual([]);
    expect(restored.sessionSnapshots.get('s1')?.text).toBe('parked');
  });

  it('serializes in-memory drafts without File/blob chips', () => {
    const chip: PendingComposerAttachment = {
      localId: 'c1',
      previewUrl: 'blob:secret',
      attachment: {
        id: 'a1',
        kind: 'media',
        path: '/tmp/shot.png',
        mimeType: 'image/png',
        name: 'shot.png',
        byteSize: 4,
        source: 'paste',
      },
    };
    expect(attachmentHintsFromChips([chip])).toEqual([
      { name: 'shot.png', mimeType: 'image/png', byteSize: 4 },
    ]);
    const justNow = new Date(Date.now() - 1_000).toISOString();
    const built = buildComposerDraftStore({
      hostInstanceId: 'host-1',
      drafts: [
        {
          id: 'd1',
          name: 'shot.png',
          text: 'caption',
          // Relative to now: a calendar date would eventually age past
          // COMPOSER_DRAFT_MAX_AGE_MS and drop the row on both write and read.
          createdAt: justNow,
          updatedAt: justNow,
          scope: { kind: 'project', projectPath: '/p' },
          isDraft: true,
        },
      ],
      draftSnapshots: new Map([
        ['d1', { text: 'caption', attachments: [chip], contextRefs: [] }],
      ]),
      sessionSnapshots: new Map(),
    });
    const serialized = JSON.stringify(built);
    expect(serialized).not.toContain('blob:');
    expect(serialized).not.toContain('/tmp/shot.png');
    expect(built.drafts[0]?.attachmentHints[0]?.name).toBe('shot.png');
    const storage = memoryStorage();
    saveComposerDraftStore(built, storage);
    expect(loadComposerDraftStore('host-1', storage)?.drafts[0]?.text).toBe('caption');
    expect(loadComposerDraftStore('host-other', storage)).toBeNull();
  });

  it('uses local/mock transport as a fallback partition and ignores remote without an id', () => {
    expect(readComposerDraftPartitionId({ getHostInstanceId: () => 'host-9' })).toBe('host-9');
    expect(readComposerDraftPartitionId({ getTransport: () => 'local' })).toBe('local');
    expect(readComposerDraftPartitionId({ getTransport: () => 'remote' })).toBeNull();
  });
});
