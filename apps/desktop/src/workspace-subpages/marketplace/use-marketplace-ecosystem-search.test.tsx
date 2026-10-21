// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { HostCommand, HostResponse, MarketplaceSearchHit } from '@piwin/contracts';
import { flush } from '../workspace-subpages-test-helpers.js';
import {
  useMarketplaceEcosystemSearch,
  type MarketplaceEcosystemSearch,
} from './use-marketplace-ecosystem-search.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function hit(entryId: string, source: MarketplaceSearchHit['source']): MarketplaceSearchHit {
  return { entryId, name: entryId, version: '1', description: '', source, installCommand: '' };
}

function deferred<Value>() {
  let resolve: (value: Value) => void = () => {
    throw new Error('not initialized');
  };
  const promise = new Promise<Value>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function searchResponse(hits: MarketplaceSearchHit[], remoteError?: string): HostResponse {
  return {
    type: 'response',
    command: 'marketplace/search',
    success: true,
    data: { query: 'q', hits, ...(remoteError ? { remoteError } : {}) },
  };
}

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe('useMarketplaceEcosystemSearch split search', () => {
  it('shows fast sources first and appends MCP registry hits when they arrive', async () => {
    const mcp = deferred<HostResponse>();
    const commands: HostCommand[] = [];
    const request = async (command: HostCommand): Promise<HostResponse> => {
      commands.push(command);
      if (command.type === 'marketplace/search' && command.sources?.includes('mcp')) return mcp.promise;
      return searchResponse([hit('npm:a', 'npm-pi-package'), hit('skill:b', 'skill')]);
    };
    const probe: { current: MarketplaceEcosystemSearch | null } = { current: null };
    function Probe() {
      probe.current = useMarketplaceEcosystemSearch({ request });
      return null;
    }
    const container = document.createElement('div');
    root = createRoot(container);
    act(() => root?.render(<Probe />));

    let done: Promise<void> = Promise.resolve();
    await act(async () => {
      done = probe.current?.search('memory') ?? Promise.resolve();
      await flush();
    });
    const sources = commands.map((command) =>
      command.type === 'marketplace/search' ? command.sources : undefined,
    );
    expect(sources).toEqual(expect.arrayContaining([['mcp'], ['packages', 'skills']]));
    expect(probe.current?.loading).toBe(false);
    expect(probe.current?.mcpLoading).toBe(true);
    expect(probe.current?.hits.map((item) => item.entryId)).toEqual(['npm:a', 'skill:b']);

    await act(async () => {
      mcp.resolve(searchResponse([hit('mcp:c', 'mcp-registry')], 'MCP registry: timeout'));
      await done;
    });
    expect(probe.current?.mcpLoading).toBe(false);
    // Combined order: packages, MCP servers, skills.
    expect(probe.current?.hits.map((item) => item.entryId)).toEqual(['npm:a', 'mcp:c', 'skill:b']);
    expect(probe.current?.error).toBe('MCP registry: timeout');
  });
});
