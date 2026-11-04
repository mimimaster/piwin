import { describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import {
  draftFromConcept,
  draftFromDistill,
  saveWikiPageDraft,
  setWikiDraftSaveAs,
} from './wiki-page-draft.js';

describe('wiki-page-draft', () => {
  it('requires a content hash before editing an existing page', () => {
    expect(
      draftFromConcept({
        title: 'Sleep',
        slug: 'sleep',
        content: 'body',
        tags: [],
        links: [],
        updatedAt: '2026-01-01T00:00:00Z',
        relativePath: 'concepts/sleep.md',
      }),
    ).toBeNull();
    expect(
      draftFromConcept({
        title: 'Sleep',
        slug: 'sleep',
        content: 'body',
        tags: [],
        links: [],
        updatedAt: '2026-01-01T00:00:00Z',
        relativePath: 'concepts/sleep.md',
        contentHash: 'abc',
      }),
    ).toMatchObject({ slug: 'sleep', expectedContentHash: 'abc' });
  });

  it('keeps the draft on a revision conflict', async () => {
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'knowledge/wiki/update') {
        return {
          type: 'response',
          command: command.type,
          success: false,
          error: 'changed',
          problem: { code: 'wiki-revision-conflict' },
        };
      }
      return { type: 'response', command: command.type, success: false, error: 'no' };
    });
    const result = await saveWikiPageDraft(request, {
      title: 'Sleep',
      content: 'new body',
      slug: 'sleep',
      expectedContentHash: 'old',
    });
    expect(result).toEqual({ ok: false, error: 'changed', conflict: true });
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      type: 'knowledge/wiki/update',
      input: { expectedContentHash: 'old', content: 'new body' },
    });
  });

  it('maps a distill draft onto create, or update when a same-slug page exists', () => {
    const created = draftFromDistill({
      title: 'Sleep debt',
      summary: 'Hours owed.',
      tags: ['health'],
      content: 'Draft body.',
      sources: [{ baseId: 'folder:abc', relativePath: 'a.md' }],
      relatedPages: [{ slug: 'circadian', title: 'Circadian', reason: 'tag' }],
    });
    expect(created.saveAs).toBe('create');
    expect(created.slug).toBeUndefined();

    const withExisting = draftFromDistill({
      ...created,
      title: 'Sleep debt',
      summary: created.summary ?? '',
      tags: created.tags ?? [],
      content: created.content,
      sources: created.sources ?? [],
      relatedPages: created.relatedPages ?? [],
      existingPage: {
        slug: 'sleep-debt',
        title: 'Sleep debt',
        content: 'Old body.',
        contentHash: 'hash-1',
      },
    });
    expect(withExisting.saveAs).toBe('update');
    expect(withExisting.expectedContentHash).toBe('hash-1');
    expect(setWikiDraftSaveAs(withExisting, 'create').slug).toBeUndefined();
    expect(setWikiDraftSaveAs(withExisting, 'update').expectedContentHash).toBe('hash-1');
  });
});
