// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { syncWindowMaterialMarker } from './wallpaper-document.js';

describe('syncWindowMaterialMarker', () => {
  afterEach(() => {
    delete document.documentElement.dataset.themeId;
    delete document.documentElement.dataset.nativeWindowMaterial;
    delete document.documentElement.dataset.wallpaper;
    delete document.documentElement.dataset.memoryPressure;
    delete document.documentElement.dataset.memoryParked;
    delete document.documentElement.dataset.windowMaterial;
  });

  it('keeps data-window-material active under memory pressure and parking when native material is present', () => {
    const root = document.documentElement;
    root.dataset.themeId = 'piwin-inkstone-ink';
    root.dataset.nativeWindowMaterial = 'vibrancy';

    syncWindowMaterialMarker(root);
    expect(root.dataset.windowMaterial).toBe('on');

    root.dataset.memoryPressure = 'moderate';
    syncWindowMaterialMarker(root);
    expect(root.dataset.windowMaterial).toBe('on');

    root.dataset.memoryPressure = 'critical';
    syncWindowMaterialMarker(root);
    expect(root.dataset.windowMaterial).toBe('on');

    root.dataset.memoryParked = '';
    syncWindowMaterialMarker(root);
    expect(root.dataset.windowMaterial).toBe('on');
  });

  it('drops data-window-material when neither native material nor wallpaper is active', () => {
    const root = document.documentElement;
    root.dataset.themeId = 'piwin-inkstone-paper';

    syncWindowMaterialMarker(root);
    expect(root.dataset.windowMaterial).toBeUndefined();

    root.dataset.wallpaper = 'on';
    syncWindowMaterialMarker(root);
    expect(root.dataset.windowMaterial).toBe('on');
  });
});
