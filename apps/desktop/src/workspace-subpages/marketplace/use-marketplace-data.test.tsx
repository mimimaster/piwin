// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostCommand, HostResponse, MarketplaceCatalogEntry } from '@piwin/contracts';
import { flush } from '../workspace-subpages-test-helpers.js';
import { useMarketplaceData, type MarketplaceData } from './use-marketplace-data.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SNAPSHOT_ENTRY: MarketplaceCatalogEntry = {
  entryId: 'skill:local',
  capabilityId: 'local',
  kind: 'skill',
  category: 'docs-research',
  name: { en: 'Local skill', zhCN: '本地技能' },
  summary: { en: 'Local snapshot', zhCN: '本地快照' },
  description: { en: 'Local snapshot', zhCN: '本地快照' },
  version: 'a'.repeat(40),
  author: 'test',
  sourceLabel: 'GitHub',
  install: {
    kind: 'skill',
    source: { kind: 'git', url: 'https://github.com/test/local', ref: 'a'.repeat(40) },
  },
  requirements: [],
  examples: [],
  verification: [{ level: 'author-declared' }],
  featured: false,
};
const REMOTE_ENTRY: MarketplaceCatalogEntry = {
  ...SNAPSHOT_ENTRY,
  entryId: 'skill:remote',
  capabilityId: 'remote',
};

function deferred<Value>() {
  let resolve: (value: Value) => void = () => {
    throw new Error('not initialized');
  };
  const promise = new Promise<Value>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function ok(command: HostCommand['type'], data: unknown): HostResponse {
  return { type: 'response', command, success: true, data };
}

describe('useMarketplaceData progressive loading', () => {
  let root: Root;
  let container: HTMLDivElement;
  let latest: MarketplaceData | undefined;

  beforeEach(() => {
    latest = undefined;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function Harness(props: {
    request: (command: HostCommand) => Promise<HostResponse>;
    sessionId: string;
  }) {
    latest = useMarketplaceData(props);
    return null;
  }

  function render(
    request: (command: HostCommand) => Promise<HostResponse>,
    sessionId = 'session-1',
  ) {
    act(() => root.render(<Harness request={request} sessionId={sessionId} />));
  }

  it('finishes initial loading before a slow registry refresh resolves, then updates the inventory', async () => {
    const remote = deferred<HostResponse>();
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'marketplace/catalog-list') {
        if (!command.cachedOnly) return remote.promise;
        return ok(command.type, { entries: [SNAPSHOT_ENTRY] });
      }
      return ok(command.type, { revision: '0', items: [] });
    });
    render(request);
    await flush();

    expect(latest?.loading).toBe(false);
    expect(latest?.entries).toEqual([SNAPSHOT_ENTRY]);
    expect(request).toHaveBeenCalledWith({
      type: 'marketplace/catalog-list',
      includeWithdrawn: true,
      cachedOnly: true,
    });
    expect(
      request.mock.calls.filter(([command]) => command.type === 'marketplace/installed-list'),
    ).toHaveLength(1);

    remote.resolve(ok('marketplace/catalog-list', { entries: [SNAPSHOT_ENTRY, REMOTE_ENTRY] }));
    await flush();
    expect(latest?.entries).toEqual([SNAPSHOT_ENTRY, REMOTE_ENTRY]);
    expect(
      request.mock.calls.filter(([command]) => command.type === 'marketplace/installed-list'),
    ).toHaveLength(2);
  });

  it('reports rejected Host requests and exits the loading state', async () => {
    render(vi.fn().mockRejectedValue(new Error('host disconnected')));
    await flush();

    expect(latest?.loading).toBe(false);
    expect(latest?.error).toBe('host disconnected');
  });

  it('keeps the snapshot visible when the refresh is rejected', async () => {
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'marketplace/catalog-list') {
        if (!command.cachedOnly) throw new Error('refresh disconnected');
        return ok(command.type, { entries: [SNAPSHOT_ENTRY] });
      }
      return ok(command.type, { revision: '0', items: [] });
    });
    render(request);
    await flush();

    expect(latest?.loading).toBe(false);
    expect(latest?.entries).toEqual([SNAPSHOT_ENTRY]);
    expect(latest?.error).toBe('refresh disconnected');
  });

  it('ignores old inventory responses after switching session scope', async () => {
    const previousInventory = deferred<HostResponse>();
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'marketplace/catalog-list')
        return ok(command.type, { entries: [SNAPSHOT_ENTRY] });
      if (command.type === 'marketplace/installed-list' && command.sessionId === 'session-1') {
        return previousInventory.promise;
      }
      return ok(command.type, { revision: 'new', items: [] });
    });
    render(request);
    await flush();
    render(request, 'session-2');
    await flush();
    expect(latest?.loading).toBe(false);

    previousInventory.resolve({
      type: 'response',
      command: 'marketplace/installed-list',
      success: false,
      error: 'old session error',
    });
    await flush();
    expect(latest?.error).toBeNull();
    expect(
      request.mock.calls.filter(
        ([command]) => command.type === 'marketplace/catalog-list' && !command.cachedOnly,
      ),
    ).toHaveLength(1);
  });

  it('does not start another inventory refresh after leaving the page', async () => {
    const remote = deferred<HostResponse>();
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'marketplace/catalog-list') {
        return command.cachedOnly
          ? ok(command.type, { entries: [SNAPSHOT_ENTRY] })
          : remote.promise;
      }
      return ok(command.type, { revision: '0', items: [] });
    });
    render(request);
    await flush();
    act(() => root.render(null));
    const callCount = request.mock.calls.length;

    remote.resolve(ok('marketplace/catalog-list', { entries: [REMOTE_ENTRY] }));
    await flush();
    expect(request).toHaveBeenCalledTimes(callCount);
  });
});
