/**
 * Stage 7: one isolated piwinRoot, one real library. Open, read Chinese,
 * search, keep the wiki and cards that were already there. Listing never
 * rewrites user files.
 */
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStudyServices } from '@piwin/flashcards';
import { createDefaultPiwinConfig } from './config-store.js';
import { listKnowledgeBaseSummaries, type KnowledgeBaseRuntime } from './knowledge-base-service.js';
import { listKnowledgeCollections } from './knowledge-collections.js';
import {
  listKnowledgeDocuments,
  readKnowledgeDocument,
  type KnowledgeDocumentsRuntime,
} from './knowledge-documents.js';
import { searchKnowledgeBases } from './knowledge-retriever.js';
import { getPiwinWikiDir } from './paths.js';
import { readWikiConcept } from './wiki-service.js';
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
  await writeFile(
    join(getPiwinWikiDir(fixture.root), 'concepts', 'legacy-note.md'),
    '---\ntitle: 旧页无来源\ntags: [兼容]\n---\n\n这是升级前写的页面，没有 sources 字段。\n',
    'utf8',
  );
});

afterAll(async () => {
  await fixture.close();
});

async function documentsRuntime(): Promise<KnowledgeDocumentsRuntime> {
  const bases = await listKnowledgeBaseSummaries(runtime);
  return { bases, getFolderRag: runtime.getFolderRag };
}

describe('knowledge workspace full path on existing user data', () => {
  it('lists an unindexed folder from disk and reads Chinese from an indexed one', async () => {
    const docs = await documentsRuntime();
    const unindexed = await listKnowledgeDocuments(docs, { baseId: fixture.unindexedBaseId });
    expect(unindexed.items.map((item) => item.relativePath)).toEqual(['泛型.md']);
    expect(unindexed.items[0]?.indexed).toBe(false);

    const window = await readKnowledgeDocument(docs, {
      baseId: fixture.indexedBaseId,
      relativePath: '极限的定义.md',
      startLine: 1,
      maxLines: 40,
    });
    expect(window.title).toContain('极限');
    expect(window.text).toContain('epsilon-N');
    expect(window.text).toContain('def converges');
    expect(window.hasMore).toBe(false);
  });

  it('reads a wiki page written before sources existed', async () => {
    const concept = await readWikiConcept(fixture.root, 'legacy-note');
    expect(concept?.title).toBe('旧页无来源');
    expect(concept?.content).toContain('没有 sources 字段');
    expect(concept?.sources).toBeUndefined();
  });

  it('searches the indexed library in Chinese and leaves cards and collections intact', async () => {
    const basicPath = join(fixture.root, 'flashcards', 'cards', `${fixture.basicItemId}.md`);
    const before = await stat(basicPath);
    const rawBefore = await readFile(basicPath, 'utf8');

    const result = await searchKnowledgeBases(runtime, { query: '极限' });
    expect(result.citations.some((citation) => citation.baseId === fixture.indexedBaseId)).toBe(true);

    const cards = await createStudyServices({ piwinRoot: fixture.root }).cardStore.listReviewCards();
    const basic = cards.find((card) => card.model === 'basic');
    expect(basic?.sourceFile).toBe('极限的定义.md');
    expect(cards).toHaveLength(2);

    const collections = await listKnowledgeCollections(fixture.root);
    expect(collections[0]?.name).toBe('考研数学');

    const after = await stat(basicPath);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(await readFile(basicPath, 'utf8')).toBe(rawBefore);
  });
});
