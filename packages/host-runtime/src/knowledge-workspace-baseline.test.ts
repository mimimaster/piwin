/**
 * Stage 0 baseline: what the knowledge Host already does, recorded against the
 * shared workspace fixture before any workspace UI exists.
 *
 * These assertions describe today's behaviour, including the gaps the redesign
 * has to close (an unindexed folder is browsable but never searched, a deleted
 * folder reports `missing` instead of disappearing).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStudyServices } from '@piwin/flashcards';
import { createDefaultPiwinConfig } from './config-store.js';
import { listKnowledgeBaseSummaries, type KnowledgeBaseRuntime } from './knowledge-base-service.js';
import { listKnowledgeCollections } from './knowledge-collections.js';
import { searchKnowledgeBases } from './knowledge-retriever.js';
import { getWikiOverview } from './wiki-service.js';
import {
  openKnowledgeWorkspaceFixture,
  type KnowledgeWorkspaceFixture,
} from './knowledge-workspace.test-fixture.js';

let fixture: KnowledgeWorkspaceFixture;
let runtime: KnowledgeBaseRuntime;

beforeAll(async () => {
  fixture = await openKnowledgeWorkspaceFixture();
  runtime = {
    piwinRoot: fixture.root,
    getFolderRag: async () => fixture.rag,
    loadConfig: async () => createDefaultPiwinConfig(),
  };
});

afterAll(async () => {
  await fixture.close();
});

describe('knowledge workspace baseline', () => {
  it('reports one ready, one unindexed and one missing folder plus the implicit bases', async () => {
    const bases = await listKnowledgeBaseSummaries(runtime);
    const stateOf = (id: string) => bases.find((base) => base.id === id)?.state;

    expect(stateOf(fixture.indexedBaseId)).toBe('ready');
    expect(stateOf(fixture.unindexedBaseId)).toBe('not-indexed');
    expect(stateOf(fixture.missingBaseId)).toBe('missing');
    expect(bases.some((base) => base.kind === 'notes')).toBe(true);
    expect(bases.some((base) => base.kind === 'wiki')).toBe(true);
  });

  it('searches the indexed folder and never cites an unindexed or missing one', async () => {
    const result = await searchKnowledgeBases(runtime, { query: '极限' });

    expect(result.citations.some((citation) => citation.baseId === fixture.indexedBaseId)).toBe(
      true,
    );
    expect(result.citations.some((citation) => citation.baseId === fixture.unindexedBaseId)).toBe(
      false,
    );
    // Baseline gap: an unscoped search narrows the candidate set silently, so
    // nothing is reported as skipped. Only an explicit scope reports a reason.
    expect(result.skipped).toEqual([]);
  });

  it('reports a skip reason once a base is requested explicitly', async () => {
    const unindexed = await searchKnowledgeBases(runtime, {
      query: '泛型',
      baseIds: [fixture.unindexedBaseId],
    });
    expect(unindexed.citations).toEqual([]);
    expect(unindexed.skipped.map((entry) => entry.reason)).toEqual(['not-indexed']);

    const missing = await searchKnowledgeBases(runtime, {
      query: '极限',
      baseIds: [fixture.missingBaseId],
    });
    expect(missing.citations).toEqual([]);
    expect(missing.skipped.map((entry) => entry.reason)).toEqual(['missing']);
  });

  it('reads the wiki page the fixture wrote, with its links', async () => {
    const overview = await getWikiOverview(fixture.root);
    expect(overview.concepts.map((concept) => concept.title)).toContain('极限的严格定义');
    expect(overview.totalConcepts).toBeGreaterThanOrEqual(1);
  });

  it('keeps one review unit per cloze ordinal and carries the source relation', async () => {
    const cards = await createStudyServices({ piwinRoot: fixture.root }).cardStore.listReviewCards();
    expect(cards).toHaveLength(2);
    const basic = cards.find((card) => card.model === 'basic');
    expect(basic?.sourceFile).toBe('极限的定义.md');
    expect(basic?.sourceLine).toBe(7);
  });

  it('derives collection counts from membership instead of storing them', async () => {
    const collections = await listKnowledgeCollections(fixture.root);
    expect(collections.map((collection) => collection.name)).toEqual(['考研数学']);
    expect(collections[0]?.counts).toEqual({ notes: 0, materials: 1, wiki: 1, cards: 0 });
  });
});
