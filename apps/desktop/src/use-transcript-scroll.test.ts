import { describe, expect, it } from 'vitest';
import {
  computeScrollProgress,
  isNearBottom,
  isScrollOverflowing,
  shouldDetachFollowTailFromScrollDelta,
  shouldDetachFollowTailFromWheelDelta,
} from './use-transcript-scroll';

describe('isNearBottom', () => {
  it('detects near-bottom scroll position', () => {
    const element = {
      scrollHeight: 1000,
      scrollTop: 900,
      clientHeight: 80,
    } as HTMLElement;
    expect(isNearBottom(element, 64)).toBe(true);
  });

  it('detects scrolled-away position', () => {
    const element = {
      scrollHeight: 1000,
      scrollTop: 100,
      clientHeight: 80,
    } as HTMLElement;
    expect(isNearBottom(element, 64)).toBe(false);
  });

  it('treats a large remaining distance as not near bottom (artifact growth lag)', () => {
    // Typical intermediate state: Artifact iframe grew 400px before stick ran.
    const element = {
      scrollHeight: 2000,
      scrollTop: 1400,
      clientHeight: 200,
    } as HTMLElement;
    expect(isNearBottom(element, 64)).toBe(false);
  });
});

describe('computeScrollProgress', () => {
  it('reports full ratio when content fits the viewport', () => {
    const element = {
      scrollHeight: 400,
      scrollTop: 0,
      clientHeight: 400,
    } as HTMLElement;
    expect(computeScrollProgress(element)).toEqual({ progress: 1, ratio: 1 });
  });

  it('reports progress and ratio when content overflows', () => {
    const element = {
      scrollHeight: 1000,
      scrollTop: 250,
      clientHeight: 500,
    } as HTMLElement;
    expect(computeScrollProgress(element)).toEqual({
      progress: 0.5,
      ratio: 0.5,
    });
  });

  it('clamps progress to the unit interval', () => {
    const element = {
      scrollHeight: 1000,
      scrollTop: 900,
      clientHeight: 200,
    } as HTMLElement;
    // maxScroll = 800; scrollTop/maxScroll = 1.125 → clamped to 1
    expect(computeScrollProgress(element).progress).toBe(1);
  });
});

describe('isScrollOverflowing', () => {
  it('treats a full ratio as not overflowing', () => {
    expect(isScrollOverflowing(1)).toBe(false);
  });

  it('ignores sub-pixel thrash near a full ratio', () => {
    expect(isScrollOverflowing(0.999)).toBe(false);
  });

  it('marks a clearly overflowing viewport', () => {
    expect(isScrollOverflowing(0.5)).toBe(true);
  });
});

describe('shouldDetachFollowTailFromScrollDelta', () => {
  it('detaches when the user scrolls up enough even during a programmatic stick race', () => {
    expect(
      shouldDetachFollowTailFromScrollDelta({
        scrollTopDelta: -24,
        programmatic: true,
        nearBottom: false,
      }),
    ).toBe(true);
  });

  it('does not detach for tiny thrash or content growth at the tail', () => {
    expect(
      shouldDetachFollowTailFromScrollDelta({
        scrollTopDelta: -2,
        programmatic: true,
        nearBottom: false,
      }),
    ).toBe(false);
    expect(
      shouldDetachFollowTailFromScrollDelta({
        scrollTopDelta: -40,
        programmatic: false,
        nearBottom: true,
      }),
    ).toBe(false);
  });

  it('detaches non-programmatic upward motion away from the tail', () => {
    expect(
      shouldDetachFollowTailFromScrollDelta({
        scrollTopDelta: -1,
        programmatic: false,
        nearBottom: false,
      }),
    ).toBe(true);
  });
});

describe('shouldDetachFollowTailFromWheelDelta', () => {
  it('treats negative deltaY as history navigation', () => {
    expect(shouldDetachFollowTailFromWheelDelta(-12)).toBe(true);
    expect(shouldDetachFollowTailFromWheelDelta(12)).toBe(false);
    expect(shouldDetachFollowTailFromWheelDelta(0)).toBe(false);
  });
});
