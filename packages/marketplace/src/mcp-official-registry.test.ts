import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearOfficialMcpSearchCache } from './mcp-official-registry.js';
import {
  cardFromOfficialServer,
  officialMcpServerId,
  parseOfficialRegistryServers,
  searchOfficialMcpRegistry,
} from './mcp-official-registry.js';
import { searchMarketplaceSources } from './search-marketplace.js';
import { listMcpRegistryCards } from './mcp-registry.js';

const NPM_SERVER = {
  name: 'com.pulsemcp/remote-filesystem',
  description: 'Remote filesystem on GCS.',
  version: '0.1.5',
  repository: { url: 'https://github.com/pulsemcp/mcp-servers', source: 'github' },
  packages: [
    {
      registryType: 'npm',
      identifier: 'remote-filesystem-mcp-server',
      version: '0.1.5',
      transport: { type: 'stdio' },
      runtimeArguments: [{ value: '-y', type: 'positional' }],
      packageArguments: [{ type: 'named', name: '--root', default: '/data' }],
      environmentVariables: [
        { name: 'GCS_BUCKET', isRequired: true },
        { name: 'LOG_LEVEL', default: 'info' },
        { name: 'GCS_PRIVATE_KEY', isSecret: true },
      ],
    },
  ],
};


beforeEach(() => {
  clearOfficialMcpSearchCache();
});

describe('cardFromOfficialServer', () => {
  it('turns an npm stdio package into a pinned npx draft with required env vars', () => {
    expect(cardFromOfficialServer(NPM_SERVER)).toMatchObject({
      id: 'official:com.pulsemcp/remote-filesystem',
      source: 'official',
      version: '0.1.5',
      repositoryUrl: 'https://github.com/pulsemcp/mcp-servers',
      installDraft: {
        command: 'npx',
        args: ['-y', 'remote-filesystem-mcp-server@0.1.5', '--root', '/data'],
        env: { LOG_LEVEL: 'info' },
      },
      requiredEnv: ['GCS_BUCKET'],
    });
  });

  it('uses uvx for PyPI packages', () => {
    const card = cardFromOfficialServer({
      name: 'io.github.acme/py-mcp',
      packages: [{ registryType: 'pypi', identifier: 'py-mcp', version: '1.2.0' }],
    });
    expect(card?.installDraft).toEqual({ command: 'uvx', args: ['py-mcp==1.2.0'] });
    expect(card?.requiredEnv).toBeUndefined();
  });

  it('turns a remote-only server into a url draft when it needs no key', () => {
    const card = cardFromOfficialServer({
      name: 'ac.snag/snag',
      remotes: [{ type: 'streamable-http', url: 'https://mcp.snag.ac/mcp' }],
    });
    expect(card?.installDraft).toEqual({ type: 'http', url: 'https://mcp.snag.ac/mcp' });
    expect(card?.requiresSse).toBeUndefined();
  });

  it('keeps a remote that needs a secret header out of one-click install', () => {
    const card = cardFromOfficialServer({
      name: 'io.example/keyed',
      remotes: [
        {
          type: 'sse',
          url: 'https://mcp.example.io/sse',
          headers: [{ name: 'Authorization', isRequired: true, isSecret: true }],
        },
        { type: 'streamable-http', url: 'https://{tenant}.example.io/mcp' },
      ],
    });
    expect(card?.installDraft).toBeUndefined();
    expect(card?.requiresSse).toBe(true);
  });

  it('rejects package identifiers that are not plain package names', () => {
    const card = cardFromOfficialServer({
      name: 'x/evil',
      packages: [{ registryType: 'npm', identifier: '--foo; rm -rf /' }],
    });
    expect(card?.installDraft).toBeUndefined();
  });
});

