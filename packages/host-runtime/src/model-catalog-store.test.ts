import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
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
  delete process.env.PIWIN_BUNDLED_ASSETS_ROOT;
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

function snapshot(modelId: string, context: number): string {
  return `${JSON.stringify({
    source: 'models.dev',
    fetchedAt: '2026-09-21T12:00:00.000Z',
    apiUrl: 'https://models.dev/api.json',
    catalogVersion: `models.dev@${modelId}`,
    entries: [
      {
        catalogProviderId: 'xai',
        modelId,
        name: modelId,
        input: ['text'],
        reasoning: false,
        contextWindow: context,
        maxTokens: 8_192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
    imageEntries: [],
  })}\n`;
}

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

  it('uses the bundled snapshot when the user cache is missing', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-catalog-user-'));
    const assetsRoot = await mkdtemp(join(tmpdir(), 'piwin-catalog-assets-'));
    const bundledDir = join(assetsRoot, 'model-catalog');
    await mkdir(bundledDir, { recursive: true });
    await writeFile(join(bundledDir, 'model-catalog.json'), snapshot('bundled-model', 111_000));
    process.env.PIWIN_BUNDLED_ASSETS_ROOT = assetsRoot;

    const loaded = loadModelCatalogFromDisk(rootDir);
    expect(loaded.source).toBe('models.dev');
    expect(lookupCatalogByModelId('bundled-model')?.contextWindow).toBe(111_000);
  });

  it('prefers the user cache over the bundled snapshot', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-catalog-user-win-'));
    const assetsRoot = await mkdtemp(join(tmpdir(), 'piwin-catalog-assets-win-'));
    await mkdir(join(assetsRoot, 'model-catalog'), { recursive: true });
    await writeFile(
      join(assetsRoot, 'model-catalog', 'model-catalog.json'),
      snapshot('bundled-model', 111_000),
    );
    await writeFile(getPiwinModelCatalogPath(rootDir), snapshot('user-model', 222_000));
    process.env.PIWIN_BUNDLED_ASSETS_ROOT = assetsRoot;

    loadModelCatalogFromDisk(rootDir);
    expect(lookupCatalogByModelId('user-model')?.contextWindow).toBe(222_000);
    expect(lookupCatalogByModelId('bundled-model')).toBeUndefined();
  });

  it('names the unreachable host instead of a bare fetch failure', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-catalog-net-'));
    await expect(
      syncModelCatalogFromModelsDev({
        rootDir,
        fetch: async () => {
          throw new TypeError('fetch failed');
        },
      }),
    ).rejects.toThrow(/https:\/\/models\.dev\/api\.json: fetch failed/);
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
