/**
 * Paints the wallpaper layer on the document root.
 *
 * One fixed layer under the shell carries the picture (and its blur); the
 * shell's region fills (styles/window-material.css) then mix over it exactly
 * as they do over the native material. Nothing here uses backdrop-filter.
 */
import { loadWallpaperImage } from './wallpaper-storage.js';
import type { WallpaperPreferences } from './wallpaper-preferences.js';

const LAYER_ID = 'piwin-wallpaper';
const INKSTONE_FACES = new Set(['piwin-inkstone-paper', 'piwin-inkstone-ink']);

let activeObjectUrl: string | undefined;
let activeImageId: string | undefined;
let loadToken = 0;

function revokeActiveUrl(): void {
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
  }
  activeObjectUrl = undefined;
  activeImageId = undefined;
}

function ensureLayer(root: HTMLElement): HTMLElement {
  let layer = root.ownerDocument.getElementById(LAYER_ID);
  if (!layer) {
    layer = root.ownerDocument.createElement('div');
    layer.id = LAYER_ID;
    layer.className = 'app-wallpaper';
    layer.setAttribute('aria-hidden', 'true');
    root.ownerDocument.body.prepend(layer);
  }
  return layer;
}

/**
 * The native-material marker owns `data-window-material` on the Inkstone
 * faces; a wallpaper turns the same translucent region styling on without it.
 */
export function syncWindowMaterialMarker(root: HTMLElement): void {
  const inkstone = INKSTONE_FACES.has(root.dataset.themeId ?? '');
  const wanted =
    inkstone && (root.dataset.nativeWindowMaterial !== undefined || root.dataset.wallpaper === 'on');
  if (wanted) {
    root.dataset.windowMaterial = 'on';
  } else {
    delete root.dataset.windowMaterial;
  }
}

/** Dressing only: blur / dim repaint live while a slider is dragged. */
function applyDressing(root: HTMLElement, wallpaper: WallpaperPreferences): void {
  root.style.setProperty('--wallpaper-blur', `${wallpaper.blur}px`);
  root.style.setProperty('--wallpaper-dim', `${wallpaper.dim}%`);
}

export function applyWallpaperToDocument(
  root: HTMLElement,
  wallpaper: WallpaperPreferences | undefined,
): void {
  const token = ++loadToken;
  if (!wallpaper) {
    revokeActiveUrl();
    root.ownerDocument.getElementById(LAYER_ID)?.remove();
    delete root.dataset.wallpaper;
    root.style.removeProperty('--wallpaper-image');
    root.style.removeProperty('--wallpaper-blur');
    root.style.removeProperty('--wallpaper-dim');
    syncWindowMaterialMarker(root);
    return;
  }

  applyDressing(root, wallpaper);
  ensureLayer(root);
  root.dataset.wallpaper = 'on';
  syncWindowMaterialMarker(root);

  if (activeImageId === wallpaper.id) {
    return;
  }
  if (
    wallpaper.id.startsWith('data:') ||
    wallpaper.id.startsWith('http:') ||
    wallpaper.id.startsWith('https:') ||
    wallpaper.id.startsWith('/')
  ) {
    revokeActiveUrl();
    activeImageId = wallpaper.id;
    root.style.setProperty('--wallpaper-image', `url("${wallpaper.id}")`);
    return;
  }
  void loadWallpaperImage(wallpaper.id).then((blob) => {
    if (token !== loadToken || !blob) {
      return;
    }
    revokeActiveUrl();
    activeObjectUrl = URL.createObjectURL(blob);
    activeImageId = wallpaper.id;
    root.style.setProperty('--wallpaper-image', `url("${activeObjectUrl}")`);
  });
}
