import { describe, expect, it } from 'vitest';
import type { ContextPackSource, NoteRecord, NoteSearchHit } from '@piwin/contracts';
import {
  citationIdentity,
  clampKnowledgeSearchLimit,
  mapContextPackSourceToCitation,
  mapNoteHitToCitation,
  mergeRankedKnowledgeHits,
  skipReasonForBase,
} from './knowledge-retriever.js';

function note(id: string, title: string): NoteRecord {
  return {
    id,
    collection: 'default',
    title,
    content: `body of ${title}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    relativePath: `default/${id}.md`,
    contentHash: `hash-${id}`,
  };
}

function noteHit(id: string, title: string, score: number, snippet: string): NoteSearchHit {
  return {
    note: note(id, title),
    score,
    snippet,
    channels: ['fts'],
    rank: { fts: 1 },
  };
}

const folderSource: ContextPackSource = {
  chunkId: 'c1',
  documentId: 'd1',
  relativePath: 'guide/intro.md',
  headingPath: ['Intro'],
  startLine: 12,
  endLine: 20,
  text: 'Spaced repetition schedules reviews.',
  retrievalScore: 0.8,
  retrievedBy: 'hybrid',
};

describe('citation mapping', () => {
  it('maps note hits to noteId + title', () => {
    const citation = mapNoteHitToCitation(noteHit('n1', 'FSRS', 0.5, 'review interval'), {
      id: 'notes',
      name: 'Notes',
    });
    expect(citation).toMatchObject({
      baseId: 'notes',
      kind: 'notes',
      title: 'FSRS',
      noteId: 'n1',
      text: 'review interval',
      score: 0.5,
    });
    expect(citation.relativePath).toBeUndefined();
  });

  it('maps ContextPackSource fields onto a folder citation', () => {
    const citation = mapContextPackSourceToCitation(folderSource, {
      id: 'folder:0123456789abcdef',
      name: 'Docs',
    });
    expect(citation).toMatchObject({
      baseId: 'folder:0123456789abcdef',
      kind: 'folder',
      title: 'guide/intro.md',
      relativePath: 'guide/intro.md',
      headingPath: ['Intro'],
      startLine: 12,
      endLine: 20,
      text: 'Spaced repetition schedules reviews.',
      score: 0.8,
    });
  });
});

describe('mergeRankedKnowledgeHits', () => {
  it('fuses per-base lists with RRF and numbers refs from startRef', () => {
    const notes = mapNoteHitToCitation(noteHit('n1', 'Notes hit', 1, 'from notes'), {
      id: 'notes',
      name: 'Notes',
    });
    const folder = mapContextPackSourceToCitation(folderSource, {
      id: 'folder:0123456789abcdef',
      name: 'Docs',
    });
    const merged = mergeRankedKnowledgeHits(
      [
        { baseId: 'notes', citations: [notes] },
        { baseId: 'folder:0123456789abcdef', citations: [folder] },
      ],
      { limit: 8, startRef: 4, rrfK: 60 },
    );
    expect(merged).toHaveLength(2);
    expect(merged.map((item) => item.ref)).toEqual([4, 5]);
    expect(merged[0]?.score).toBeCloseTo(1 / 61, 10);
    expect(new Set(merged.map((item) => citationIdentity(item))).size).toBe(2);
  });

  it('caps total snippet characters and truncates the overflowing citation', () => {
    const long = mapContextPackSourceToCitation(
      { ...folderSource, text: 'abcdefghij' },
      { id: 'folder:aaaaaaaaaaaaaaaa', name: 'A' },
    );
    const next = mapContextPackSourceToCitation(
      { ...folderSource, relativePath: 'b.md', text: 'xyz' },
      { id: 'folder:bbbbbbbbbbbbbbbb', name: 'B' },
    );
    const merged = mergeRankedKnowledgeHits(
      [
        { baseId: long.baseId, citations: [long] },
        { baseId: next.baseId, citations: [next] },
      ],
      { maxTotalChars: 8, rrfK: 1 },
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.text.length).toBe(8);
  });
});

describe('clampKnowledgeSearchLimit', () => {
  it('defaults and clamps to the contract max', () => {
    expect(clampKnowledgeSearchLimit(undefined)).toBe(8);
    expect(clampKnowledgeSearchLimit(0)).toBe(8);
    expect(clampKnowledgeSearchLimit(99)).toBe(30);
  });
});

describe('skipReasonForBase', () => {
  it('maps derived states onto skip reasons', () => {
    expect(skipReasonForBase(undefined)).toBe('unknown');
    expect(
      skipReasonForBase({
        id: 'folder:0123456789abcdef',
        kind: 'folder',
        name: 'Docs',
        state: 'missing',
        degraded: false,
        documentCount: 0,
      }),
    ).toBe('missing');
    expect(
      skipReasonForBase({
        id: 'notes',
        kind: 'notes',
        name: 'Notes',
        state: 'empty',
        degraded: false,
        documentCount: 0,
      }),
    ).toBeNull();
  });
});
