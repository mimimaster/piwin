import { describe, expect, it } from 'vitest';
import type { MarketplaceCatalogEntry, MarketplaceSearchHit } from '@piwin/contracts';
import {
  catalogPackageKeys,
  formatRelativeDate,
  isCatalogDuplicate,
  packageTestId,
  sanitizeReadme,
  sortCommunityHits,
} from './marketplace-package-meta.js';

function hit(partial: Partial<MarketplaceSearchHit> & Pick<MarketplaceSearchHit, 'name'>): MarketplaceSearchHit {
  return {
    entryId: `npm:${partial.name}`,
    version: '1.0.0',
    description: '',
    source: 'npm-pi-package',
    installCommand: '',
    ...partial,
  };
}

const catalog = [
  {
    homepage: 'https://github.com/apmantza/pi-lens',
    install: { kind: 'pi-package', source: { kind: 'npm', packageName: 'pi-lens', version: '4.2.1' } },
  },
  {
    install: { kind: 'pi-package', source: { kind: 'git', repositoryUrl: 'https://github.com/o/r.git' } },
  },
] as unknown as MarketplaceCatalogEntry[];

describe('catalog de-duplication', () => {
  const keys = catalogPackageKeys(catalog);

  it('hides community hits that are already curated, by npm name or repository', () => {
    expect(isCatalogDuplicate(hit({ name: 'PI-LENS' }), keys)).toBe(true);
    expect(isCatalogDuplicate(hit({ name: 'other', repositoryUrl: 'https://github.com/O/R/' }), keys)).toBe(true);
    expect(
      isCatalogDuplicate(
        hit({ name: 'lens-fork', source: 'github', repositoryUrl: 'https://github.com/apmantza/pi-lens' }),
        keys,
      ),
    ).toBe(true);
    expect(isCatalogDuplicate(hit({ name: 'pi-other' }), keys)).toBe(false);
  });
});

describe('sortCommunityHits', () => {
  it('keeps source order for popular and puts the newest first for recent', () => {
    const hits = [
      hit({ name: 'a', updatedAt: '2026-01-01T00:00:00Z' }),
      hit({ name: 'b' }),
      hit({ name: 'c', updatedAt: '2026-09-01T00:00:00Z' }),
    ];
    expect(sortCommunityHits(hits, 'popular').map((item) => item.name)).toEqual(['a', 'b', 'c']);
    expect(sortCommunityHits(hits, 'recent').map((item) => item.name)).toEqual(['c', 'a', 'b']);
  });
});

describe('formatRelativeDate', () => {
  const now = Date.parse('2026-10-14T00:00:00Z');
  it('formats recent dates relatively and rejects garbage', () => {
    expect(formatRelativeDate('2026-10-11T00:00:00Z', 'en', now)).toBe('3 days ago');
    expect(formatRelativeDate('2026-10-11T00:00:00Z', 'zh-CN', now)).toBe('3天前');
    expect(formatRelativeDate('2026-07-01T00:00:00Z', 'en', now)).toBe('3 months ago');
    expect(formatRelativeDate('nope', 'en', now)).toBeUndefined();
  });
});

describe('sanitizeReadme', () => {
  it('drops remote images and badges but keeps their text and normal links', () => {
    const readme = [
      '# Title',
      '[![npm](https://img.shields.io/npm/v/x.svg)](https://npmjs.com/x)',
      '![diagram](https://example.com/d.png)',
      '<!-- hidden -->',
      'See [docs](https://example.com/docs).',
    ].join('\n');
    expect(sanitizeReadme(readme)).toBe('# Title\nnpm\ndiagram\n\nSee [docs](https://example.com/docs).');
  });
});

describe('sanitizeReadme with HTML', () => {
  it('turns HTML images into alt text, drops wrapper tags, and leaves code fences alone', () => {
    const readme = [
      '<p align="center">',
      '  <img src="https://raw.example/banner.png" alt="pi-lens" width="1100">',
      '</p>',
      '',
      '```html',
      '<img src="x.png">',
      '```',
    ].join('\n');
    expect(sanitizeReadme(readme)).toBe('pi-lens\n\n```html\n<img src="x.png">\n```');
  });
});

describe('packageTestId', () => {
  it('stays stable for existing e2e selectors', () => {
    expect(packageTestId(hit({ name: '@scope/pkg' }))).toBe('market-npm--scope-pkg');
    expect(packageTestId(hit({ name: 'x', source: 'github', entryId: 'github:o/r' }))).toBe('market-github-o-r');
  });
});
