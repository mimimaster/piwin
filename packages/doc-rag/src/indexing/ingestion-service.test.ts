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
});
