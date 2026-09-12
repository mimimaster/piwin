import type { MarketplaceSearchHit, MarketplaceSearchResult } from '@piwin/contracts';
import { searchPiGithubRepos } from './search-pi-github.js';
import { normalizeRepositoryUrl, searchPiNpmPackages } from './search-pi-packages.js';

export type SearchMarketplaceOptions = {
  query: string;
  limit?: number;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  githubToken?: string;
};

function repoKey(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const normalized = normalizeRepositoryUrl(url) ?? url;
  return normalized.replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase();
}

function mergeHits(
  npmHits: MarketplaceSearchHit[],
  githubHits: MarketplaceSearchHit[],
): MarketplaceSearchHit[] {
  const seenRepos = new Set<string>();
  const merged: MarketplaceSearchHit[] = [];
  for (const hit of npmHits) {
    merged.push(hit);
    const key = repoKey(hit.repositoryUrl);
    if (key) seenRepos.add(key);
  }
  for (const hit of githubHits) {
    const key = repoKey(hit.repositoryUrl);
    if (key && seenRepos.has(key)) continue;
    if (key) seenRepos.add(key);
    merged.push(hit);
  }
  return merged;
}

/**
 * One marketplace query: npm `pi-package` first, then GitHub `topic:pi-package`
 * repos that are not already linked from an npm hit.
 */
export async function searchMarketplaceSources(
  options: SearchMarketplaceOptions,
): Promise<MarketplaceSearchResult> {
  const query = options.query.trim();
  if (!query) {
    return { query: '', hits: [] };
  }
  const shared = {
    query,
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };
  const [npmOutcome, githubOutcome] = await Promise.allSettled([
    searchPiNpmPackages(shared),
    searchPiGithubRepos({
      ...shared,
      ...(options.githubToken ? { token: options.githubToken } : {}),
    }),
  ]);

  const npmHits = npmOutcome.status === 'fulfilled' ? npmOutcome.value : [];
  const githubHits = githubOutcome.status === 'fulfilled' ? githubOutcome.value : [];
  const errors: string[] = [];
  if (npmOutcome.status === 'rejected') {
    errors.push(
      `npm: ${npmOutcome.reason instanceof Error ? npmOutcome.reason.message : String(npmOutcome.reason)}`,
    );
  }
  if (githubOutcome.status === 'rejected') {
    errors.push(
      `GitHub: ${githubOutcome.reason instanceof Error ? githubOutcome.reason.message : String(githubOutcome.reason)}`,
    );
  }

  const result: MarketplaceSearchResult = {
    query,
    hits: mergeHits(npmHits, githubHits),
  };
  if (errors.length > 0) {
    result.remoteError = errors.join('; ');
  }
  return result;
}
