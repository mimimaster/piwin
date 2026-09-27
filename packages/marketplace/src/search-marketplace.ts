import type {
  ExtensionRegistryIndex,
  MarketplaceSearchHit,
  MarketplaceSearchResult,
} from '@piwin/contracts';
import { searchRegistryIndex } from './registry/search-registry.js';
import { searchPiGithubRepos } from './search-pi-github.js';
import { normalizeRepositoryUrl, searchPiNpmPackages } from './search-pi-packages.js';

export type SearchMarketplaceOptions = {
  query: string;
  limit?: number;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  githubToken?: string;
  /** Extension registry (ADR 0077). Omitted: the registry is not searched. */
  loadRegistryIndex?: (signal?: AbortSignal) => Promise<ExtensionRegistryIndex>;
};

function repoKey(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const normalized = normalizeRepositoryUrl(url) ?? url;
  return normalized.replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase();
}

/**
 * Registry hits first, then npm, then GitHub. A later source never repeats a
 * repository an earlier one already listed.
 */
function mergeHits(...sources: MarketplaceSearchHit[][]): MarketplaceSearchHit[] {
  const seenRepos = new Set<string>();
  const merged: MarketplaceSearchHit[] = [];
  for (const hits of sources) {
    const sourceRepos: string[] = [];
    for (const hit of hits) {
      const key = repoKey(hit.repositoryUrl);
      if (key && seenRepos.has(key)) continue;
      if (key) sourceRepos.push(key);
      merged.push(hit);
    }
    for (const key of sourceRepos) seenRepos.add(key);
  }
  return merged;
}

/**
 * One marketplace query: extension registry first, then npm `pi-package`, then
 * GitHub `topic:pi-package` repos not already listed by an earlier source.
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
  const loadRegistryIndex = options.loadRegistryIndex;
  const [registryOutcome, npmOutcome, githubOutcome] = await Promise.allSettled([
    loadRegistryIndex
      ? loadRegistryIndex(options.signal).then((index) =>
          searchRegistryIndex(index, query, options.limit),
        )
      : Promise.resolve([]),
    searchPiNpmPackages(shared),
    searchPiGithubRepos({
      ...shared,
      ...(options.githubToken ? { token: options.githubToken } : {}),
    }),
  ]);

  const registryHits = registryOutcome.status === 'fulfilled' ? registryOutcome.value : [];
  const npmHits = npmOutcome.status === 'fulfilled' ? npmOutcome.value : [];
  const githubHits = githubOutcome.status === 'fulfilled' ? githubOutcome.value : [];
  const errors: string[] = [];
  if (registryOutcome.status === 'rejected') {
    errors.push(`registry: ${formatReason(registryOutcome.reason)}`);
  }
  if (npmOutcome.status === 'rejected') {
    errors.push(`npm: ${formatReason(npmOutcome.reason)}`);
  }
  if (githubOutcome.status === 'rejected') {
    errors.push(`GitHub: ${formatReason(githubOutcome.reason)}`);
  }

  const result: MarketplaceSearchResult = {
    query,
    hits: mergeHits(registryHits, npmHits, githubHits),
  };
  if (errors.length > 0) {
    result.remoteError = errors.join('; ');
  }
  return result;
}

function formatReason(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
