import { describe, expect, it } from 'vitest';
import { formatBrowserDensityRatio, resolveBrowserMirrorDensity } from './browser-mirror-density';

const frame = {
  viewportWidth: 1500,
  viewportHeight: 900,
  encodedWidth: 3000,
  encodedHeight: 1800,
};

describe('resolveBrowserMirrorDensity', () => {
  it('reports a healthy ratio for a Retina-sized full-width panel', () => {
    const density = resolveBrowserMirrorDensity({
      frame,
      displayWidth: 1500,
      displayHeight: 900,
      devicePixelRatio: 2,
    });
    expect(density.requiredWidth).toBe(3000);
    expect(density.requiredHeight).toBe(1800);
    expect(density.widthRatio).toBe(1);
    expect(density.heightRatio).toBe(1);
    expect(density.low).toBe(false);
  });

  it('flags a fixed 1280×800 JPEG stretched into a wide Retina panel', () => {
    const density = resolveBrowserMirrorDensity({
      frame: {
        viewportWidth: 1280,
        viewportHeight: 800,
        encodedWidth: 2560,
        encodedHeight: 1600,
      },
      displayWidth: 1600,
      displayHeight: 1000,
      devicePixelRatio: 2,
    });
    expect(density.widthRatio).toBeCloseTo(0.8, 5);
    expect(density.heightRatio).toBeCloseTo(0.8, 5);
    expect(density.low).toBe(true);
  });

  it('flags when only one axis is short', () => {
    const density = resolveBrowserMirrorDensity({
      frame: { ...frame, encodedHeight: 1000 },
      displayWidth: 1500,
      displayHeight: 900,
      devicePixelRatio: 2,
    });
    expect(density.widthRatio).toBe(1);
    expect(density.low).toBe(true);
  });

  it('treats an unmeasured frame as unknown rather than low', () => {
    const density = resolveBrowserMirrorDensity({
      frame: { viewportWidth: 1280, viewportHeight: 800 },
      displayWidth: 1280,
      displayHeight: 800,
      devicePixelRatio: 2,
    });
    expect(density.widthRatio).toBeUndefined();
    expect(density.heightRatio).toBeUndefined();
    expect(density.low).toBe(false);
  });

  it('falls back to DPR 1 and skips ratios when the panel is not laid out', () => {
    const density = resolveBrowserMirrorDensity({
      frame,
      displayWidth: 0,
      displayHeight: 0,
      devicePixelRatio: 0,
    });
    expect(density.requiredWidth).toBeUndefined();
    expect(density.low).toBe(false);
  });
});

describe('formatBrowserDensityRatio', () => {
  it('joins measured axes without a glyph icon', () => {
    expect(
      formatBrowserDensityRatio({
        widthRatio: 0.8,
        heightRatio: 0.8,
        low: true,
      }),
    ).toBe('80% / 80%');
  });
});
