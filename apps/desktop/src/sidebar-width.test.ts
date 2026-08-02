import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SIDEBAR_DEFAULT_WIDTH_PX,
  SIDEBAR_MAX_WIDTH_PX,
  SIDEBAR_MIN_WIDTH_PX,
  clampSidebarWidth,
  clampSidebarWidthForViewport,
  loadSidebarWidth,
  saveSidebarWidth,
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
    expect(clampSidebarWidth(260)).toBe(260);
    expect(clampSidebarWidth(SIDEBAR_MIN_WIDTH_PX - 40)).toBe(SIDEBAR_MIN_WIDTH_PX);
    expect(clampSidebarWidth(SIDEBAR_MAX_WIDTH_PX + 80)).toBe(SIDEBAR_MAX_WIDTH_PX);
  });

  it('rounds and rejects non-finite input', () => {
    expect(clampSidebarWidth(255.4)).toBe(255);
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

describe('load/saveSidebarWidth', () => {
  it('defaults when empty and roundtrips saved values', () => {
    expect(loadSidebarWidth()).toBe(SIDEBAR_DEFAULT_WIDTH_PX);
    saveSidebarWidth(300);
    expect(loadSidebarWidth()).toBe(300);
  });
});
