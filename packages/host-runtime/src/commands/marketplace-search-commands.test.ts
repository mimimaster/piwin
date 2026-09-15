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

  it('installs an npm search hit through Pi package semantics', async () => {
    const installPackage = vi.fn(async (input: {
      source: string;
      workingDirectory: string;
      agentDirectory: string;
    }) => ({ source: input.source, installedPath: '/tmp/pi-agent/npm/node_modules/pi-subagents' }));

    const response = await handleMarketplaceSearchCommand(
      {
        type: 'marketplace/package-install',
        source: { kind: 'npm', packageName: 'pi-subagents' },
      },
      'req-install',
      {
        piwinRoot: '/tmp/piwin',
        agentDir: '/tmp/pi-agent',
        installPackage,
      },
    );

    expect(response?.success).toBe(true);
    expect(installPackage).toHaveBeenCalledWith({
      source: 'npm:pi-subagents',
      workingDirectory: '/tmp/piwin',
      agentDirectory: '/tmp/pi-agent',
    });
  });

  it('rejects package sources outside the searched npm and GitHub shapes', async () => {
    const installPackage = vi.fn();
    const response = await handleMarketplaceSearchCommand(
      {
        type: 'marketplace/package-install',
        source: { kind: 'git', repositoryUrl: 'file:///tmp/untrusted' },
      },
      'req-invalid',
      { installPackage },
    );

    expect(response?.success).toBe(false);
    expect(installPackage).not.toHaveBeenCalled();
  });

  it('normalizes a searched GitHub repository before installation', async () => {
    const installPackage = vi.fn(async (input: {
      source: string;
      workingDirectory: string;
      agentDirectory: string;
    }) => ({ source: input.source }));
    const response = await handleMarketplaceSearchCommand(
      {
        type: 'marketplace/package-install',
        source: {
          kind: 'git',
          repositoryUrl: 'https://github.com/nicobailon/pi-subagents.git',
        },
      },
      'req-git',
      { installPackage },
    );

    expect(response?.success).toBe(true);
    expect(installPackage).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'git:github.com/nicobailon/pi-subagents' }),
    );
  });
});
