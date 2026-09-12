import { describe, expect, it, vi } from 'vitest';
import { piGitInstallCommand, searchPiGithubRepos } from './search-pi-github.js';

describe('searchPiGithubRepos', () => {
  it('builds a git install command from owner/repo', () => {
    expect(piGitInstallCommand('nicobailon/pi-subagents')).toBe(
      'pi install git:github.com/nicobailon/pi-subagents',
    );
  });

  it('queries GitHub with topic:pi-package and maps repos', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      const parsed = new URL(String(url));
      expect(parsed.hostname).toBe('api.github.com');
      expect(parsed.searchParams.get('q')).toBe('topic:pi-package subagents');
      return {
        ok: true,
        json: async () => ({
          items: [
            {
              full_name: 'nicobailon/pi-subagents',
              name: 'pi-subagents',
              html_url: 'https://github.com/nicobailon/pi-subagents',
              description: 'Pi extension for subagents',
              default_branch: 'main',
              owner: { login: 'nicobailon' },
            },
          ],
        }),
      };
    });

    const hits = await searchPiGithubRepos({
      query: 'subagents',
      fetch: fetchFn as unknown as typeof fetch,
    });
    expect(hits).toEqual([
      expect.objectContaining({
        entryId: 'github:nicobailon/pi-subagents',
        source: 'github',
        installCommand: 'pi install git:github.com/nicobailon/pi-subagents',
        repositoryUrl: 'https://github.com/nicobailon/pi-subagents',
        publisher: 'nicobailon',
      }),
    ]);
  });

  it('returns no network hits for an empty query', async () => {
    const fetchFn = vi.fn();
    await expect(
      searchPiGithubRepos({ query: '   ', fetch: fetchFn as unknown as typeof fetch }),
    ).resolves.toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
