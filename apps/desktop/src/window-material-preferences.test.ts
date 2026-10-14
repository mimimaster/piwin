import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WINDOW_MATERIAL_OPACITY,
  normalizeWindowMaterialOpacity,
  parseWindowMaterialOpacity,
  windowMaterialCssVars,
} from './window-material-preferences';

describe('window material preferences', () => {
  it('keeps the conversation the most solid region so text contrast holds', () => {
    expect(parseWindowMaterialOpacity(null)).toEqual(DEFAULT_WINDOW_MATERIAL_OPACITY);
    const { stage, ...chrome } = DEFAULT_WINDOW_MATERIAL_OPACITY;
    for (const opacity of Object.values(chrome)) {
      expect(stage).toBeGreaterThan(opacity);
    }
  });

  it('restores defaults from malformed or non-object storage', () => {
    expect(parseWindowMaterialOpacity('{not json')).toEqual(DEFAULT_WINDOW_MATERIAL_OPACITY);
    expect(parseWindowMaterialOpacity('[10,20]')).toEqual(DEFAULT_WINDOW_MATERIAL_OPACITY);
    expect(parseWindowMaterialOpacity('null')).toEqual(DEFAULT_WINDOW_MATERIAL_OPACITY);
  });

  it('merges stored regions over defaults and ignores unknown keys', () => {
    const parsed = parseWindowMaterialOpacity(JSON.stringify({ sidebar: 10, titlebar: 3 }));
    expect(parsed).toEqual({ ...DEFAULT_WINDOW_MATERIAL_OPACITY, sidebar: 10 });
  });

  it('clamps and rounds values into 0–100, falling back on non-numbers', () => {
    expect(normalizeWindowMaterialOpacity(140, 55)).toBe(100);
    expect(normalizeWindowMaterialOpacity(-5, 55)).toBe(0);
    expect(normalizeWindowMaterialOpacity(24.6, 55)).toBe(25);
    expect(normalizeWindowMaterialOpacity('40', 55)).toBe(55);
    expect(normalizeWindowMaterialOpacity(Number.NaN, 55)).toBe(55);
  });

  it('projects every region to the percentage variable the stylesheet reads', () => {
    expect(
      windowMaterialCssVars({ backdrop: 60, sidebar: 25, stage: 90, rightPanel: 100 }),
    ).toEqual({
      '--window-material-backdrop-opacity': '60%',
      '--window-material-sidebar-opacity': '25%',
      '--window-material-stage-opacity': '90%',
      '--window-material-right-panel-opacity': '100%',
    });
  });
});
