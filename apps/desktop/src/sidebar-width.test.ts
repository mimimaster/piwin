import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SIDEBAR_DEFAULT_WIDTH_PX,
  SIDEBAR_MAX_WIDTH_PX,
  SIDEBAR_MIN_WIDTH_PX,
  clampSidebarWidth,
  clampSidebarWidthForViewport,
  loadSidebarWidth,
  saveSidebarWidth,
  shouldCollapseSidebar,
  shouldExpandSidebar,
  SIDEBAR_COLLAPSE_BELOW_PX,
} from './sidebar-width';

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

describe('clampSidebarWidth', () => {
  it('keeps values inside the absolute band', () => {
    expect(clampSidebarWidth(350)).toBe(350);
    expect(clampSidebarWidth(SIDEBAR_MIN_WIDTH_PX - 40)).toBe(SIDEBAR_MIN_WIDTH_PX);
    expect(clampSidebarWidth(SIDEBAR_MAX_WIDTH_PX + 80)).toBe(SIDEBAR_MAX_WIDTH_PX);
  });

  it('rounds and rejects non-finite input', () => {
    expect(clampSidebarWidth(355.4)).toBe(355);
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_WIDTH_PX);
  });
});

describe('clampSidebarWidthForViewport', () => {
  it('does not steal stage below the minimum budget', () => {
    // viewport 900, reserved right 280, min stage 280 → max sidebar 340
    expect(
      clampSidebarWidthForViewport(400, 900, {
        reservedChromePx: 280,
        minStagePx: 280,
      }),
    ).toBe(340);
  });
});

describe('sidebar width band', () => {
  it('lets the default width narrow before reaching the min', () => {
    expect(SIDEBAR_MIN_WIDTH_PX).toBe(220);
    expect(SIDEBAR_DEFAULT_WIDTH_PX).toBe(300);
    expect(clampSidebarWidth(SIDEBAR_DEFAULT_WIDTH_PX - 60)).toBe(SIDEBAR_DEFAULT_WIDTH_PX - 60);
    expect(shouldCollapseSidebar(SIDEBAR_DEFAULT_WIDTH_PX - 60)).toBe(false);
  });
});

describe('sidebar drag-to-collapse', () => {
  it('holds at min width through the resistance band', () => {
    expect(shouldCollapseSidebar(SIDEBAR_MIN_WIDTH_PX)).toBe(false);
    expect(shouldCollapseSidebar(SIDEBAR_MIN_WIDTH_PX - 40)).toBe(false);
    expect(shouldCollapseSidebar(SIDEBAR_COLLAPSE_BELOW_PX)).toBe(false);
    // In the band the drag clamps to min rather than following the pointer.
    expect(clampSidebarWidth(SIDEBAR_COLLAPSE_BELOW_PX + 1)).toBe(SIDEBAR_MIN_WIDTH_PX);
  });

  it('collapses only below the absolute threshold', () => {
    expect(SIDEBAR_COLLAPSE_BELOW_PX).toBe(140);
    expect(shouldCollapseSidebar(SIDEBAR_COLLAPSE_BELOW_PX - 1)).toBe(true);
    expect(shouldCollapseSidebar(0)).toBe(true);
    expect(shouldCollapseSidebar(Number.NaN)).toBe(false);
  });
});

describe('sidebar reverse-drag expand', () => {
  it('expands at min width and stays collapsed in the resistance band', () => {
    expect(shouldExpandSidebar(SIDEBAR_COLLAPSE_BELOW_PX + 20)).toBe(false);
    expect(shouldExpandSidebar(SIDEBAR_MIN_WIDTH_PX - 1)).toBe(false);
    expect(shouldExpandSidebar(SIDEBAR_MIN_WIDTH_PX)).toBe(true);
    expect(shouldExpandSidebar(Number.NaN)).toBe(false);
  });
});

describe('load/saveSidebarWidth', () => {
  it('defaults when empty and roundtrips saved values', () => {
    expect(loadSidebarWidth()).toBe(SIDEBAR_DEFAULT_WIDTH_PX);
    saveSidebarWidth(350);
    expect(loadSidebarWidth()).toBe(350);
  });
});
