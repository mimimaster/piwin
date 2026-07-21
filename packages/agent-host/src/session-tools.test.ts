import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  allowNetworkFetchHost,
  allowNetworkWebSearch,
  openOrCreateProject,
} from '@piwin/project';
import { buildSessionTools } from './session-tools.js';

describe('buildSessionTools permission gate', () => {
  it('denies ask by default without interactive gate (no network)', async () => {
    const { tools } = buildSessionTools({ webConfig: { searchProvider: 'none' } as never });
    const search = tools.find((tool) => tool.name === 'web_search');
    expect(search).toBeTruthy();
    await expect(search!.execute({ query: 'hello' })).rejects.toThrow(/Permission deny/);
  });

  it('blocks private fetch before network', async () => {
    const { tools } = buildSessionTools({});
    const fetchTool = tools.find((tool) => tool.name === 'web_fetch');
    await expect(fetchTool!.execute({ url: 'http://127.0.0.1/' })).rejects.toThrow(
      /Permission deny|private/,
    );
  });

  it('allows after interactive gate returns allow and then fails provider (no key)', async () => {
    const requestPermission = vi.fn(async () => 'allow' as const);
    const { tools } = buildSessionTools({
      webConfig: {
        searchProvider: 'brave',
        searchApiKeyEnv: 'MISSING_BRAVE_KEY_FOR_TEST',
        searchMaxResults: 3,
        fetchMaxBytes: 1000,
        fetchTimeoutMs: 1000,
        fetchBlockedUrlPrefixes: [],
      },
      requestPermission,
    });
    const search = tools.find((tool) => tool.name === 'web_search');
    await expect(search!.execute({ query: 'hello world' })).rejects.toThrow();
    expect(requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'network:web_search',
        detail: 'hello world',
      }),
    );
  });

  it('does not call gate when policy hard-denies', async () => {
    const requestPermission = vi.fn(async () => 'allow' as const);
    const { tools } = buildSessionTools({ requestPermission });
    const fetchTool = tools.find((tool) => tool.name === 'web_fetch');
    await expect(fetchTool!.execute({ url: 'file:///tmp/x' })).rejects.toThrow();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('skips gate when project remembers host / search', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-session-tools-'));
    const projectsFile = join(dir, 'projects.json');
    const projectPath = '/tmp/remember-project';
    await openOrCreateProject(projectsFile, projectPath, { trust: 'trusted' });
    await allowNetworkFetchHost(projectsFile, projectPath, 'example.com');
    await allowNetworkWebSearch(projectsFile, projectPath);

    const requestPermission = vi.fn(async () => 'deny' as const);
    const { tools } = buildSessionTools({
      projectPath,
      projectsFilePath: projectsFile,
      requestPermission,
      webConfig: {
        searchProvider: 'brave',
        searchApiKeyEnv: 'MISSING_BRAVE_KEY_FOR_TEST',
        searchMaxResults: 3,
        fetchMaxBytes: 1000,
        fetchTimeoutMs: 1000,
        fetchBlockedUrlPrefixes: [],
      },
    });

    const search = tools.find((tool) => tool.name === 'web_search');
    // remembered allow → gate not called; still fails on missing API key
    await expect(search!.execute({ query: 'cached search' })).rejects.toThrow();
    expect(requestPermission).not.toHaveBeenCalled();

    const fetchTool = tools.find((tool) => tool.name === 'web_fetch');
    // remembered host → gate not called; may fail later (DNS/network) but not on permission
    let fetchError: unknown;
    try {
      await fetchTool!.execute({ url: 'https://example.com/' });
    } catch (error) {
      fetchError = error;
    }
    if (fetchError) {
      expect(String(fetchError)).not.toMatch(/Permission/);
    }
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
