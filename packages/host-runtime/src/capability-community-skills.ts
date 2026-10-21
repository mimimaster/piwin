/**
 * Community (skills.sh) half of the agent capability tools. Hits are not
 * reviewed by piwin: they install from the repository's default branch and
 * still pass the per-install permission prompt like curated entries.
 */
import type {
  InstallSource,
  MarketplaceCatalogEntry,
  MarketplaceSearchHit,
  ToolResult,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { parseSkillsShEntryId, skillsShInstallSource } from '@piwin/marketplace';

/** Enough to pick from without flooding the transcript. */
export const COMMUNITY_SKILL_SEARCH_LIMIT = 10;

export type CommunitySkillPorts = {
  searchCommunitySkills: (input: {
    query: string;
    limit: number;
    signal: AbortSignal;
  }) => Promise<MarketplaceSearchHit[]>;
  listInstalledSkillIds: (piwinRoot: string) => Promise<Set<string>>;
  installSkill: (input: { piwinRoot: string; source: InstallSource; name?: string }) => Promise<{
    skillId: string;
  }>;
};

export function describeCommunitySkill(
  hit: MarketplaceSearchHit,
  installedSkillIds: Set<string>,
): Record<string, unknown> {
  return {
    entryId: hit.entryId,
    kind: 'skill',
    name: hit.name,
    curated: false,
    source: 'skills.sh community index (not reviewed by piwin)',
    repository: hit.repositoryUrl,
    ...(hit.installs !== undefined ? { installs: hit.installs } : {}),
    installed: installedSkillIds.has(hit.name.toLowerCase()),
  };
}

function repoSkillKey(repositoryUrl: string, skillName: string): string {
  const repo = repositoryUrl
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  return `${repo}/${skillName}`.toLowerCase();
}

/** `owner/repo/skill` keys of curated skills, so community copies of them are dropped. */
export function curatedSkillKeys(catalog: readonly MarketplaceCatalogEntry[]): Set<string> {
  const keys = new Set<string>();
  for (const entry of catalog) {
    if (entry.install.kind === 'skill' && entry.install.source.kind === 'git') {
      keys.add(repoSkillKey(entry.install.source.url, entry.capabilityId));
    }
  }
  return keys;
}

/** Community skills found for `query`, or the reason the index was unreachable. */
export async function searchCommunitySkillEntries(
  ports: CommunitySkillPorts,
  input: { piwinRoot: string; query: string; signal: AbortSignal; excludeKeys: Set<string> },
): Promise<{ entries: Record<string, unknown>[]; error?: string }> {
  try {
    const [hits, installed] = await Promise.all([
      ports.searchCommunitySkills({
        query: input.query,
        limit: COMMUNITY_SKILL_SEARCH_LIMIT,
        signal: input.signal,
      }),
      ports.listInstalledSkillIds(input.piwinRoot),
    ]);
    return {
      entries: hits
        .filter(
          (hit) =>
            !hit.repositoryUrl || !input.excludeKeys.has(repoSkillKey(hit.repositoryUrl, hit.name)),
        )
        .map((hit) => describeCommunitySkill(hit, installed)),
    };
  } catch (error) {
    return { entries: [], error: formatError(error) };
  }
}

/** Installs a `skills.sh:<owner>/<repo>/<skill>` id; undefined when the id is not one. */
export async function installCommunitySkill(
  entryId: string,
  piwinRoot: string,
  ports: CommunitySkillPorts,
): Promise<ToolResult | undefined> {
  const parsed = parseSkillsShEntryId(entryId);
  if (!parsed) return undefined;
  const installed = await ports.listInstalledSkillIds(piwinRoot);
  if (installed.has(parsed.skillName.toLowerCase())) {
    // Installing would overwrite a same-named skill the user already has.
    return {
      ok: true,
      output: `A skill named "${parsed.skillName}" is already installed; not replacing it.`,
      details: { entryId },
    };
  }
  try {
    const result = await ports.installSkill({
      piwinRoot,
      source: skillsShInstallSource(parsed.ownerRepo),
      name: parsed.skillName,
    });
    return {
      ok: true,
      output: `Installed community skill "${result.skillId}" from ${parsed.ownerRepo}. It is usable from the next message (/${result.skillId}).`,
      details: { entryId, skillId: result.skillId },
    };
  } catch (error) {
    return {
      ok: false,
      code: 'execution-failed',
      message: `Installing "${entryId}" failed: ${formatError(error)}`,
    };
  }
}
