import { describe, expect, it } from 'vitest';
import {
  createWallpaperPreferences,
  DEFAULT_WALLPAPER_OPACITY,
  effectiveWindowMaterialOpacity,
  parseWallpaperPreferences,
} from './wallpaper-preferences';
import { scaleToMaxEdge } from './wallpaper-storage';
import { DEFAULT_WINDOW_MATERIAL_OPACITY, WINDOW_MATERIAL_REGIONS } from './window-material-preferences';

describe('wallpaper preferences', () => {
  it('is clearly more transparent than the regular defaults in every region', () => {
    for (const region of WINDOW_MATERIAL_REGIONS) {
      expect(DEFAULT_WALLPAPER_OPACITY[region]).toBeLessThan(
        DEFAULT_WINDOW_MATERIAL_OPACITY[region],
      );
    }
  });

  it('uses the regular opacities without a wallpaper and its own set with one', () => {
    const custom = { backdrop: 10, sidebar: 20, stage: 30, rightPanel: 40 };
    expect(effectiveWindowMaterialOpacity({ windowMaterial: custom })).toBe(custom);
    expect(effectiveWindowMaterialOpacity({})).toBeUndefined();
    const wallpaper = createWallpaperPreferences('w1');
    expect(effectiveWindowMaterialOpacity({ windowMaterial: custom, wallpaper })).toBe(
      wallpaper.opacity,
    );
  });

  it('round-trips and clamps stored values', () => {
    const wallpaper = createWallpaperPreferences('w1');
    expect(parseWallpaperPreferences(JSON.stringify(wallpaper))).toEqual(wallpaper);
    const parsed = parseWallpaperPreferences(
      JSON.stringify({ id: 'w2', blur: 999, dim: -5, opacity: { stage: 500, sidebar: 'x' } }),
    );
    expect(parsed).toEqual({
      id: 'w2',
      blur: 40,
      dim: 0,
      opacity: { ...DEFAULT_WALLPAPER_OPACITY, stage: 100 },
    });
  });

  it('rejects missing or malformed data', () => {
    expect(parseWallpaperPreferences(null)).toBeUndefined();
    expect(parseWallpaperPreferences('not json')).toBeUndefined();
    expect(parseWallpaperPreferences('[]')).toBeUndefined();
    expect(parseWallpaperPreferences('{"blur":3}')).toBeUndefined();
  });
});

describe('wallpaper downscaling', () => {
  it('keeps small images and scales large ones by the longest edge', () => {
    expect(scaleToMaxEdge(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(scaleToMaxEdge(5760, 2880, 2880)).toEqual({ width: 2880, height: 1440 });
    expect(scaleToMaxEdge(1000, 4000, 2000)).toEqual({ width: 500, height: 2000 });
  });
});
