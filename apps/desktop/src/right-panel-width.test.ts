import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RIGHT_PANEL_DEFAULT_WIDTH_PX,
  RIGHT_PANEL_MAX_WIDTH_PX,
  RIGHT_PANEL_MIN_WIDTH_PX,
  clampRightPanelWidth,
  clampRightPanelWidthForViewport,
  loadRightPanelWidth,
  saveRightPanelWidth,
} from './right-panel-width';

function createMockStorage(): Storage {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) {
        delete store[key];
      }
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createMockStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('clampRightPanelWidth', () => {
  it('keeps values inside the absolute band', () => {
    expect(clampRightPanelWidth(320)).toBe(320);
    expect(clampRightPanelWidth(RIGHT_PANEL_MIN_WIDTH_PX - 40)).toBe(
      RIGHT_PANEL_MIN_WIDTH_PX,
    );
    expect(clampRightPanelWidth(RIGHT_PANEL_MAX_WIDTH_PX + 80)).toBe(
      RIGHT_PANEL_MAX_WIDTH_PX,
    );
  });

  it('rounds and rejects non-finite input', () => {
    expect(clampRightPanelWidth(333.7)).toBe(334);
    expect(clampRightPanelWidth(Number.NaN)).toBe(RIGHT_PANEL_DEFAULT_WIDTH_PX);
    expect(clampRightPanelWidth(Number.POSITIVE_INFINITY)).toBe(
      RIGHT_PANEL_DEFAULT_WIDTH_PX,
    );
  });
});

describe('clampRightPanelWidthForViewport', () => {
  it('does not steal stage below the minimum budget', () => {
    // viewport 900, reserved chrome 260, min stage 360 → max panel 280
    expect(
      clampRightPanelWidthForViewport(500, 900, {
        reservedChromePx: 260,
        minStagePx: 360,
      }),
    ).toBe(280);
  });

  it('still respects absolute min when viewport is tight', () => {
    expect(
      clampRightPanelWidthForViewport(200, 500, {
        reservedChromePx: 260,
        minStagePx: 360,
      }),
    ).toBe(RIGHT_PANEL_MIN_WIDTH_PX);
  });
});

describe('load/saveRightPanelWidth', () => {
  it('defaults when empty and roundtrips saved values', () => {
    expect(loadRightPanelWidth()).toBe(RIGHT_PANEL_DEFAULT_WIDTH_PX);
    saveRightPanelWidth(410);
    expect(loadRightPanelWidth()).toBe(410);
  });

  it('clamps corrupt storage', () => {
    localStorage.setItem('piwin.desktop.rightPanelWidth', '9999');
    expect(loadRightPanelWidth()).toBe(RIGHT_PANEL_MAX_WIDTH_PX);
    localStorage.setItem('piwin.desktop.rightPanelWidth', 'nope');
    expect(loadRightPanelWidth()).toBe(RIGHT_PANEL_DEFAULT_WIDTH_PX);
  });
});
