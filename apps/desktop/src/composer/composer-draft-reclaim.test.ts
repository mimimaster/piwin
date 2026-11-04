import { describe, expect, it } from 'vitest';
import type { DraftSessionItemUi } from './draft-session.js';
import type { SessionComposerSnapshot } from '../hooks/composer-session-snapshot.js';
import { MAX_PERSISTED_COMPOSER_TEXT_CHARS } from './composer-draft-persistence.js';
import { canReclaimComposerDrafts } from './composer-draft-reclaim.js';

function fixture() {
  const now = new Date().toISOString();
  const drafts: DraftSessionItemUi[] = [
    {
      id: 'draft-1',
      name: 'Parked',
      text: 'keep me',
      createdAt: now,
      updatedAt: now,
      scope: { kind: 'general' },
      isDraft: true,
    },
  ];
  return {
    drafts,
    draftSnapshots: new Map<string, SessionComposerSnapshot>([
      ['draft-1', { text: 'keep me', attachments: [], contextRefs: [] }],
    ]),
    sessionSnapshots: new Map<string, SessionComposerSnapshot>([
      ['session-1', { text: 'parked session text', attachments: [], contextRefs: [] }],
    ]),
  };
}

describe('composer reclamation safety', () => {
  it('allows lossless persisted drafts and parked session text', () => {
    expect(canReclaimComposerDrafts(fixture())).toBe(true);
  });

  it('protects oversized text that persistence would truncate', () => {
    const input = fixture();
    input.sessionSnapshots.set('large', {
      text: 'x'.repeat(MAX_PERSISTED_COMPOSER_TEXT_CHARS + 1),
      attachments: [],
      contextRefs: [],
    });
    expect(canReclaimComposerDrafts(input)).toBe(false);
  });

  it('protects attachments parked in another session', () => {
    const input = fixture();
    input.sessionSnapshots.set('media', {
      text: '',
      contextRefs: [],
      attachments: [
        {
          localId: 'file-1',
          previewUrl: 'blob:pending',
          uploadStatus: 'queued',
          attachment: {
            kind: 'media',
            id: 'pending',
            path: '',
            mimeType: 'image/png',
            byteSize: 8,
            source: 'paste',
          },
        },
      ],
    });
    expect(canReclaimComposerDrafts(input)).toBe(false);
  });

  it('protects drafts beyond the persistence row limit', () => {
    const input = fixture();
    const first = input.drafts[0];
    if (!first) throw new Error('fixture draft missing');
    input.drafts = Array.from({ length: 21 }, (_, index) => ({ ...first, id: `draft-${index}` }));
    expect(canReclaimComposerDrafts(input)).toBe(false);
  });

  it('protects snapshot bodies omitted from persisted context references', () => {
    const input = fixture();
    input.sessionSnapshots.set('diff', {
      text: '',
      attachments: [],
      contextRefs: [
        { kind: 'diff', projectPath: '/project', label: 'Diff', snapshotText: 'unsaved diff' },
      ],
    });
    expect(canReclaimComposerDrafts(input)).toBe(false);
  });
});
