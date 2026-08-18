import { describe, expect, it } from 'vitest';
import {
  filterMarketplaceCards,
  marketplaceCardsForCategory,
  PLUGIN_MARKETPLACE_CARDS,
} from './plugin-marketplace-catalog.js';

describe('plugin marketplace catalog', () => {
  it('lists the featured marketplace set', () => {
    expect(marketplaceCardsForCategory('featured').map((card) => card.id)).toEqual([
      'cloudflare',
      'github',
      'remotion',
      'hyperframes',
      'figma',
    ]);
    expect(PLUGIN_MARKETPLACE_CARDS).toHaveLength(5);
  });

  it('filters by name and leaves unknown queries empty', () => {
    expect(filterMarketplaceCards(PLUGIN_MARKETPLACE_CARDS, 'cloud').map((card) => card.id)).toEqual(
      ['cloudflare'],
    );
    expect(filterMarketplaceCards(PLUGIN_MARKETPLACE_CARDS, 'zzz')).toEqual([]);
  });
});
