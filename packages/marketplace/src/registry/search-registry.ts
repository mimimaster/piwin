/**
 * Match a query against the extension registry index and project hits into
 * the shared marketplace search shape.
 */
import type {
  ExtensionRegistryEntry,
  ExtensionRegistryIndex,
  ExtensionRegistryVersion,
  MarketplaceSearchHit,
} from '@piwin/contracts';

const DEFAULT_LIMIT = 20;

/** Newest version that is not yanked; `versions` is newest-first. */
export function latestInstallableVersion(
  entry: ExtensionRegistryEntry,
): ExtensionRegistryVersion | undefined {
  return entry.versions.find((version) => version.yanked === undefined);
}

/** CLI form that installs the exact version a hit shows. */
export function registryInstallCommand(id: string, version: string): string {
  return `piwin extension install --registry ${id}@${version}`;
}

export function searchRegistryIndex(
  index: ExtensionRegistryIndex,
  query: string,
  limit = DEFAULT_LIMIT,
): MarketplaceSearchHit[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const scored: Array<{ hit: MarketplaceSearchHit; score: number }> = [];
  for (const entry of index.extensions) {
    const version = latestInstallableVersion(entry);
    if (!version) continue;
    const score = scoreEntry(entry, tokens);
    if (score > 0) scored.push({ hit: toSearchHit(entry, version), score });
  }
  scored.sort((left, right) => right.score - left.score || left.hit.name.localeCompare(right.hit.name));
  return scored.slice(0, limit).map((item) => item.hit);
}

/** Every token must match some field; name/id matches outrank description. */
function scoreEntry(entry: ExtensionRegistryEntry, tokens: readonly string[]): number {
  const id = entry.id;
  const name = entry.name.toLowerCase();
  const keywords = entry.keywords ?? [];
  const description = entry.description.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    let tokenScore = 0;
    if (name === token || id.endsWith(`/${token}`)) tokenScore = 8;
    else if (name.includes(token) || id.includes(token)) tokenScore = 4;
    else if (keywords.some((keyword) => keyword.includes(token))) tokenScore = 2;
    else if (description.includes(token)) tokenScore = 1;
    if (tokenScore === 0) return 0;
    score += tokenScore;
  }
  return score;
}

function toSearchHit(
  entry: ExtensionRegistryEntry,
  version: ExtensionRegistryVersion,
): MarketplaceSearchHit {
  const hit: MarketplaceSearchHit = {
    entryId: `registry:${entry.id}`,
    name: entry.name,
    version: version.version,
    description: entry.description,
    source: 'piwin-registry',
    installCommand: registryInstallCommand(entry.id, version.version),
    repositoryUrl: entry.repository,
    registry: {
      id: entry.id,
      owners: entry.owners,
      commit: version.commit,
      license: entry.license,
      ...(entry.forkOf ? { forkOf: entry.forkOf } : {}),
    },
  };
  const publisher = entry.owners[0];
  if (publisher) hit.publisher = publisher;
  if (entry.homepage) hit.homepage = entry.homepage;
  return hit;
}
