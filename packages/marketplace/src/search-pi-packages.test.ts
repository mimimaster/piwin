import { describe, expect, it, vi } from 'vitest';
import {
  isNpmPackageName,
  normalizeRepositoryUrl,
  piInstallCommand,
  searchPiNpmPackages,
} from './search-pi-packages.js';

function searchPayload(name: string, extraKeywords: string[] = ['pi-package']) {
  return {
    objects: [
      {
        downloads: { monthly: 12_000 },
        package: {
          name,
          version: '0.67.0',
          description: 'Pi extension for subagents',
          keywords: extraKeywords,
          links: {
            npm: `https://www.npmjs.com/package/${name}`,
            homepage: `https://github.com/nicobailon/${name}#readme`,
            repository: `git+https://github.com/nicobailon/${name}.git`,
          },
          publisher: { username: 'nicopreme' },
        },
      },
    ],
  };
}

describe('searchPiNpmPackages', () => {
  it('rejects names that are not npm package ids', () => {
    expect(isNpmPackageName('pi-subagents')).toBe(true);
    expect(isNpmPackageName('@tintinweb/pi-subagents')).toBe(true);
    expect(isNpmPackageName('pi install npm:foo')).toBe(false);
    expect(piInstallCommand('pi-subagents')).toBe('pi install npm:pi-subagents');
  });

  it('normalizes git+ and .git repository urls', () => {
    expect(normalizeRepositoryUrl('git+https://github.com/nicobailon/pi-subagents.git')).toBe(
      'https://github.com/nicobailon/pi-subagents',
    );
    expect(normalizeRepositoryUrl('not-a-url')).toBeUndefined();
  });

  it('queries npm with the pi-package keyword and maps hits', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      const parsed = new URL(String(url));
      expect(parsed.searchParams.get('text')).toBe('keywords:pi-package subagents');
      expect(parsed.searchParams.get('size')).toBe('20');
      return {
        ok: true,
        json: async () => searchPayload('pi-subagents'),
      };
    });

    const hits = await searchPiNpmPackages({
      query: 'subagents',
      fetch: fetchFn as unknown as typeof fetch,
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      entryId: 'npm:pi-subagents',
      name: 'pi-subagents',
      source: 'npm-pi-package',
      installCommand: 'pi install npm:pi-subagents',
      repositoryUrl: 'https://github.com/nicobailon/pi-subagents',
      publisher: 'nicopreme',
      monthlyDownloads: 12_000,
    });
  });

  it('drops hits that are not tagged pi-package', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => searchPayload('left-pad', ['utility']),
    }));
    const hits = await searchPiNpmPackages({
      query: 'left-pad',
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(hits).toEqual([]);
  });

  it('returns no network hits for an empty query', async () => {
    const fetchFn = vi.fn();
    await expect(
      searchPiNpmPackages({ query: '   ', fetch: fetchFn as unknown as typeof fetch }),
    ).resolves.toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
