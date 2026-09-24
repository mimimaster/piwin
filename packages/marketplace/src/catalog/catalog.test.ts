import type { MarketplaceCatalogEntry } from '@piwin/contracts';
import { describe, expect, it } from 'vitest';
import {
  MARKETPLACE_CATALOG,
  findCatalogEntry,
  listCatalogEntries,
  matchCatalogEntry,
  validateCatalogEntry,
} from './catalog.js';

const baseSkill: MarketplaceCatalogEntry = {
  entryId: 'skill:demo',
  capabilityId: 'demo',
  kind: 'skill',
  category: 'docs-research',
  name: { en: 'Demo', zhCN: '示例' },
  summary: { en: 'demo', zhCN: '示例' },
  description: { en: 'demo', zhCN: '示例' },
  version: 'a'.repeat(40),
  author: 'test',
  sourceLabel: 'GitHub',
  install: {
    kind: 'skill',
    source: { kind: 'git', url: 'https://github.com/o/r.git', ref: 'a'.repeat(40) },
  },
  requirements: [],
  examples: [{ title: { en: 't', zhCN: 't' }, prompt: { en: 'p', zhCN: 'p' } }],
  verification: [{ level: 'author-declared' }],
  featured: false,
};

describe('curated marketplace catalog', () => {
  it('ships only valid, pinned entries with unique ids', () => {
    expect(MARKETPLACE_CATALOG.length).toBeGreaterThan(0);
    for (const entry of MARKETPLACE_CATALOG) {
      expect(validateCatalogEntry(entry)).toEqual([]);
    }
    const ids = MARKETPLACE_CATALOG.map((entry) => entry.entryId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never claims piwin-tested evidence it does not have', () => {
    const tested = MARKETPLACE_CATALOG.filter((entry) =>
      entry.verification.some((evidence) => evidence.level === 'piwin-tested'),
    );
    expect(tested).toEqual([]);
  });

  it('rejects moving git refs and unpinned packages', () => {
    const branchSkill: MarketplaceCatalogEntry = {
      ...baseSkill,
      install: {
        kind: 'skill',
        source: { kind: 'git', url: 'https://github.com/o/r.git', ref: 'main' },
      },
    };
    expect(validateCatalogEntry(branchSkill)).toContain(
      'skill:demo: git source must pin a full commit',
    );

    const floatingPackage: MarketplaceCatalogEntry = {
      ...baseSkill,
      entryId: 'extension:pi-demo',
      capabilityId: 'pi-demo',
      kind: 'extension',
      version: '1.0.0',
      install: { kind: 'pi-package', source: { kind: 'npm', packageName: 'pi-demo' } },
    };
    expect(validateCatalogEntry(floatingPackage)).toContain(
      'extension:pi-demo: npm package must pin an exact version',
    );

    const floatingMcp: MarketplaceCatalogEntry = {
      ...baseSkill,
      entryId: 'mcp:demo',
      kind: 'mcp',
      install: { kind: 'mcp', serverId: 'demo', draft: { command: 'npx', args: ['-y', 'demo'] } },
    };
    expect(validateCatalogEntry(floatingMcp)).toContain(
      'mcp:demo: MCP command must pin its package version',
    );
  });

  it('rejects an install descriptor that does not match the entry kind', () => {
    expect(validateCatalogEntry({ ...baseSkill, kind: 'mcp', entryId: 'mcp:demo' })).toContain(
      'mcp:demo: install kind skill ≠ mcp',
    );
  });

  it('filters by kind, category and bilingual query, featured first', () => {
    const skills = listCatalogEntries({ kinds: ['skill'] });
    expect(skills.every((entry) => entry.kind === 'skill')).toBe(true);
    expect(skills[0]?.featured).toBe(true);

    const docs = listCatalogEntries({ category: 'docs-research' });
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.every((entry) => entry.category === 'docs-research')).toBe(true);
    expect(listCatalogEntries({ query: '知识图谱' }).map((entry) => entry.entryId)).toEqual([
      'mcp:memory',
    ]);
  });

  it('hides withdrawn entries unless asked', () => {
    const catalog = [baseSkill, { ...baseSkill, entryId: 'skill:old', withdrawn: { reason: { en: 'x', zhCN: 'x' } } }];
    expect(listCatalogEntries({}, catalog).map((entry) => entry.entryId)).toEqual(['skill:demo']);
    expect(listCatalogEntries({ includeWithdrawn: true }, catalog)).toHaveLength(2);
  });

  it('matches installed resources back to entries, including multi-extension packages', () => {
    expect(findCatalogEntry('mcp:memory')?.capabilityId).toBe('memory');
    expect(matchCatalogEntry('extension', 'ff-labs-pi-fff')?.entryId).toBe('extension:ff-labs-pi-fff');
    expect(matchCatalogEntry('extension', 'ff-labs-pi-fff-grep')?.entryId).toBe(
      'extension:ff-labs-pi-fff',
    );
    expect(matchCatalogEntry('skill', 'ff-labs-pi-fff')).toBeUndefined();
    expect(matchCatalogEntry('mcp', 'memory-extra')).toBeUndefined();
  });
});
