import { describe, expect, it, vi } from 'vitest';
import { MAX_README_CHARS, fetchPackageDetail, githubOwnerRepo } from './package-detail.js';

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

function textResponse(body: string): Response {
  return { ok: true, json: async () => JSON.parse(body), text: async () => body } as Response;
}

const notFound = { ok: false, status: 404 } as Response;

describe('githubOwnerRepo', () => {
  it('accepts only github.com owner/repo URLs', () => {
    expect(githubOwnerRepo('git+https://github.com/a/b.git')).toBe('a/b');
    expect(githubOwnerRepo('https://gitlab.com/a/b')).toBeUndefined();
    expect(githubOwnerRepo('https://github.com/a/b/tree/main')).toBeUndefined();
    expect(githubOwnerRepo(undefined)).toBeUndefined();
  });
});

describe('fetchPackageDetail', () => {
  it('reads README, license and update time from the npm registry', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe('https://registry.npmjs.org/pi-lens');
      return jsonResponse({
        readme: '# pi-lens',
        'dist-tags': { latest: '1.0.0' },
        versions: { '1.0.0': { license: 'MIT' } },
        time: { modified: '2026-10-01T00:00:00.000Z' },
      });
    });
    const detail = await fetchPackageDetail({
      entryId: 'npm:pi-lens',
      npmPackageName: 'pi-lens',
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(detail).toEqual({
      entryId: 'npm:pi-lens',
      readme: '# pi-lens',
      license: 'MIT',
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('falls back to GitHub for what npm lacks and keeps npm values first', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.startsWith('https://registry.npmjs.org/')) {
        return jsonResponse({
          'dist-tags': { latest: '2.0.0' },
          versions: { '2.0.0': { license: 'Apache-2.0', repository: { url: 'git+https://github.com/o/r.git' } } },
        });
      }
      if (url.endsWith('/readme')) return textResponse('# From GitHub');
      return jsonResponse({ license: { spdx_id: 'MIT' }, pushed_at: '2026-09-09T00:00:00Z' });
    });
    const detail = await fetchPackageDetail({
      entryId: 'npm:x',
      npmPackageName: 'x',
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(detail).toEqual({
      entryId: 'npm:x',
      readme: '# From GitHub',
      license: 'Apache-2.0',
      updatedAt: '2026-09-09T00:00:00Z',
    });
  });

  it('reports source failures as remoteError instead of throwing', async () => {
    const fetchFn = vi.fn(async () => notFound);
    const detail = await fetchPackageDetail({
      entryId: 'github:o/r',
      repositoryUrl: 'https://github.com/o/r',
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(detail.entryId).toBe('github:o/r');
    expect(detail.readme).toBeUndefined();
    expect(detail.remoteError).toContain('GitHub: HTTP 404');
  });

  it('truncates an oversized README', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ readme: 'x'.repeat(MAX_README_CHARS + 10), 'dist-tags': {} }),
    );
    const detail = await fetchPackageDetail({
      entryId: 'npm:big',
      npmPackageName: 'big',
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(detail.readme?.length).toBeLessThan(MAX_README_CHARS + 10);
  });
});
