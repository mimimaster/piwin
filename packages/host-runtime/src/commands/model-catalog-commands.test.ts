import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookupCatalogByModelId, resetModelCatalogSnapshot } from '@piwin/agent-host';
import { handleModelCatalogCommand } from './model-catalog-commands.js';
import { syncModelCatalogFromModelsDev } from '../model-catalog-store.js';
import type { HostCommandContext } from './host-command-context.js';

afterEach(() => {
  resetModelCatalogSnapshot();
  vi.unstubAllGlobals();
});

function context(piwinRoot: string): HostCommandContext {
  return { piwinRoot } as HostCommandContext;
}

describe('handleModelCatalogCommand', () => {
  it('returns status for the Pi bootstrap before any sync', async () => {
    const response = await handleModelCatalogCommand(
      { type: 'models/catalog/status' },
      'req-status',
      context('/tmp/unused-catalog-status'),
    );
    expect(response).toMatchObject({
      command: 'models/catalog/status',
      success: true,
      data: { source: 'pi-bootstrap' },
    });
  });

  it('syncs via injected fetch when models/catalog/sync runs', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-catalog-cmd-'));
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          JSON.stringify({
            xai: {
              models: {
                'grok-4.6': {
                  id: 'grok-4.6',
                  name: 'Grok 4.6',
                  reasoning: true,
                  modalities: { input: ['text'], output: ['text'] },
                  limit: { context: 500_000, output: 8_192 },
                },
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const response = await handleModelCatalogCommand(
      { type: 'models/catalog/sync' },
      'req-sync',
      context(rootDir),
    );
    expect(response).toMatchObject({
      command: 'models/catalog/sync',
      success: true,
    });
    if (!response || response.type !== 'response' || !response.success) {
      throw new Error(`expected success, got ${JSON.stringify(response)}`);
    }
    const data = response.data as { ok: boolean; source: string; entryCount: number };
    expect(data.ok).toBe(true);
    expect(data.source).toBe('models.dev');
    expect(data.entryCount).toBeGreaterThan(0);
    expect(lookupCatalogByModelId('grok-4.6')?.contextWindow).toBe(500_000);
  });

  it('keeps the previous snapshot when sync fetch fails', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-catalog-cmd-fail-'));
    await syncModelCatalogFromModelsDev({
      rootDir,
      fetch: async () =>
        new Response(
          JSON.stringify({
            xai: {
              models: {
                'grok-4.6': {
                  id: 'grok-4.6',
                  name: 'Grok 4.6',
                  modalities: { input: ['text'], output: ['text'] },
                  limit: { context: 500_000, output: 8_192 },
                },
              },
            },
          }),
          { status: 200 },
        ),
    });
    vi.stubGlobal('fetch', async () => new Response('down', { status: 500, statusText: 'ERR' }));
    const response = await handleModelCatalogCommand(
      { type: 'models/catalog/sync' },
      'req-sync-fail',
      context(rootDir),
    );
    expect(response).toMatchObject({
      command: 'models/catalog/sync',
      success: false,
    });
    expect(lookupCatalogByModelId('grok-4.6')?.contextWindow).toBe(500_000);
  });
});
