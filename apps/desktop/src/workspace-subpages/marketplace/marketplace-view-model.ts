/**
 * Pure marketplace view logic: filtering, ordering, Installed grouping, update
 * detection. Host data in, view data out. Address parsing lives in contracts
 * (`parsePiPackageSourceInput`) because the CLI shares it.
 */
import type {
  MarketplaceCapabilityKind,
  MarketplaceCatalogEntry,
  MarketplaceCategory,
  MarketplaceInstalledItem,
} from '@piwin/contracts';
import { MARKETPLACE_CATEGORIES } from '@piwin/contracts';
import type { MarketCategoryFilter, MarketKindFilter } from './marketplace-types.js';

const PIWIN_REGISTRY_LABEL = 'piwin-extensions';

type KindCounts = Partial<Record<Exclude<MarketKindFilter, 'all'>, number>>;

function matchesQuery(values: readonly (string | undefined)[], query: string): boolean {
  if (!query) return true;
  return values.some((value) => value?.toLowerCase().includes(query));
}

function entryInKind(entry: MarketplaceCatalogEntry, kind: MarketKindFilter): boolean {
  if (kind === 'all') return true;
  if (kind === 'piwin-extension') return entry.sourceLabel === PIWIN_REGISTRY_LABEL;
  return entry.kind === kind;
}

export function filterCatalogEntries(
  entries: readonly MarketplaceCatalogEntry[],
  filter: { kind: MarketKindFilter; category: MarketCategoryFilter; query: string },
): MarketplaceCatalogEntry[] {
  const query = filter.query.trim().toLowerCase();
  const kindOrder: Record<MarketplaceCapabilityKind, number> = { extension: 0, skill: 1, mcp: 2, agent: 3 };
  return entries
    .filter(
      (entry) =>
        !entry.withdrawn &&
        entryInKind(entry, filter.kind) &&
        (filter.category === 'all' || entry.category === filter.category) &&
        matchesQuery(
          [entry.name.en, entry.name.zhCN, entry.summary.en, entry.summary.zhCN, entry.capabilityId, entry.author],
          query,
        ),
    )
    .sort(
      (left, right) =>
        kindOrder[left.kind] - kindOrder[right.kind] ||
        MARKETPLACE_CATEGORIES.indexOf(left.category) - MARKETPLACE_CATEGORIES.indexOf(right.category) ||
        left.name.en.localeCompare(right.name.en),
    );
}

export function countCatalogKinds(entries: readonly MarketplaceCatalogEntry[]): KindCounts {
  const counts: KindCounts = {};
  for (const entry of entries) {
    if (entry.withdrawn) continue;
    counts[entry.kind] = (counts[entry.kind] ?? 0) + 1;
    if (entry.sourceLabel === PIWIN_REGISTRY_LABEL) counts['piwin-extension'] = (counts['piwin-extension'] ?? 0) + 1;
  }
  return counts;
}

/** Categories that have at least one live entry in the selected kind. */
export function presentCategories(
  entries: readonly MarketplaceCatalogEntry[],
  kind: MarketKindFilter,
): MarketplaceCategory[] {
  const present = new Set(entries.filter((entry) => !entry.withdrawn && entryInKind(entry, kind)).map((entry) => entry.category));
  return MARKETPLACE_CATEGORIES.filter((category) => present.has(category));
}

/** Catalog lookup by entry id and capability id (inventory carries either). */
export function indexCatalogEntries(
  entries: readonly MarketplaceCatalogEntry[],
): ReadonlyMap<string, MarketplaceCatalogEntry> {
  const map = new Map<string, MarketplaceCatalogEntry>();
  for (const entry of entries) {
    map.set(entry.entryId, entry);
    if (!map.has(entry.capabilityId)) map.set(entry.capabilityId, entry);
  }
  return map;
}

export function catalogEntryFor(
  item: MarketplaceInstalledItem,
  lookup: ReadonlyMap<string, MarketplaceCatalogEntry>,
): MarketplaceCatalogEntry | undefined {
  return (item.catalogEntryId ? lookup.get(item.catalogEntryId) : undefined) ?? lookup.get(item.capabilityId);
}

export function filterInstalledItems(
  items: readonly MarketplaceInstalledItem[],
  lookup: ReadonlyMap<string, MarketplaceCatalogEntry>,
  filter: { kind: MarketKindFilter; query: string },
): MarketplaceInstalledItem[] {
  const query = filter.query.trim().toLowerCase();
  return items.filter((item) => {
    const entry = catalogEntryFor(item, lookup);
    const inKind =
      filter.kind === 'all' ||
      (filter.kind === 'piwin-extension' ? entry?.sourceLabel === PIWIN_REGISTRY_LABEL : item.kind === filter.kind);
    return (
      inKind &&
      matchesQuery([item.name, item.capabilityId, item.description, entry?.name.en, entry?.name.zhCN], query)
    );
  });
}

export function countInstalledKinds(
  items: readonly MarketplaceInstalledItem[],
  lookup: ReadonlyMap<string, MarketplaceCatalogEntry>,
): KindCounts {
  const counts: KindCounts = {};
  for (const item of items) {
    counts[item.kind] = (counts[item.kind] ?? 0) + 1;
    if (catalogEntryFor(item, lookup)?.sourceLabel === PIWIN_REGISTRY_LABEL) {
      counts['piwin-extension'] = (counts['piwin-extension'] ?? 0) + 1;
    }
  }
  return counts;
}

/** States that need the user's attention before the capability works. */
const ATTENTION = new Set<MarketplaceInstalledItem['availability']>([
  'failed',
  'configuration-required',
  'pending-apply',
]);

export type InstalledGroups = {
  attention: MarketplaceInstalledItem[];
  byKind: { kind: MarketplaceCapabilityKind; items: MarketplaceInstalledItem[] }[];
};

export function groupInstalledItems(items: readonly MarketplaceInstalledItem[]): InstalledGroups {
  const attention = items.filter((item) => ATTENTION.has(item.availability));
  const rest = items.filter((item) => !ATTENTION.has(item.availability));
  const kinds: MarketplaceCapabilityKind[] = ['extension', 'skill', 'mcp', 'agent'];
  return {
    attention,
    byKind: kinds
      .map((kind) => ({
        kind,
        items: rest.filter((item) => item.kind === kind).sort((left, right) => left.name.localeCompare(right.name)),
      }))
      .filter((group) => group.items.length > 0),
  };
}

export type PendingUpdate = { entry: MarketplaceCatalogEntry; item: MarketplaceInstalledItem };

/** Installed items whose curated entry pins a different, still-listed version. */
export function pendingUpdates(
  items: readonly MarketplaceInstalledItem[],
  lookup: ReadonlyMap<string, MarketplaceCatalogEntry>,
): PendingUpdate[] {
  return items.flatMap((item) => {
    const entry = catalogEntryFor(item, lookup);
    if (!entry || entry.withdrawn || !entry.version || !item.version || entry.version === item.version) return [];
    return [{ entry, item }];
  });
}
