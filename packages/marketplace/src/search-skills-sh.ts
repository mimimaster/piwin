/**
 * Community skill search through the public skills.sh index. Results are
 * unreviewed: they carry `curated: false` and install from the repository's
 * default branch, locating the skill folder by name at install time.
 */
import type { MarketplaceSearchHit } from '@piwin/contracts';

export const SKILLS_SH_SEARCH_URL = 'https://skills.sh/api/search';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const FETCH_TIMEOUT_MS = 8_000;
/** skills.sh also indexes non-GitHub sources (e.g. vendor domains); only GitHub repos are cloneable here. */
const GITHUB_OWNER_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type SearchSkillsShOptions = {
  query: string;
  limit?: number;
  fetch?: typeof fetch;
  signal?: AbortSignal;
};

/** Stable entry id for a community skill; `capability_install` accepts it back. */
export function skillsShEntryId(ownerRepo: string, skillName: string): string {
  return `skills.sh:${ownerRepo}/${skillName}`;
}

/** Inverse of {@link skillsShEntryId}; undefined for anything else. */
export function parseSkillsShEntryId(
  entryId: string,
): { ownerRepo: string; skillName: string } | undefined {
  if (!entryId.startsWith('skills.sh:')) return undefined;
  const parts = entryId.slice('skills.sh:'.length).split('/');
  if (parts.length !== 3) return undefined;
  const [owner, repo, skillName] = parts;
  if (!owner || !repo || !skillName) return undefined;
  const ownerRepo = `${owner}/${repo}`;
  if (!GITHUB_OWNER_REPO.test(ownerRepo) || !SKILL_NAME.test(skillName)) return undefined;
  return { ownerRepo, skillName };
}

/** CLI equivalent; `--name` lets the installer find the skill folder inside a multi-skill repo. */
export function skillInstallCommand(gitUrl: string, skillName: string): string {
  return `piwin skill install --git ${gitUrl} --name ${skillName}`;
}

export function skillsShInstallSource(ownerRepo: string): { kind: 'git'; url: string } {
  return { kind: 'git', url: `https://github.com/${ownerRepo}.git` };
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hitFromSkill(value: unknown): MarketplaceSearchHit | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const ownerRepo = typeof record.source === 'string' ? record.source.trim() : '';
  const skillName = typeof record.skillId === 'string' ? record.skillId.trim() : '';
  if (!GITHUB_OWNER_REPO.test(ownerRepo) || !SKILL_NAME.test(skillName)) return undefined;
  const owner = ownerRepo.split('/')[0] ?? ownerRepo;
  const hit: MarketplaceSearchHit = {
    entryId: skillsShEntryId(ownerRepo, skillName),
    name: skillName,
    version: 'HEAD',
    description: `${ownerRepo} · skills.sh`,
    source: 'skill',
    installCommand: `piwin skill install ${skillsShEntryId(ownerRepo, skillName)}`,
    kind: 'skill',
    repositoryUrl: `https://github.com/${ownerRepo}`,
    homepage: `https://skills.sh/${ownerRepo}/${skillName}`,
    publisher: owner,
    skillSource: skillsShInstallSource(ownerRepo),
    curated: false,
  };
  if (typeof record.installs === 'number' && Number.isFinite(record.installs)) {
    hit.installs = record.installs;
  }
  return hit;
}

/** Searches skills.sh; an empty query returns nothing (the index has no browse mode). */
export async function searchSkillsSh(options: SearchSkillsShOptions): Promise<MarketplaceSearchHit[]> {
  const query = options.query.trim();
  if (!query) return [];
  const url = new URL(SKILLS_SH_SEARCH_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(clampLimit(options.limit)));
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await (options.fetch ?? fetch)(url.toString(), {
    headers: { Accept: 'application/json', 'User-Agent': 'piwin-marketplace' },
    signal,
  });
  if (!response.ok) {
    throw new Error(`skills.sh search failed: HTTP ${response.status}`);
  }
  const payload = asRecord(await response.json());
  const skills = payload && Array.isArray(payload.skills) ? payload.skills : [];
  const seen = new Set<string>();
  const hits: MarketplaceSearchHit[] = [];
  for (const item of skills) {
    const hit = hitFromSkill(item);
    if (!hit || seen.has(hit.entryId)) continue;
    seen.add(hit.entryId);
    hits.push(hit);
  }
  return hits;
}
