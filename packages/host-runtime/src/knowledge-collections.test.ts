import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  KnowledgeCollectionsError,
  knowledgeCollectionCounts,
  listKnowledgeCollections,
  readKnowledgeCollections,
} from './knowledge-collections.js';
import { getPiwinKnowledgeCollectionsPath } from './paths.js';

const cleanup: string[] = [];

afterEach(async () => {
  for (const dir of cleanup.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function root(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'piwin-collections-'));
  cleanup.push(dir);
  return dir;
}

async function writeCollections(dir: string, body: unknown): Promise<void> {
  const filePath = getPiwinKnowledgeCollectionsPath(dir);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(body), 'utf8');
}

describe('knowledge collections store', () => {
  it('treats a never-created file as an empty set', async () => {
    const dir = await root();
    expect(await listKnowledgeCollections(dir)).toEqual([]);
    expect(await readKnowledgeCollections(dir)).toEqual({ version: 1, collections: [] });
  });

  it('reports a corrupt file instead of overwriting it with an empty set', async () => {
    const dir = await root();
    const filePath = getPiwinKnowledgeCollectionsPath(dir);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, '{ not json', 'utf8');
    await expect(listKnowledgeCollections(dir)).rejects.toBeInstanceOf(KnowledgeCollectionsError);
  });

  it('refuses an unsupported schema version', async () => {
    const dir = await root();
    await writeCollections(dir, { version: 99, collections: [] });
    await expect(listKnowledgeCollections(dir)).rejects.toThrow(/unsupported version 99/);
  });

  it('derives counts from membership and lists newest first', async () => {
    const dir = await root();
    await writeCollections(dir, {
      version: 1,
      collections: [
        {
          id: 'older',
          name: '考研数学',
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-02T00:00:00.000Z',
          members: [{ kind: 'wiki', relativePath: 'concepts/limit.md' }],
        },
        {
          id: 'newer',
          name: 'Java 学习',
          createdAt: '2026-10-03T00:00:00.000Z',
          updatedAt: '2026-10-04T00:00:00.000Z',
          members: [
            { kind: 'material', baseId: 'folder:0123456789abcdef', relativePath: 'a.md' },
            { kind: 'material', baseId: 'folder:0123456789abcdef', relativePath: 'b.md' },
            { kind: 'card', itemId: 'card-1' },
          ],
        },
      ],
    });

    const collections = await listKnowledgeCollections(dir);
    expect(collections.map((collection) => collection.id)).toEqual(['newer', 'older']);
    expect(collections[0]?.counts).toEqual({ notes: 0, materials: 2, wiki: 0, cards: 1 });
    expect(collections[1]?.counts).toEqual({ notes: 0, materials: 0, wiki: 1, cards: 0 });
  });

  it('counts one member once and drops members it cannot parse', () => {
    const counts = knowledgeCollectionCounts([
      { kind: 'notes', noteId: 'note-1' },
      { kind: 'notes', noteId: 'note-1' },
      { kind: 'wiki', relativePath: 'concepts/a.md' },
    ]);
    expect(counts).toEqual({ notes: 1, materials: 0, wiki: 1, cards: 0 });
  });

  it('drops unknown member kinds from a newer Host instead of failing the listing', async () => {
    const dir = await root();
    await writeCollections(dir, {
      version: 1,
      collections: [
        {
          id: 'mixed',
          name: '兼容',
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z',
          members: [
            { kind: 'wiki', relativePath: 'concepts/a.md' },
            { kind: 'graph-node', nodeId: 'future' },
          ],
        },
      ],
    });
    const collections = await listKnowledgeCollections(dir);
    expect(collections).toHaveLength(1);
    expect(collections[0]?.counts).toEqual({ notes: 0, materials: 0, wiki: 1, cards: 0 });
  });
});
