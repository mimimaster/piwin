// @vitest-environment happy-dom
/**
 * Mini placement memory is client-owned, per Host, and never blocks the mini.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  browserMiniHostScope,
  browserMiniPlacementStorageKey,
  readBrowserMiniPlacement,
  writeBrowserMiniPlacement,
} from './browser-mini-placement-store';

const CONTAINER = { width: 1200, height: 800 };

beforeEach(() => {
  localStorage.clear();
});

describe('browser mini placement store', () => {
  it('round-trips a corner through localStorage', () => {
    const key = browserMiniPlacementStorageKey('host-a');
    writeBrowserMiniPlacement(key, { x: 600, y: 200 }, CONTAINER);
    expect(readBrowserMiniPlacement(key, CONTAINER)).toEqual({ x: 600, y: 200 });
  });

  it('clears the corner when the window is docked again', () => {
    const key = browserMiniPlacementStorageKey('host-a');
    writeBrowserMiniPlacement(key, { x: 600, y: 200 }, CONTAINER);
    writeBrowserMiniPlacement(key, null, CONTAINER);
    expect(readBrowserMiniPlacement(key, CONTAINER)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it('keeps each Host on its own corner', () => {
    writeBrowserMiniPlacement(browserMiniPlacementStorageKey('host-a'), { x: 300, y: 120 }, CONTAINER);
    writeBrowserMiniPlacement(browserMiniPlacementStorageKey('host-b'), { x: 700, y: 400 }, CONTAINER);
    expect(readBrowserMiniPlacement(browserMiniPlacementStorageKey('host-a'), CONTAINER)).toEqual({
      x: 300,
      y: 120,
    });
    expect(readBrowserMiniPlacement(browserMiniPlacementStorageKey('host-b'), CONTAINER)).toEqual({
      x: 700,
      y: 400,
    });
  });

  it('falls back to the local bucket before the Host reports an id', () => {
    expect(browserMiniHostScope(null)).toBe('local');
    expect(browserMiniHostScope('  ')).toBe('local');
    expect(browserMiniHostScope('host-a')).toBe('host-a');
  });

  it('survives corrupt storage', () => {
    const key = browserMiniPlacementStorageKey('host-a');
    localStorage.setItem(key, '{not json');
    expect(readBrowserMiniPlacement(key, CONTAINER)).toBeNull();
  });
});
