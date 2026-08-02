import { describe, expect, it } from 'vitest';
import {
  PET_TARGET_DISPLAY_HEIGHT_PX,
  resolvePetDisplaySize,
  resolvePetOverlayWindowSize,
} from './pet-display-size.js';

describe('resolvePetDisplaySize', () => {
  it('renders Codex 192×208 cells at three-eighths scale (72×78)', () => {
    expect(resolvePetDisplaySize(192, 208)).toEqual({
      width: 72,
      height: 78,
      scale: 0.375,
    });
  });

  it('renders bundled 48×52 cells at 1.5× (72×78)', () => {
    expect(resolvePetDisplaySize(48, 52)).toEqual({
      width: 72,
      height: 78,
      scale: 1.5,
    });
  });

  it('preserves non-square aspect ratios instead of forcing a square box', () => {
    const size = resolvePetDisplaySize(128, 64);
    expect(size.width / size.height).toBeCloseTo(128 / 64, 5);
    expect(size.height).toBe(PET_TARGET_DISPLAY_HEIGHT_PX);
  });

  it('guards against zero / negative cell sizes', () => {
    expect(resolvePetDisplaySize(0, 0).width).toBeGreaterThan(0);
    expect(resolvePetDisplaySize(-10, 50).height).toBeGreaterThan(0);
  });
});

describe('resolvePetOverlayWindowSize', () => {
  it('sizes tightly around the sprite when idle (no bubble band)', () => {
    const display = resolvePetDisplaySize(192, 208);
    const windowSize = resolvePetOverlayWindowSize(display, false);
    expect(windowSize.width).toBe(display.width + 24);
    expect(windowSize.height).toBe(display.height + 16);
  });

  it('expands for the bubble band and min bubble width when active', () => {
    const display = resolvePetDisplaySize(192, 208);
    const idle = resolvePetOverlayWindowSize(display, false);
    const active = resolvePetOverlayWindowSize(display, true);
    expect(active.width).toBeGreaterThan(idle.width);
    expect(active.height).toBeGreaterThan(idle.height);
    expect(active.width).toBeGreaterThanOrEqual(276 + 24);
  });
});
