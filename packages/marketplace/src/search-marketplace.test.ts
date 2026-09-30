import { describe, expect, it, vi } from 'vitest';
import { searchMarketplaceSources } from './search-marketplace.js';

describe('searchMarketplaceSources', () => {
  it('limits the browse preview and includes a GitHub package when available', async () => {
    const fetchFn = vi.fn(async (url: string) =>
      String(url).includes('registry.npmjs.org')
        ? {
            ok: true,
            json: async () => ({
              objects: ['one', 'two', 'three', 'four'].map((name) => ({
                package: { name: `pi-${name}`, version: '1.0.0', keywords: ['pi-package'] },
              })),
            }),
          }
        : {
            ok: true,
            json: async () => ({
              items: [
                {
                  full_name: 'owner/pi-github',
                  name: 'pi-github',
                  html_url: 'https://github.com/owner/pi-github',
                  default_branch: 'main',
                  owner: { login: 'owner' },
                },
              ],
            }),
          },
    );
    const result = await searchMarketplaceSources({
      query: '',
      limit: 4,
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(result.hits).toHaveLength(4);
    expect(result.hits.at(-1)?.source).toBe('github');
  });

  it('keeps npm hits first and drops GitHub clones of the same repo', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      const href = String(url);
      if (href.includes('registry.npmjs.org')) {
        return {
          ok: true,
          json: async () => ({
            objects: [
              {
                package: {
                  name: 'pi-subagents',
                  version: '0.67.0',
                  description: 'npm copy',
                  keywords: ['pi-package'],
                  links: {
                    repository: 'git+https://github.com/nicobailon/pi-subagents.git',
                  },
                },
              },
            ],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              full_name: 'nicobailon/pi-subagents',
              name: 'pi-subagents',
              html_url: 'https://github.com/nicobailon/pi-subagents',
              description: 'same repo',
              default_branch: 'main',
              owner: { login: 'nicobailon' },
            },
            {
              full_name: 'amosblomqvist/pi-subagents',
              name: 'pi-subagents',
              html_url: 'https://github.com/amosblomqvist/pi-subagents',
              description: 'git-only fork',
              default_branch: 'main',
              owner: { login: 'amosblomqvist' },
            },
          ],
        }),
      };
    });

    const result = await searchMarketplaceSources({
      query: 'subagents',
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(result.hits.map((hit) => hit.entryId)).toEqual([
      'npm:pi-subagents',
      'github:amosblomqvist/pi-subagents',
    ]);
  });

  it('still returns npm hits when GitHub is down', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).includes('api.github.com')) {
        throw new Error('GitHub down');
      }
      return {
        ok: true,
        json: async () => ({
          objects: [
            {
              package: {
                name: 'pi-subagents',
                version: '0.1.0',
                description: 'ok',
                keywords: ['pi-package'],
              },
            },
          ],
        }),
      };
    });
    const result = await searchMarketplaceSources({
      query: 'subagents',
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(result.hits).toHaveLength(1);
    expect(result.remoteError).toMatch(/GitHub/);
  });

  it('uses the injected fetch for every network source, including the MCP registry', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not use live network'));
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ objects: [], items: [], servers: [] })));
    try {
      await searchMarketplaceSources({ query: 'memory', fetch: fetchFn });
      expect(fetchFn.mock.calls.some(([url]) => String(url).includes('registry.modelcontextprotocol.io'))).toBe(true);
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });

  it('includes MCP registry servers and Skills when searching', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ objects: [], items: [] }),
    }));
    const result = await searchMarketplaceSources({
      query: 'memory',
      fetch: fetchFn as unknown as typeof fetch,
    });
    const mcpHit = result.hits.find((hit) => hit.source === 'mcp-registry');
    expect(mcpHit).toBeDefined();
    expect(mcpHit?.name).toContain('memory');
    expect(mcpHit?.kind).toBe('mcp');
  });
});

