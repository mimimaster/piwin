/**
 * Curated marketplace catalog: composition, validation, search and lookup.
 * Content lives in the per-kind files; this module only enforces the
 * invariants that make an entry trustworthy (stable id, pinned source,
 * install descriptor matching the kind).
 */
import type {
  MarketplaceCapabilityKind,
  MarketplaceCatalogEntry,
  MarketplaceCategory,
} from '@piwin/contracts';
import { normalizeResourceId } from '@piwin/contracts';
import { isExactNpmVersion, isNpmPackageName } from '../search-pi-packages.js';
import { EXTENSION_CATALOG } from './extensions.js';
import { MCP_CATALOG } from './mcp.js';
import { SKILL_CATALOG } from './skills.js';

const GIT_COMMIT = /^[0-9a-f]{40}$/;
/** `pkg@1.2.3` (npx) or `pkg==1.2.3` (uvx). */
const PINNED_RUNNER_PACKAGE = /(@\d+\.\d+\.\d+|==\d+(?:\.\d+)*)$/;

export type ListCatalogEntriesOptions = {
  query?: string;
  kinds?: readonly MarketplaceCapabilityKind[];
  category?: MarketplaceCategory;
  includeWithdrawn?: boolean;
};

/** Returns human-readable violations; empty means the entry is publishable. */
export function validateCatalogEntry(entry: MarketplaceCatalogEntry): string[] {
  const issues: string[] = [];
  const prefix = `${entry.kind}:`;
  if (!entry.entryId.startsWith(prefix) || entry.entryId.length === prefix.length) {
    issues.push(`${entry.entryId}: entryId must be "${prefix}<stable-id>"`);
  }
  if (!entry.version.trim()) {
    issues.push(`${entry.entryId}: version is required`);
  }
  if (entry.examples.length === 0) {
    issues.push(`${entry.entryId}: at least one example request is required`);
  }
  if (entry.verification.length === 0) {
    issues.push(`${entry.entryId}: verification evidence is required`);
  }
  const install = entry.install;
  switch (install.kind) {
    case 'pi-package':
    case 'managed-extension':
      if (entry.kind !== 'extension') issues.push(`${entry.entryId}: ${install.kind} installs an extension`);
      break;
    case 'skill':
    case 'mcp':
      if (entry.kind !== install.kind) issues.push(`${entry.entryId}: install kind ${install.kind} ≠ ${entry.kind}`);
      break;
  }
  if (install.kind === 'pi-package') {
    if (install.source.kind === 'npm') {
      if (!isNpmPackageName(install.source.packageName)) {
        issues.push(`${entry.entryId}: invalid npm package name`);
      }
      if (!install.source.version || !isExactNpmVersion(install.source.version)) {
        issues.push(`${entry.entryId}: npm package must pin an exact version`);
      } else if (install.source.version !== entry.version) {
        issues.push(`${entry.entryId}: pinned version differs from entry version`);
      }
      if (normalizeResourceId(install.source.packageName) !== entry.capabilityId) {
        issues.push(`${entry.entryId}: capabilityId must be the normalized package name`);
      }
    } else {
      issues.push(`${entry.entryId}: curated Pi packages must come from npm with a pinned version`);
    }
  }
  if (install.kind === 'skill' || install.kind === 'managed-extension') {
    if (install.source.kind !== 'git' || !install.source.ref || !GIT_COMMIT.test(install.source.ref)) {
      issues.push(`${entry.entryId}: git source must pin a full commit`);
    }
  }
  if (install.kind === 'mcp') {
    if (install.serverId !== entry.capabilityId) {
      issues.push(`${entry.entryId}: MCP serverId must equal capabilityId`);
    }
    const packageArg = (install.draft.args ?? []).find((arg) => !arg.startsWith('-'));
    if (!packageArg || !PINNED_RUNNER_PACKAGE.test(packageArg)) {
      issues.push(`${entry.entryId}: MCP command must pin its package version`);
    }
  }
  return issues;
}

function composeCatalog(): readonly MarketplaceCatalogEntry[] {
  const entries = [...EXTENSION_CATALOG, ...SKILL_CATALOG, ...MCP_CATALOG];
  const issues = entries.flatMap(validateCatalogEntry);
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.entryId)) issues.push(`${entry.entryId}: duplicate entryId`);
    seen.add(entry.entryId);
  }
  if (issues.length > 0) {
    // Shipping a malformed catalog would put unpinned code one click away;
    // fail loudly at module load so tests and Host startup catch it.
    throw new Error(`Invalid marketplace catalog:\n${issues.join('\n')}`);
  }
  return Object.freeze(entries);
}

export const MARKETPLACE_CATALOG: readonly MarketplaceCatalogEntry[] = composeCatalog();

function entryMatchesQuery(entry: MarketplaceCatalogEntry, needle: string): boolean {
  const haystack = [
    entry.entryId,
    entry.capabilityId,
    entry.category,
    entry.author,
    entry.name.en,
    entry.name.zhCN,
    entry.summary.en,
    entry.summary.zhCN,
  ]
    .join('\n')
    .toLowerCase();
  return haystack.includes(needle);
}

/** Featured first, then by name; withdrawn entries only on explicit request. */
export function listCatalogEntries(
  options: ListCatalogEntriesOptions = {},
  catalog: readonly MarketplaceCatalogEntry[] = MARKETPLACE_CATALOG,
): MarketplaceCatalogEntry[] {
  const needle = options.query?.trim().toLowerCase() ?? '';
  const kinds = options.kinds && options.kinds.length > 0 ? new Set(options.kinds) : null;
  return catalog
    .filter((entry) => options.includeWithdrawn === true || entry.withdrawn === undefined)
    .filter((entry) => kinds === null || kinds.has(entry.kind))
    .filter((entry) => options.category === undefined || entry.category === options.category)
    .filter((entry) => needle === '' || entryMatchesQuery(entry, needle))
    .sort((left, right) => {
      if (left.featured !== right.featured) return left.featured ? -1 : 1;
      return left.name.en.localeCompare(right.name.en);
    });
}

export function findCatalogEntry(
  entryId: string,
  catalog: readonly MarketplaceCatalogEntry[] = MARKETPLACE_CATALOG,
): MarketplaceCatalogEntry | undefined {
  return catalog.find((entry) => entry.entryId === entryId);
}

/**
 * Link an installed resource back to its catalog entry. A multi-extension Pi
 * package reports `<namespace>-<entry>` ids, so extension matches accept the
 * package namespace as a prefix.
 */
export function matchCatalogEntry(
  kind: MarketplaceCapabilityKind,
  capabilityId: string,
  catalog: readonly MarketplaceCatalogEntry[] = MARKETPLACE_CATALOG,
): MarketplaceCatalogEntry | undefined {
  return catalog.find((entry) => {
    if (entry.kind !== kind) return false;
    if (entry.capabilityId === capabilityId) return true;
    return entry.install.kind === 'pi-package' && capabilityId.startsWith(`${entry.capabilityId}-`);
  });
}
