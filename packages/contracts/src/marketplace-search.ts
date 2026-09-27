/**
 * Live marketplace search: the piwin extension registry (ADR 0077), npm
 * `pi-package`, and GitHub `topic:pi-package`.
 */

export type MarketplaceSearchSource = 'piwin-registry' | 'npm-pi-package' | 'github';

/** Registry facts a client needs to label and install a `piwin-registry` hit. */
export type MarketplaceRegistryHitInfo = {
  /** `<owner>/<name>`; install with `extensions/install` `{ kind: 'registry', id, version }`. */
  id: string;
  owners: string[];
  commit: string;
  license: string;
  forkOf?: { id: string; version: string };
};

/** Installable Pi package sources returned by the live ecosystem search. */
export type MarketplacePiPackageSource =
  /** `version` pins an exact npm version (`npm:<name>@<version>`). */
  | { kind: 'npm'; packageName: string; version?: string }
  | { kind: 'git'; repositoryUrl: string };

export type MarketplaceSearchHit = {
  entryId: string;
  name: string;
  version: string;
  description: string;
  source: MarketplaceSearchSource;
  installCommand: string;
  npmUrl?: string;
  repositoryUrl?: string;
  homepage?: string;
  publisher?: string;
  monthlyDownloads?: number;
  /** Present exactly when `source === 'piwin-registry'`. */
  registry?: MarketplaceRegistryHitInfo;
};

export type MarketplaceSearchResult = {
  query: string;
  hits: MarketplaceSearchHit[];
  /** Present when the live npm query failed. Hits may still be empty. */
  remoteError?: string;
};

export type MarketplacePiPackageInstallData = {
  source: string;
};

export function isMarketplaceSearchResult(value: unknown): value is MarketplaceSearchResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.query === 'string' && Array.isArray(record.hits);
}
