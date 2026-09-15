import { describe, expect, it } from 'vitest';
import { formatBrowserZoomPercent, resolveBrowserDisplayBox } from './browser-display-box';

describe('resolveBrowserDisplayBox', () => {
  it('never upscales in fit mode when the panel is larger than the page', () => {
    const box = resolveBrowserDisplayBox({
      panelWidth: 1600,
      panelHeight: 1000,
      viewportWidth: 1280,
      viewportHeight: 800,
      zoom: 'fit',
    });
    expect(box.scale).toBe(1);
    expect(box.width).toBe(1280);
    expect(box.height).toBe(800);
  });

  it('shrinks in fit mode when the panel is smaller than the page', () => {
    const box = resolveBrowserDisplayBox({
      panelWidth: 640,
      panelHeight: 800,
      viewportWidth: 1280,
      viewportHeight: 800,
      zoom: 'fit',
    });
    expect(box.scale).toBe(0.5);
    expect(box.width).toBe(640);
    expect(box.height).toBe(400);
  });

  it('keeps 100% at native CSS size even when the panel is smaller', () => {
    const box = resolveBrowserDisplayBox({
      panelWidth: 400,
      panelHeight: 300,
      viewportWidth: 1280,
      viewportHeight: 800,
      zoom: '100',
    });
    expect(box.scale).toBe(1);
    expect(box.width).toBe(1280);
    expect(box.height).toBe(800);
  });

  it('treats an unmeasured panel as native size rather than a zero box', () => {
    const box = resolveBrowserDisplayBox({
      panelWidth: 0,
      panelHeight: 0,
      viewportWidth: 375,
      viewportHeight: 812,
      zoom: 'fit',
    });
    expect(box.scale).toBe(1);
    expect(box.width).toBe(375);
    expect(box.height).toBe(812);
  });

  it('formats the zoom chip from the display scale', () => {
    expect(formatBrowserZoomPercent(0.67)).toBe('67%');
    expect(formatBrowserZoomPercent(1)).toBe('100%');
  });
});
