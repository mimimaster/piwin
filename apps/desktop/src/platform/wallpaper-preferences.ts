/**
 * Wallpaper behind the desktop shell (Inkstone paper / ink faces).
 *
 * The image bytes live in IndexedDB (wallpaper-storage.ts); the preference
 * only carries the stored image id and how the layer is dressed. While a
 * wallpaper is set the panels switch to their own, clearer opacity set so the
 * picture can show through; the user's regular window-material opacities are
 * left untouched and return as soon as the wallpaper is removed.
 */
import {
  normalizeWindowMaterialOpacity,
  WINDOW_MATERIAL_REGIONS,
  type WindowMaterialOpacity,
} from './window-material-preferences.js';

export type WallpaperPreferences = {
  /** Key of the stored image in wallpaper-storage.ts. */
  id: string;
  /** Gaussian blur radius of the picture, in CSS px. */
  blur: number;
  /** How strongly the theme void colour veils the picture, in percent. */
  dim: number;
  /** Region opacities used while the wallpaper is set. */
  opacity: WindowMaterialOpacity;
};

export const WALLPAPER_BLUR_MAX = 40;
export const WALLPAPER_DIM_MAX = 80;
export const DEFAULT_WALLPAPER_BLUR = 0;
export const DEFAULT_WALLPAPER_DIM = 30;

/**
 * Clearly thinner than DEFAULT_WINDOW_MATERIAL_OPACITY (60/30/75/45). The
 * conversation keeps the most body so transcript text holds its contrast;
 * cards inside it stay solid regardless.
 */
export const DEFAULT_WALLPAPER_OPACITY: WindowMaterialOpacity = {
  backdrop: 15,
  sidebar: 15,
  stage: 55,
  rightPanel: 35,
};

function clampInt(value: unknown, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(0, Math.round(value)));
}

export function createWallpaperPreferences(id: string): WallpaperPreferences {
  return {
    id,
    blur: DEFAULT_WALLPAPER_BLUR,
    dim: DEFAULT_WALLPAPER_DIM,
    opacity: { ...DEFAULT_WALLPAPER_OPACITY },
  };
}

export function parseWallpaperPreferences(raw: string | null): WallpaperPreferences | undefined {
  if (raw === null) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const stored = parsed as Record<string, unknown>;
  if (typeof stored.id !== 'string' || stored.id === '') {
    return undefined;
  }
  const storedOpacity =
    typeof stored.opacity === 'object' && stored.opacity !== null
      ? (stored.opacity as Record<string, unknown>)
      : {};
  const opacity = { ...DEFAULT_WALLPAPER_OPACITY };
  for (const region of WINDOW_MATERIAL_REGIONS) {
    opacity[region] = normalizeWindowMaterialOpacity(storedOpacity[region], opacity[region]);
  }
  return {
    id: stored.id,
    blur: clampInt(stored.blur, DEFAULT_WALLPAPER_BLUR, WALLPAPER_BLUR_MAX),
    dim: clampInt(stored.dim, DEFAULT_WALLPAPER_DIM, WALLPAPER_DIM_MAX),
    opacity,
  };
}

/** The opacity set the shell paints with: the wallpaper's own while one is set. */
export function effectiveWindowMaterialOpacity(preferences: {
  windowMaterial?: WindowMaterialOpacity | undefined;
  wallpaper?: WallpaperPreferences | undefined;
}): WindowMaterialOpacity | undefined {
  return preferences.wallpaper?.opacity ?? preferences.windowMaterial;
}
