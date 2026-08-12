import { describe, expect, it } from 'vitest';
import { PIWIN_APPEARANCE_DARK, PIWIN_APPEARANCE_INK_WASH } from './appearance-tokens';
import { getThemeAsset } from './ink-wash-assets';

describe('ink-wash asset registry', () => {
  it('returns only fixed product-owned paths for the ink-wash style', () => {
    expect(getThemeAsset(PIWIN_APPEARANCE_INK_WASH, 'hero')).toBe('/ui/ink-wash/hero.jpg?v=restore');
    expect(getThemeAsset(PIWIN_APPEARANCE_INK_WASH, 'agentSeal')).toBe(
      '/ui/ink-wash/agent-seal.jpg',
    );
  });

  it('falls back to token-only rendering for other themes', () => {
    expect(getThemeAsset(PIWIN_APPEARANCE_DARK, 'hero')).toBeUndefined();
    expect(getThemeAsset({ ...PIWIN_APPEARANCE_INK_WASH, visualStyle: 'paper' }, 'hero')).toBeUndefined();
  });
});

