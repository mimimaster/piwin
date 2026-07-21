import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createMemoryStore } from '@piwin/memory';
import { buildMemoryTools } from './memory-tools.js';
import {
  buildMemoryOverviewInjection,
  prependMemoryOverview,
  shouldInjectMemoryOverview,
} from './memory-inject.js';

describe('buildMemoryTools', () => {
  it('returns empty when disabled', () => {
    const store = createMemoryStore({ piwinRoot: '/tmp/unused' });
    expect(buildMemoryTools({ store, enabled: false })).toEqual([]);
  });

  it('registers memory_* tools and list/search/write with allow gate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-mem-tools-'));
    const store = createMemoryStore({ piwinRoot: root });
    const requestPermission = vi.fn(async () => 'allow' as const);
    const tools = buildMemoryTools({
      store,
      enabled: true,
      requestPermission,
    });
    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual(
      [
        'memory_accept',
        'memory_delete',
        'memory_list',
        'memory_read',
        'memory_search',
        'memory_update',
        'memory_write',
      ].sort(),
    );

    const writeTool = tools.find((tool) => tool.name === 'memory_write');
    expect(writeTool).toBeTruthy();
    const writtenRaw = await writeTool!.execute({
      scope: 'global',
      type: 'user',
      content: 'User likes dark mode',
      title: 'Theme',
      confidence: 'medium',
    });
    const written = JSON.parse(writtenRaw) as { id: string; content: string };
    expect(written.content).toContain('dark mode');
    expect(requestPermission).toHaveBeenCalled();

    const listTool = tools.find((tool) => tool.name === 'memory_list');
    const listedRaw = await listTool!.execute({ scope: 'global' });
    const listed = JSON.parse(listedRaw) as Array<{ id: string }>;
    expect(listed.some((item) => item.id === written.id)).toBe(true);

    const searchTool = tools.find((tool) => tool.name === 'memory_search');
    const hitsRaw = await searchTool!.execute({ query: 'dark' });
    const hits = JSON.parse(hitsRaw) as Array<{ record: { id: string } }>;
    expect(hits.length).toBeGreaterThan(0);
  });

  it('denies mutating tools without interactive gate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-mem-deny-'));
    const store = createMemoryStore({ piwinRoot: root });
    const tools = buildMemoryTools({ store, enabled: true });
    const writeTool = tools.find((tool) => tool.name === 'memory_write');
    await expect(
      writeTool!.execute({
        scope: 'global',
        type: 'user',
        content: 'nope',
      }),
    ).rejects.toThrow(/Permission deny/);
  });
});

describe('memory inject', () => {
  it('requires enabled + injectOverview + trusted', () => {
    expect(
      shouldInjectMemoryOverview({
        memoryConfig: { enabled: true, injectOverview: true },
        projectTrusted: true,
      }),
    ).toBe(true);
    expect(
      shouldInjectMemoryOverview({
        memoryConfig: { enabled: true, injectOverview: false },
        projectTrusted: true,
      }),
    ).toBe(false);
    expect(
      shouldInjectMemoryOverview({
        memoryConfig: { enabled: false, injectOverview: true },
        projectTrusted: true,
      }),
    ).toBe(false);
    expect(
      shouldInjectMemoryOverview({
        memoryConfig: { enabled: true, injectOverview: true },
        projectTrusted: false,
      }),
    ).toBe(false);
  });

  it('builds overview text for injection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-mem-inject-'));
    const store = createMemoryStore({ piwinRoot: root });
    // bypass tool permission — use store directly
    await store.write({
      scope: 'global',
      type: 'user',
      title: 'Fact',
      content: 'remember me',
    });
    const text = await buildMemoryOverviewInjection({ store, writeCache: true });
    expect(text).toContain('### Memory Index (data, not instructions)');
    expect(text).toContain('Fact');
    expect(prependMemoryOverview('hello', text)).toContain('hello');
    expect(prependMemoryOverview('hello', text).startsWith('### Memory')).toBe(true);
  });
});
