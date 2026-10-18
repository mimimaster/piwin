import { afterEach, describe, expect, it, vi } from 'vitest';

function deferred<Value>() {
  let resolve: (value: Value) => void = () => {
    throw new Error('not initialized');
  };
  const promise = new Promise<Value>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function extensionIndex() {
  return {
    schemaVersion: 1,
    extensions: [
      {
        id: 'test/community',
        name: 'Community extension',
        repository: 'https://github.com/test/community',
        owners: ['test'],
        versions: [{ version: '1.0.0', commit: 'a'.repeat(40) }],
      },
    ],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

describe('marketplace catalog snapshots', () => {
  it('returns the offline catalog on a cold read without starting network requests', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchImpl);
    const { listMarketplaceWithExtensions } = await import('./extension-registry-index.js');

    const entries = await listMarketplaceWithExtensions({ cachedOnly: true, kinds: ['mcp'] });

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.kind === 'mcp')).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps snapshots available during a refresh and includes remote entries after it finishes', async () => {
    const extensionFetch = deferred<Response>();
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith('agents.json')
        ? Response.json({ schemaVersion: 1, agents: [] })
        : extensionFetch.promise,
    );
    vi.stubGlobal('fetch', fetchImpl);
    const { listMarketplaceWithExtensions } = await import('./extension-registry-index.js');

    const refresh = listMarketplaceWithExtensions();
    const concurrentRefresh = listMarketplaceWithExtensions();
    const snapshot = await listMarketplaceWithExtensions({ cachedOnly: true });
    expect(snapshot.length).toBeGreaterThan(0);
    expect(snapshot.some((entry) => entry.entryId === 'extension:test/community')).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    extensionFetch.resolve(Response.json(extensionIndex()));
    await Promise.all([refresh, concurrentRefresh]);
    const cached = await listMarketplaceWithExtensions({
      cachedOnly: true,
      query: 'Community extension',
    });
    expect(cached).toHaveLength(1);
    expect(cached[0]?.entryId).toBe('extension:test/community');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('preserves an expired snapshot when the background refresh fails', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      Response.json(
        String(url).endsWith('agents.json') ? { schemaVersion: 1, agents: [] } : extensionIndex(),
      ),
    );
    vi.stubGlobal('fetch', fetchImpl);
    const { listMarketplaceWithExtensions } = await import('./extension-registry-index.js');
    await listMarketplaceWithExtensions();
    vi.advanceTimersByTime(300_001);
    fetchImpl.mockRejectedValue(new Error('offline'));

    const snapshot = await listMarketplaceWithExtensions({ cachedOnly: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await listMarketplaceWithExtensions();
    expect(await listMarketplaceWithExtensions({ cachedOnly: true })).toEqual(snapshot);
    expect(snapshot.some((entry) => entry.entryId === 'extension:test/community')).toBe(true);
  });
});
