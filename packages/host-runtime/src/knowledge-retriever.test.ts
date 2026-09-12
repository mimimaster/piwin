import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ContextPackSource } from '@piwin/contracts';
import { createFolderRag } from '@piwin/doc-rag';
import { createDefaultPiwinConfig } from './config-store.js';
import {
  addFolderKnowledgeBase,
  type KnowledgeBaseRuntime,
} from './knowledge-base-service.js';
import {
  citationIdentity,
  clampKnowledgeSearchLimit,
  mapContextPackSourceToCitation,
  mapContextPackSourceToNotesCitation,
  mapContextPackSourceToWikiCitation,
  mergeRankedKnowledgeHits,
  searchKnowledgeBases,
  skipReasonForBase,
} from './knowledge-retriever.js';

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

const cleanup: string[] = [];

afterEach(async () => {
  for (const dir of cleanup.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('citation mapping', () => {
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

  it('derives noteId from the filename and prefers metadata.title', () => {
    const citation = mapContextPackSourceToNotesCitation(
      {
        ...folderSource,
        relativePath: 'work/note-abc.md',
        metadata: { title: 'FSRS', tags: ['srs'] },
      },
      { id: 'notes', name: 'Notes' },
    );
    expect(citation).toMatchObject({
      baseId: 'notes',
      kind: 'notes',
      title: 'FSRS',
      noteId: 'note-abc',
      relativePath: 'work/note-abc.md',
      metadata: { title: 'FSRS', tags: ['srs'] },
    });
  });

  it('falls back to relativePath when metadata title is missing', () => {
    const citation = mapContextPackSourceToNotesCitation(
      { ...folderSource, relativePath: 'inbox/stray.md' },
      { id: 'notes', name: 'Notes' },
    );
    expect(citation.title).toBe('inbox/stray.md');
    expect(citation.noteId).toBe('stray');
  });

  it('maps ContextPackSource onto a wiki citation with kind wiki', () => {
    const citation = mapContextPackSourceToWikiCitation(
      {
        ...folderSource,
        relativePath: 'concepts/transformer.md',
        metadata: { title: 'Transformer Architecture' },
      },
      { id: 'wiki', name: 'Wiki' },
    );
    expect(citation).toMatchObject({
      baseId: 'wiki',
      kind: 'wiki',
      title: 'Transformer Architecture',
      relativePath: 'concepts/transformer.md',
    });
  });
});

describe('mergeRankedKnowledgeHits', () => {
  it('fuses per-base lists with RRF and numbers refs from startRef', () => {
    const notes = mapContextPackSourceToNotesCitation(
      {
        ...folderSource,
        relativePath: 'default/n1.md',
        text: 'from notes',
        metadata: { title: 'Notes hit' },
      },
      { id: 'notes', name: 'Notes' },
    );
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
        state: 'not-indexed',
        degraded: false,
        documentCount: 0,
      }),
    ).toBe('not-indexed');
  });
});

describe('tags pre-filter', () => {
  it('returns a tagged match that ranks outside the unfiltered top-k', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-kb-tags-root-'));
    const folder = await mkdtemp(join(tmpdir(), 'piwin-kb-tags-src-'));
    cleanup.push(root, folder);
    await mkdir(join(root, 'notes'), { recursive: true });
    for (let i = 0; i < 8; i += 1) {
      await writeFile(
        join(folder, `popular-${i}.md`),
        `# Popular ${i}\n\napple apple apple apple apple unique-${i}\n`,
      );
    }
    await writeFile(
      join(folder, 'rare.md'),
      [
        '---',
        'title: "Rare apple"',
        'tags: ["rare"]',
        '---',
        '',
        '# Rare',
        '',
        'apple once.',
      ].join('\n'),
    );
    const rag = createFolderRag({ piwinRoot: root });
    await rag.indexFolder(folder);
    const runtime: KnowledgeBaseRuntime = {
      piwinRoot: root,
      getFolderRag: async () => rag,
      loadConfig: async () => createDefaultPiwinConfig(),
    };
    const added = await addFolderKnowledgeBase(runtime, folder, 'Docs');
    const unfiltered = await searchKnowledgeBases(runtime, {
      query: 'apple',
      baseIds: [added.id],
      limit: 3,
    });
    expect(unfiltered.citations.every((citation) => citation.relativePath !== 'rare.md')).toBe(
      true,
    );
    const filtered = await searchKnowledgeBases(runtime, {
      query: 'apple',
      baseIds: [added.id],
      tags: ['rare'],
      limit: 3,
    });
    expect(filtered.citations.some((citation) => citation.relativePath === 'rare.md')).toBe(true);
    rag.close();
  });
});
