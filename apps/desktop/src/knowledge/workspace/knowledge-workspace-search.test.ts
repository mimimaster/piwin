import { describe, expect, it } from 'vitest';
import type { KnowledgeCitation, KnowledgeSearchResult } from '@piwin/contracts';
import {
  evidenceHitsForAskAi,
  mergeWorkspaceSearchHits,
} from './knowledge-workspace-search.js';

function citation(partial: Partial<KnowledgeCitation> & Pick<KnowledgeCitation, 'kind' | 'title' | 'text'>): KnowledgeCitation {
  return {
    ref: partial.ref ?? 1,
    baseId: partial.baseId ?? 'folder:abc',
    baseName: partial.baseName ?? 'Docs',
    kind: partial.kind,
    title: partial.title,
    text: partial.text,
    ...(partial.relativePath ? { relativePath: partial.relativePath } : {}),
    ...(partial.metadata ? { metadata: partial.metadata } : {}),
  };
}

const search: KnowledgeSearchResult = {
  citations: [
    citation({
      kind: 'folder',
      title: 'fsrs.md',
      text: 'Spaced repetition schedule.',
      relativePath: 'fsrs.md',
    }),
    citation({
      ref: 2,
      baseId: 'wiki',
      baseName: 'Wiki',
      kind: 'wiki',
      title: 'FSRS',
      text: 'Compiled page about FSRS.',
      relativePath: 'concepts/fsrs.md',
      metadata: { sources: [{ baseId: 'folder:abc', relativePath: 'fsrs.md' }] },
    }),
  ],
  degradedBaseIds: [],
  skipped: [{ baseId: 'folder:pending', reason: 'not-indexed' }],
};

describe('mergeWorkspaceSearchHits', () => {
  it('groups materials, wiki and cards and marks derived wiki', () => {
    const page = mergeWorkspaceSearchHits({
      query: 'fsrs',
      search,
      catalog: {
        tiles: [{ kind: 'single', id: 'card_1', count: 1, preview: 'What is FSRS?' }],
        dueCount: 0,
        newCount: 0,
        unfinishedRounds: [],
      },
    });
    expect(page.groups.map((group) => group.kind)).toEqual(['material', 'wiki', 'card']);
    expect(page.groups[1]?.hits[0]?.derivedFromId).toBe('material:folder:abc:fsrs.md');
    expect(page.unindexed).toBe(true);
  });

  it('adds title matches only when the document is not already a citation', () => {
    const page = mergeWorkspaceSearchHits({
      query: 'pending',
      search: { citations: [], degradedBaseIds: [], skipped: [{ baseId: 'folder:pending', reason: 'not-indexed' }] },
      titleMatches: [
        {
          baseId: 'folder:pending',
          baseName: 'Inbox',
          entry: {
            relativePath: 'notes.md',
            title: 'pending notes',
            extension: 'md',
            sizeBytes: 10,
            language: 'markdown',
            indexed: false,
            chunkCount: 0,
            readability: 'text',
          },
        },
      ],
    });
    expect(page.groups[0]?.hits[0]).toMatchObject({
      titleMatchOnly: true,
      title: 'pending notes',
    });
  });

  it('keeps cards out of Ask-AI evidence and drops derived wiki when the original is present', () => {
    const page = mergeWorkspaceSearchHits({ query: 'fsrs', search, catalog: {
      tiles: [{ kind: 'single', id: 'card_1', count: 1, preview: 'What is FSRS?' }],
      dueCount: 0,
      newCount: 0,
      unfinishedRounds: [],
    } });
    const all = page.groups.flatMap((group) => group.hits);
    const evidence = evidenceHitsForAskAi(all);
    expect(evidence.map((hit) => hit.kind)).toEqual(['material']);
  });
});
