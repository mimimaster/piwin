/** Live marketplace search: npm `pi-package` plus GitHub `topic:pi-package`. */

export type MarketplaceSearchSource =
  | 'npm-pi-package'
  | 'github'
  | 'mcp-registry'
  | 'skill';

/** Installable Pi package sources returned by the live ecosystem search. */
export type MarketplacePiPackageSource =
  /** `version` pins an exact npm version (`npm:<name>@<version>`). */
  | { kind: 'npm'; packageName: string; version?: string }
  | { kind: 'git'; repositoryUrl: string }
  /** Absolute directory on the Host filesystem; local Host connections only. */
  | { kind: 'local'; path: string };

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
  stars?: number;
  kind?: 'extension' | 'skill' | 'mcp';
  /** ISO timestamp of the latest publish / push, when the source reports it. */
  updatedAt?: string;
};

export type MarketplaceSearchResult = {
  query: string;
  hits: MarketplaceSearchHit[];
  /** Present when the live npm query failed. Hits may still be empty. */
  remoteError?: string;
};

/** Read-only details for one live-search hit, fetched on demand. */
export type MarketplacePackageDetailData = {
  entryId: string;
  /** Raw README markdown; untrusted — clients render without raw HTML or remote media. */
  readme?: string;
  license?: string;
  updatedAt?: string;
  /** Present when a source could not be read; other fields may still be set. */
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

const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const NPM_WITH_VERSION = /^((?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
const GITHUB_SHORT = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;

export type ParsedPiPackageSource =
  | { ok: true; source: MarketplacePiPackageSource; label: string }
  | { ok: false; reason: 'empty' | 'unrecognized' };

/**
 * Turns what a user pastes (`npm:pkg`, `pkg@1.2.3`, a GitHub URL, an absolute
 * Host path) into a Host install source. The Host validates again.
 */
export function parsePiPackageSourceInput(raw: string): ParsedPiPackageSource {
  const input = raw.trim().replace(/^pi install\s+/, '');
  if (!input) return { ok: false, reason: 'empty' };
  if (input.startsWith('/') || /^[A-Za-z]:[\\/]/.test(input)) {
    return { ok: true, source: { kind: 'local', path: input }, label: input };
  }
  const github = GITHUB_SHORT.exec(input.replace(/^git:/, ''));
  if (github?.[1] && github[2]) {
    const repositoryUrl = `https://github.com/${github[1]}/${github[2]}`;
    return { ok: true, source: { kind: 'git', repositoryUrl }, label: `${github[1]}/${github[2]}` };
  }
  const npm = input.replace(/^npm:/, '');
  const pinned = NPM_WITH_VERSION.exec(npm);
  if (pinned?.[1] && pinned[2]) {
    return { ok: true, source: { kind: 'npm', packageName: pinned[1], version: pinned[2] }, label: npm };
  }
  if (NPM_NAME.test(npm)) {
    return { ok: true, source: { kind: 'npm', packageName: npm }, label: npm };
  }
  return { ok: false, reason: 'unrecognized' };
}
