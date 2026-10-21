import type {
  MarketplaceSearchSourceGroup,
  MarketplaceSearchHit,
  MarketplaceSearchResult,
  McpRegistryCard,
  SkillStoreEntry,
} from '@piwin/contracts';
import { listStaticMcpRegistry } from './mcp-registry.js';
import { officialMcpServerId, searchOfficialMcpRegistry } from './mcp-official-registry.js';
import { listSkillStoreEntries } from './skill-store.js';
import { searchPiGithubRepos } from './search-pi-github.js';
import { normalizeRepositoryUrl, searchPiNpmPackages } from './search-pi-packages.js';
import { searchSkillsSh, skillInstallCommand } from './search-skills-sh.js';

export type SearchMarketplaceOptions = {
  query: string;
  /** Omitted = every group. */
  sources?: readonly MarketplaceSearchSourceGroup[];
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
  const registryName = isOfficial ? card.id.slice('official:'.length) : card.id;
  const serverId = isOfficial ? officialMcpServerId(registryName) : card.id;
  const draft = card.installDraft;
  const hit: MarketplaceSearchHit = {
    entryId: `mcp:${registryName}`,
    name: card.title || registryName,
    version: card.version ?? 'latest',
    description: card.description,
    source: 'mcp-registry',
    // Remote-only servers have no local command; the empty string marks "not installable".
    installCommand: draft ? `${draft.command} ${(draft.args ?? []).join(' ')}`.trim() : '',
    kind: 'mcp',
    mcpServerId: serverId,
    curated: card.source === 'static',
  };
  if (draft) hit.mcpDraft = draft;
  if (card.requiredEnv && card.requiredEnv.length > 0) hit.requiredEnv = card.requiredEnv;
  if (card.homepage) hit.homepage = card.homepage;
  if (card.repositoryUrl) hit.repositoryUrl = card.repositoryUrl;
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
    curated: true,
  };
  if (entry.source.kind === 'git') {
    hit.repositoryUrl = entry.source.url;
    hit.skillSource = entry.source;
    hit.installCommand = skillInstallCommand(entry.source.url, entry.id);
  }
  return hit;
}

/** `owner/repo` + skill name, used to drop community copies of a curated skill. */
function skillKey(hit: MarketplaceSearchHit): string | undefined {
  const repo = repoKey(hit.repositoryUrl)?.replace(/^https?:\/\/(www\.)?github\.com\//, '');
  return repo ? `${repo}/${hit.name.toLowerCase()}` : undefined;
}

/** Curated skills first; community hits follow, minus the ones already curated. */
function mergeSkillHits(
  curated: MarketplaceSearchHit[],
  community: MarketplaceSearchHit[],
): MarketplaceSearchHit[] {
  const seen = new Set(curated.map(skillKey).filter((key): key is string => key !== undefined));
  return [
    ...curated,
    ...community.filter((hit) => {
      const key = skillKey(hit);
      return key === undefined || !seen.has(key);
    }),
  ];
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

/** Curated MCP cards plus official registry matches; a registry failure is reported, not thrown. */
async function searchMcpCards(
  query: string,
  options: Pick<SearchMarketplaceOptions, 'fetch' | 'signal'>,
): Promise<{ cards: McpRegistryCard[]; error?: string }> {
  const staticCards = listStaticMcpRegistry(query);
  try {
    const remote = await searchOfficialMcpRegistry({
      query,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const seen = new Set(staticCards.map((card) => card.id));
    return { cards: [...staticCards, ...remote.filter((card) => !seen.has(card.id))] };
  } catch (error) {
    return { cards: staticCards, error: error instanceof Error ? error.message : String(error) };
  }
}

const SKIPPED: Promise<never[]> = Promise.resolve([]);

/**
 * One marketplace query: npm `pi-package` + GitHub `topic:pi-package` +
 * official/static MCP registry servers + curated skills + skills.sh community skills.
 * `sources` limits it to some groups so a client can run the slow MCP
 * registry search apart from the rest.
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
  const wants = (group: MarketplaceSearchSourceGroup) =>
    options.sources === undefined || options.sources.includes(group);
  const [npmOutcome, githubOutcome, mcpOutcome, skillOutcome, communitySkillOutcome] =
    await Promise.allSettled([
      wants('packages') ? searchPiNpmPackages(shared) : SKIPPED,
      wants('packages')
        ? searchPiGithubRepos({
            ...shared,
            ...(options.githubToken ? { token: options.githubToken } : {}),
          })
        : SKIPPED,
      query !== '' && wants('mcp')
        ? searchMcpCards(query, options)
        : Promise.resolve<{ cards: McpRegistryCard[]; error?: string }>({ cards: [] }),
      query !== '' && wants('skills') ? Promise.resolve(listSkillStoreEntries(query)) : SKIPPED,
      wants('skills') ? searchSkillsSh(shared) : SKIPPED,
    ]);

  const npmHits = npmOutcome.status === 'fulfilled' ? npmOutcome.value : [];
  const githubHits = githubOutcome.status === 'fulfilled' ? githubOutcome.value : [];
  const mcpHits =
    mcpOutcome.status === 'fulfilled'
      ? mcpOutcome.value.cards
          .filter((card) => !EXCLUDED_COMMUNITY_RECOMMENDATIONS.has(card.id))
          .map(mcpCardToHit)
      : [];
  const skillHits =
    skillOutcome.status === 'fulfilled'
      ? skillOutcome.value
          .filter((entry) => !EXCLUDED_COMMUNITY_RECOMMENDATIONS.has(entry.id))
          .map(skillToHit)
      : [];
  const communitySkillHits =
    communitySkillOutcome.status === 'fulfilled' ? communitySkillOutcome.value : [];

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
  if (mcpOutcome.status === 'fulfilled' && mcpOutcome.value.error) {
    errors.push(`MCP registry: ${mcpOutcome.value.error}`);
  }
  if (communitySkillOutcome.status === 'rejected') {
    errors.push(
      `skills.sh: ${communitySkillOutcome.reason instanceof Error ? communitySkillOutcome.reason.message : String(communitySkillOutcome.reason)}`,
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
      : [
          ...mergeHits(filteredNpm, filteredGithub),
          ...mcpHits,
          ...mergeSkillHits(skillHits, communitySkillHits),
        ];
  const result: MarketplaceSearchResult = {
    query,
    hits: browsedHits,
  };
  if (errors.length > 0) {
    result.remoteError = errors.join('; ');
  }
  return result;
}

