import { describe, expect, it, vi } from 'vitest';
import { handleMarketplaceSearchCommand } from './marketplace-search-commands.js';

describe('handleMarketplaceSearchCommand', () => {
  it('ignores unrelated commands', async () => {
    await expect(
      handleMarketplaceSearchCommand({ type: 'host/ping' }, 'req-1'),
    ).resolves.toBeNull();
  });

  it('returns npm hits without failing the command when the registry is reachable', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        objects: [
          {
            package: {
              name: 'pi-subagents',
              version: '0.67.0',
              description: 'subagents',
              keywords: ['pi-package'],
              links: { npm: 'https://www.npmjs.com/package/pi-subagents' },
            },
          },
        ],
      }),
    }));

    const response = await handleMarketplaceSearchCommand(
      { type: 'marketplace/search', query: 'pi-subagents' },
      'req-1',
      { fetch: fetchFn as unknown as typeof fetch },
    );

    expect(response?.success).toBe(true);
    expect(response && 'data' in response ? response.data : undefined).toMatchObject({
      query: 'pi-subagents',
      hits: [{ name: 'pi-subagents', installCommand: 'pi install npm:pi-subagents' }],
    });
  });

  it('keeps the command successful when npm is unreachable', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('network down');
    });
    const response = await handleMarketplaceSearchCommand(
      { type: 'marketplace/search', query: 'pi-subagents' },
      'req-2',
      { fetch: fetchFn as unknown as typeof fetch },
    );
    expect(response?.success).toBe(true);
    expect(response && 'data' in response ? response.data : undefined).toMatchObject({
      query: 'pi-subagents',
      hits: [],
    });
    const data = response && 'data' in response ? response.data : undefined;
    expect(data && typeof data === 'object' && 'remoteError' in data ? data.remoteError : '').toMatch(
      /network down/,
    );
  });
});
