import { describe, expect, it } from 'vitest';
import type { WikiConceptItem } from '@piwin/contracts';
import { suggestRelatedWikiPages } from './wiki-related.js';

function item(partial: Partial<WikiConceptItem> & Pick<WikiConceptItem, 'slug' | 'title'>): WikiConceptItem {
  return {
    summary: '',
    tags: [],
    updatedAt: '2026-01-01T00:00:00Z',
    relativePath: `concepts/${partial.slug}.md`,
    ...partial,
  };
}

describe('suggestRelatedWikiPages', () => {
  it('flags a same-slug page as existing and lists title/tag neighbours', () => {
    const concepts = [
      item({ slug: 'sleep-debt', title: 'Sleep debt', tags: ['health'] }),
      item({ slug: 'circadian-rhythm', title: 'Circadian rhythm', tags: ['health'] }),
      item({ slug: 'kv-cache', title: 'KV Cache', tags: ['inference'] }),
    ];
    const result = suggestRelatedWikiPages({
      title: 'Sleep debt',
      tags: ['health'],
      concepts,
      slug: 'sleep-debt',
    });
    expect(result.existingSlug).toBe('sleep-debt');
    expect(result.related.map((page) => page.slug)).toEqual(['circadian-rhythm']);
    expect(result.related[0]?.reason).toBe('tag');
  });
});
