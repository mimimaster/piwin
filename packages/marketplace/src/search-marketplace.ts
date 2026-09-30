import type {
  MarketplaceSearchHit,
  MarketplaceSearchResult,
  McpRegistryCard,
  SkillStoreEntry,
} from '@piwin/contracts';
import { listMcpRegistryCards } from './mcp-registry.js';
import { listSkillStoreEntries } from './skill-store.js';
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
  return normalized
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
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

function mcpCardToHit(card: McpRegistryCard): MarketplaceSearchHit {
  const isOfficial = card.id.startsWith('official:');
  const serverName = isOfficial ? card.id.slice('official:'.length) : card.id;
  const command = card.installDraft?.command
    ? `${card.installDraft.command} ${(card.installDraft.args ?? []).join(' ')}`
    : card.manualDraft?.command
      ? `${card.manualDraft.command} ${(card.manualDraft.args ?? []).join(' ')}`
      : `npx -y ${serverName}`;
  const hit: MarketplaceSearchHit = {
    entryId: `mcp:${serverName}`,
    name: card.title || serverName,
    version: 'latest',
    description: card.description,
    source: 'mcp-registry',
    installCommand: command,
    kind: 'mcp',
  };
  if (card.homepage) {
    hit.homepage = card.homepage;
  }
  return hit;
}

function skillToHit(entry: SkillStoreEntry): MarketplaceSearchHit {
  const hit: MarketplaceSearchHit = {
    entryId: `skill:${entry.id}`,
    name: entry.name,
    version: 'git',
    description: entry.description,
    source: 'skill',
    installCommand: `piwin skill install ${entry.name}`,
    kind: 'skill',
  };
  if (entry.source.kind === 'git') {
    hit.repositoryUrl = entry.source.url;
  }
  return hit;
}

/**
 * Packages that duplicate or conflict with piwin's built-in native capabilities.
 * piwin has native MCP server lifecycle and native subagent delegation, so
 * packages like pi-mcp-adapter and pi-subagents should never be recommended.
 */
export const EXCLUDED_COMMUNITY_RECOMMENDATIONS = new Set<string>([
  'pi-mcp-adapter',
  'pi-subagents',
]);

/**
 * One marketplace query: npm `pi-package` + GitHub `topic:pi-package` +
 * official/static MCP registry servers + GitHub skills.
 */
export async function searchMarketplaceSources(
  options: SearchMarketplaceOptions,
): Promise<MarketplaceSearchResult> {
  const query = options.query.trim();
  const shared = {
    query,
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  };
  const [npmOutcome, githubOutcome, mcpOutcome, skillOutcome] = await Promise.allSettled([
    searchPiNpmPackages(shared),
    searchPiGithubRepos({
      ...shared,
      ...(options.githubToken ? { token: options.githubToken } : {}),
    }),
    query !== '' ? listMcpRegistryCards({ query, includeOfficial: true, ...(options.fetch ? { fetch: options.fetch } : {}), ...(options.signal ? { signal: options.signal } : {}) }) : Promise.resolve([]),
    query !== '' ? Promise.resolve(listSkillStoreEntries(query)) : Promise.resolve([]),
  ]);

  const npmHits = npmOutcome.status === 'fulfilled' ? npmOutcome.value : [];
  const githubHits = githubOutcome.status === 'fulfilled' ? githubOutcome.value : [];
  const mcpHits =
    mcpOutcome.status === 'fulfilled'
      ? mcpOutcome.value
          .filter((card) => !EXCLUDED_COMMUNITY_RECOMMENDATIONS.has(card.id))
          .map(mcpCardToHit)
      : [];
  const skillHits =
    skillOutcome.status === 'fulfilled'
      ? skillOutcome.value
          .filter((entry) => !EXCLUDED_COMMUNITY_RECOMMENDATIONS.has(entry.id))
          .map(skillToHit)
      : [];

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

  const filteredNpm =
    query === ''
      ? npmHits.filter((hit) => !EXCLUDED_COMMUNITY_RECOMMENDATIONS.has(hit.name))
      : npmHits;
  const filteredGithub =
    query === ''
      ? githubHits.filter((hit) => !EXCLUDED_COMMUNITY_RECOMMENDATIONS.has(hit.name))
      : githubHits;

  const browsedHits =
    query === '' && options.limit !== undefined
      ? mergeHits(
          filteredGithub.length > 0
            ? filteredNpm.slice(0, Math.max(1, options.limit - 1))
            : filteredNpm,
          filteredGithub,
        ).slice(0, options.limit)
      : [...mergeHits(filteredNpm, filteredGithub), ...mcpHits, ...skillHits];
  const result: MarketplaceSearchResult = {
    query,
    hits: browsedHits,
  };
  if (errors.length > 0) {
    result.remoteError = errors.join('; ');
  }
  return result;
}