describe('parseOfficialRegistryServers', () => {
  it('keeps one card per server, preferring the latest version', () => {
    const cards = parseOfficialRegistryServers({
      servers: [
        { server: { ...NPM_SERVER, description: 'old' }, _meta: {} },
        {
          server: NPM_SERVER,
          _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } },
        },
        { server: { ...NPM_SERVER, description: 'older than latest' }, _meta: {} },
      ],
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.description).toBe('Remote filesystem on GCS.');
  });

  it('derives a local server id from the registry name', () => {
    expect(officialMcpServerId('io.github.acme/fs-mcp')).toBe('fs-mcp');
  });
});

describe('listMcpRegistryCards official search', () => {
  it('passes the query to the registry and appends its servers after the static cards', async () => {
    const fetchFn = vi.fn(async (_url: string) => ({
      ok: true,
      json: async () => ({ servers: [{ server: NPM_SERVER }] }),
    }));
    const cards = await listMcpRegistryCards({
      query: 'filesystem',
      includeOfficial: true,
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain('search=filesystem');
    expect(cards.at(-1)?.id).toBe('official:com.pulsemcp/remote-filesystem');
  });
});

describe('searchOfficialMcpRegistry', () => {
  it('asks for latest versions only and caches a query for a while', async () => {
    let clock = 0;
    const fetchFn = vi.fn(async (_url: string) => ({
      ok: true,
      json: async () => ({ servers: [{ server: NPM_SERVER }] }),
    }));
    const search = () =>
      searchOfficialMcpRegistry({
        query: 'Files',
        fetch: fetchFn as unknown as typeof fetch,
        now: () => clock,
      });
    await search();
    await search();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain('version=latest');
    clock = 11 * 60_000;
    await search();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('lists local packages, then keyless remotes, then key-gated remotes', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        servers: [
          {
            server: {
              name: 'a.remote/keyed',
              remotes: [
                {
                  type: 'streamable-http',
                  url: 'https://keyed.example/mcp',
                  headers: [{ name: 'X-Api-Key', isRequired: true }],
                },
              ],
            },
          },
          { server: { name: 'b.remote/open', remotes: [{ type: 'streamable-http', url: 'https://x.example/mcp' }] } },
          { server: NPM_SERVER },
        ],
      }),
    }));
    const cards = await searchOfficialMcpRegistry({ query: 'order', fetch: fetchFn as unknown as typeof fetch });
    expect(cards.map((card) => card.id)).toEqual([
      'official:com.pulsemcp/remote-filesystem',
      'official:b.remote/open',
      'official:a.remote/keyed',
    ]);
  });

  it('throws on HTTP failure so callers can report it', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 504 }));
    await expect(
      searchOfficialMcpRegistry({ query: 'x', fetch: fetchFn as unknown as typeof fetch }),
    ).rejects.toThrow('HTTP 504');
  });
});

describe('searchMarketplaceSources source groups', () => {
  it('runs only the requested groups and reports a registry failure', async () => {
    const fetchFn = vi.fn(async (url: string) =>
      String(url).includes('modelcontextprotocol')
        ? { ok: false, status: 504 }
        : { ok: true, json: async () => ({ objects: [], items: [], skills: [] }) },
    );
    const mcpOnly = await searchMarketplaceSources({
      query: 'memory',
      sources: ['mcp'],
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(fetchFn.mock.calls.every(([url]) => String(url).includes('modelcontextprotocol'))).toBe(true);
    // Curated cards survive the registry failure, which is reported.
    expect(mcpOnly.hits.every((hit) => hit.source === 'mcp-registry')).toBe(true);
    expect(mcpOnly.hits.length).toBeGreaterThan(0);
    expect(mcpOnly.remoteError).toContain('MCP registry: MCP registry search failed: HTTP 504');

    fetchFn.mockClear();
    const fast = await searchMarketplaceSources({
      query: 'memory',
      sources: ['packages', 'skills'],
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(fetchFn.mock.calls.some(([url]) => String(url).includes('modelcontextprotocol'))).toBe(false);
    expect(fast.hits.some((hit) => hit.source === 'mcp-registry')).toBe(false);
  });
});
