import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getModelCatalogStatus,
  lookupCatalogByModelId,
  resetModelCatalogSnapshot,
  searchPiCatalog,
} from '@piwin/agent-host';
import {
  getPiwinModelCatalogPath,
  loadModelCatalogFromDisk,
  syncModelCatalogFromModelsDev,
} from './model-catalog-store.js';

afterEach(() => {
  resetModelCatalogSnapshot();
});

const payload = {
  xai: {
    models: {
      'grok-4.6': {
        id: 'grok-4.6',
        name: 'Grok 4.6',
        reasoning: true,
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 500_000, output: 16_384 },
        cost: { input: 0, output: 0 },
      },
    },
  },
};

describe('model-catalog-store', () => {
  it('syncs from injected fetch, writes the snapshot, and installs lookup', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-catalog-'));
    const result = await syncModelCatalogFromModelsDev({
      rootDir,
      now: () => new Date('2026-09-21T12:00:00.000Z'),
      fetch: async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    expect(result.ok).toBe(true);
    expect(result.source).toBe('models.dev');
    expect(result.entryCount).toBe(1);
    expect(lookupCatalogByModelId('grok-4.6')?.contextWindow).toBe(500_000);
    expect(searchPiCatalog({ query: 'grok-4.6', limit: 1 }).catalogVersion).toBe(
      'models.dev@2026-09-21T12:00:00.000Z',
    );

    const written = JSON.parse(await readFile(getPiwinModelCatalogPath(rootDir), 'utf8')) as {
      source: string;
      entries: Array<{ modelId: string }>;
    };
    expect(written.source).toBe('models.dev');
    expect(written.entries[0]?.modelId).toBe('grok-4.6');

    resetModelCatalogSnapshot();
    expect(getModelCatalogStatus().source).toBe('pi-bootstrap');
    const loaded = loadModelCatalogFromDisk(rootDir);
    expect(loaded.source).toBe('models.dev');
    expect(lookupCatalogByModelId('grok-4.6')?.maxTokens).toBe(16_384);
  });

  it('does not clobber a previous snapshot when fetch fails', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-catalog-fail-'));
    await syncModelCatalogFromModelsDev({
      rootDir,
      now: () => new Date('2026-09-21T12:00:00.000Z'),
      fetch: async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    await expect(
      syncModelCatalogFromModelsDev({
        rootDir,
        fetch: async () => new Response('nope', { status: 503, statusText: 'Unavailable' }),
      }),
    ).rejects.toThrow(/503/);
    expect(lookupCatalogByModelId('grok-4.6')?.contextWindow).toBe(500_000);
    const written = JSON.parse(await readFile(getPiwinModelCatalogPath(rootDir), 'utf8')) as {
      catalogVersion: string;
    };
    expect(written.catalogVersion).toBe('models.dev@2026-09-21T12:00:00.000Z');
  });
});
