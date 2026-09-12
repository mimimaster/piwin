import { describe, expect, it, vi } from 'vitest';
import { searchMarketplaceSources } from './search-marketplace.js';

describe('searchMarketplaceSources', () => {
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
});
