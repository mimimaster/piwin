import { describe, expect, it } from 'vitest';
import { isFollowTailNearBottom } from './use-follow-tail.js';

describe('isFollowTailNearBottom', () => {
  it('follows while the remaining distance is within the threshold', () => {
    expect(isFollowTailNearBottom(936, 1000, 50, 64)).toBe(true);
    expect(isFollowTailNearBottom(800, 1000, 50, 64)).toBe(false);
  });

  it('treats a short document as already at the tail', () => {
    expect(isFollowTailNearBottom(0, 40, 50, 64)).toBe(true);
  });
});
