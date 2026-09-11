import { describe, expect, it } from 'vitest';
import type { KnowledgeBaseSummary } from '@piwin/contracts';
import {
  isSearchableKnowledgeBase,
  readKnowledgeBaseList,
  readKnowledgeBaseMutation,
  readKnowledgeBaseRemoval,
  readKnowledgeSearchResult,
} from './knowledge-base-client.js';

const folderBase: KnowledgeBaseSummary = {
  id: 'folder:0123456789abcdef',
  kind: 'folder',
  name: 'docs',
  folderPath: '/Users/test/docs',
  state: 'ready',
  degraded: false,
  documentCount: 4,
};

describe('knowledge base response readers', () => {
  it('keeps only well-formed bases from a list payload', () => {
    const bases = readKnowledgeBaseList({
      bases: [folderBase, { id: 'x', kind: 'web', name: 'bad' }, { ...folderBase, state: 'stale' }],
    });
    expect(bases).toEqual([folderBase]);
    expect(readKnowledgeBaseList({})).toBeNull();
  });

  it('reads a mutation payload and a removal payload', () => {
    expect(readKnowledgeBaseMutation({ base: folderBase })).toEqual(folderBase);
    expect(readKnowledgeBaseMutation({ base: { id: 'x' } })).toBeNull();
    expect(readKnowledgeBaseRemoval({ removed: true, baseId: folderBase.id })).toBe(folderBase.id);
    expect(readKnowledgeBaseRemoval({ removed: false, baseId: folderBase.id })).toBeNull();
  });

  it('reads search results with skipped bases', () => {
    const result = readKnowledgeSearchResult({
      citations: [
        {
          ref: 1,
          baseId: folderBase.id,
          baseName: 'docs',
          kind: 'folder',
          title: 'a.md',
          text: 'passage',
        },
      ],
      degradedBaseIds: [folderBase.id],
      skipped: [{ baseId: 'notes', reason: 'not-indexed' }, { reason: 'error' }],
    });
    expect(result?.citations).toHaveLength(1);
    expect(result?.degradedBaseIds).toEqual([folderBase.id]);
    expect(result?.skipped).toEqual([{ baseId: 'notes', reason: 'not-indexed' }]);
    expect(readKnowledgeSearchResult({ citations: 'nope' })).toBeNull();
  });

  it('treats ready and partial bases as searchable', () => {
    expect(isSearchableKnowledgeBase(folderBase)).toBe(true);
    expect(isSearchableKnowledgeBase({ ...folderBase, state: 'partial' })).toBe(true);
    expect(isSearchableKnowledgeBase({ ...folderBase, state: 'indexing' })).toBe(false);
    expect(isSearchableKnowledgeBase({ ...folderBase, state: 'missing' })).toBe(false);
  });
});
