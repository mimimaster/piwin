/** Live marketplace search: npm `pi-package` plus GitHub `topic:pi-package`. */

export type MarketplaceSearchSource = 'npm-pi-package' | 'github';

/** Installable Pi package sources returned by the live ecosystem search. */
export type MarketplacePiPackageSource =
  | { kind: 'npm'; packageName: string }
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
