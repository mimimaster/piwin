import { describe, expect, it } from 'vitest';
import type { MarketplaceCatalogEntry, MarketplaceInstalledItem } from '@piwin/contracts';
import {
  countCatalogKinds,
  filterCatalogEntries,
  filterInstalledItems,
  groupInstalledItems,
  indexCatalogEntries,
  pendingUpdates,
  presentCategories,
} from './marketplace-view-model.js';

function entry(partial: Partial<MarketplaceCatalogEntry> & Pick<MarketplaceCatalogEntry, 'entryId'>): MarketplaceCatalogEntry {
  return {
    capabilityId: partial.entryId.split(':')[1] ?? partial.entryId,
    kind: 'skill',
    category: 'docs-research',
    name: { en: partial.entryId, zhCN: partial.entryId },
    summary: { en: '', zhCN: '' },
    description: { en: '', zhCN: '' },
    version: '1.0.0',
    author: 'someone',
    sourceLabel: 'GitHub',
    install: { kind: 'skill', source: { kind: 'git', url: 'https://github.com/o/r' } },
    requirements: [],
    examples: [],
    verification: [],
    featured: false,
    ...partial,
  } as MarketplaceCatalogEntry;
}

function item(partial: Partial<MarketplaceInstalledItem> & Pick<MarketplaceInstalledItem, 'capabilityId'>): MarketplaceInstalledItem {
  return {
    installationKey: `skill:${partial.capabilityId}`,
    kind: 'skill',
    name: partial.capabilityId,
    availability: 'available',
    enabled: true,
    source: 'user',
    canToggle: true,
    ...partial,
  };
}

const entries = [
  entry({ entryId: 'extension:lens', kind: 'extension', category: 'code-development' }),
  entry({ entryId: 'skill:doc', name: { en: 'Doc', zhCN: '文档协作' } }),
  entry({ entryId: 'skill:old', withdrawn: { reason: { en: 'gone', zhCN: '下架' } } }),
  entry({ entryId: 'extension:goal', kind: 'extension', sourceLabel: 'piwin-extensions', category: 'code-development' }),
];

describe('catalog filtering', () => {
  it('hides withdrawn entries and matches Chinese names', () => {
    expect(filterCatalogEntries(entries, { kind: 'all', category: 'all', query: '' }).map((e) => e.entryId)).toEqual([
      'extension:goal',
      'extension:lens',
      'skill:doc',
    ]);
    expect(filterCatalogEntries(entries, { kind: 'all', category: 'all', query: '文档' }).map((e) => e.entryId)).toEqual([
      'skill:doc',
    ]);
    expect(
      filterCatalogEntries(entries, { kind: 'piwin-extension', category: 'all', query: '' }).map((e) => e.entryId),
    ).toEqual(['extension:goal']);
  });

  it('counts only kinds and categories that have live entries', () => {
    expect(countCatalogKinds(entries)).toEqual({ extension: 2, skill: 1, 'piwin-extension': 1 });
    expect(presentCategories(entries, 'all')).toEqual(['code-development', 'docs-research']);
    expect(presentCategories(entries, 'extension')).toEqual(['code-development']);
  });
});

describe('installed grouping', () => {
  const lookup = indexCatalogEntries(entries);
  const items = [
    item({ capabilityId: 'doc', catalogEntryId: 'skill:doc', version: '0.9.0' }),
    item({ capabilityId: 'broken', availability: 'failed' }),
    item({ capabilityId: 'lens', kind: 'extension', installationKey: 'extension:lens', availability: 'pending-apply' }),
    item({ capabilityId: 'old', catalogEntryId: 'skill:old', version: '0.1.0' }),
  ];

  it('puts items that need attention first and groups the rest by kind', () => {
    const groups = groupInstalledItems(items);
    expect(groups.attention.map((i) => i.capabilityId)).toEqual(['broken', 'lens']);
    expect(groups.byKind).toEqual([{ kind: 'skill', items: [items[0], items[3]] }]);
  });

  it('offers updates only for listed entries with a different pinned version', () => {
    expect(pendingUpdates(items, lookup).map((u) => u.item.capabilityId)).toEqual(['doc']);
  });

  it('filters installed items by kind and catalog names', () => {
    expect(filterInstalledItems(items, lookup, { kind: 'all', query: '文档' }).map((i) => i.capabilityId)).toEqual(['doc']);
    expect(filterInstalledItems(items, lookup, { kind: 'extension', query: '' }).map((i) => i.capabilityId)).toEqual([
      'lens',
    ]);
  });
});
