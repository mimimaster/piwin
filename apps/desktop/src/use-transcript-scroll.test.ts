import { describe, expect, it } from 'vitest';
import { isNearBottom } from './use-transcript-scroll';

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
});
