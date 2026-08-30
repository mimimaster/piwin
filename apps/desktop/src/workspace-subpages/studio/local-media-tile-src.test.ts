import { describe, expect, it } from 'vitest';
import { localThumbPathForItem } from './local-media-tile-src';

describe('localThumbPathForItem', () => {
  it('returns empty when Host has not attached a thumb', () => {
    expect(
      localThumbPathForItem(
        {
          assetId: 'asset-1',
          absolutePath: '/Users/me/.piwin/media/sess/asset-1.png',
        },
        384,
      ),
    ).toBe('');
  });

  it('uses the sibling sidecar when a thumb exists', () => {
    expect(
      localThumbPathForItem(
        {
          assetId: 'asset-1',
          absolutePath: '/Users/me/.piwin/media/sess/asset-1.png',
          hasThumb: true,
        },
        384,
      ),
    ).toBe('/Users/me/.piwin/media/sess/asset-1.thumb.384.webp');
  });
});
