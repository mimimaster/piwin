import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createParserRegistry } from '../parsers/registry.js';
import { openLanceDocIndex } from './lancedb-index.js';
import { ingestSelectedFiles } from './ingestion-service.js';
import { openFolderStateStore } from './state-store.js';

describe('ingestSelectedFiles', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('skips unchanged files and rejects an empty selection', async () => {
    dir = await mkdtemp(join(tmpdir(), 'piwin-ingest-'));
    const folder = join(dir, 'docs');
    await mkdir(folder);
    await writeFile(join(folder, 'a.md'), '# Hello\n\nWorld.');
    const store = await openLanceDocIndex(join(dir, 'lance'));
    const state = await openFolderStateStore(join(dir, 'state.sqlite3'));
    const registry = createParserRegistry();
    const first = await ingestSelectedFiles({
      canonicalPath: folder,
      relativePaths: ['a.md'],
      registry,
      store,
      state,
    });
    expect(first[0]?.status).toBe('READY');
    const second = await ingestSelectedFiles({
      canonicalPath: folder,
      relativePaths: ['a.md'],
      registry,
      store,
      state,
    });
    expect(second[0]?.status).toBe('SKIPPED');
    await expect(
      ingestSelectedFiles({
        canonicalPath: folder,
        relativePaths: [],
        registry,
        store,
        state,
      }),
    ).rejects.toThrow('NO_SUPPORTED_FILES');
    store.close();
    state.close();
  });

  it('keeps old chunks when embedding fails after a READY ingest', async () => {
    dir = await mkdtemp(join(tmpdir(), 'piwin-ingest-keep-'));
    const folder = join(dir, 'docs');
    await mkdir(folder);
    await writeFile(join(folder, 'a.md'), '# Hello\n\nOld searchable content.');
    const store = await openLanceDocIndex(join(dir, 'lance'));
    const state = await openFolderStateStore(join(dir, 'state.sqlite3'));
    const registry = createParserRegistry();
    const first = await ingestSelectedFiles({
      canonicalPath: folder,
      relativePaths: ['a.md'],
      registry,
      store,
      state,
    });
    expect(first[0]?.status).toBe('READY');
    const documentId = first[0]?.documentId;
    if (!documentId) throw new Error('missing documentId');
    expect(await store.hasDocument(documentId)).toBe(true);

    await writeFile(join(folder, 'a.md'), '# Hello\n\nUpdated body that should not replace yet.');
    const failed = await ingestSelectedFiles({
      canonicalPath: folder,
      relativePaths: ['a.md'],
      registry,
      store,
      state,
      embedding: {
        providerId: 'test',
        modelId: 'fail',
        dimension: 2,
        embedDocuments: async () => {
          throw new Error('embed down');
        },
        embedQuery: async () => [0, 0],
      },
    });
    expect(failed[0]?.status).toBe('FAILED');
    expect(await store.hasDocument(documentId)).toBe(true);
    const folderKey = state.get(documentId)?.folderKey;
    if (!folderKey) throw new Error('missing folderKey');
    const hits = await store.ftsSearch({
      text: 'searchable',
      folderKey,
      documentIds: [documentId],
    });
    expect(hits.some((hit) => hit.chunk.content.includes('Old searchable content'))).toBe(true);
    expect(hits.every((hit) => !hit.chunk.content.includes('Updated body'))).toBe(true);
    expect(state.get(documentId)?.status).toBe('FAILED');
    store.close();
    state.close();
  });
});
