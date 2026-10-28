import { describe, expect, it } from 'vitest';
import { lockSwipeAxis, swipeDragOffset, swipeSettlesOpen } from './swipe-gesture.js';

describe('swipe gesture', () => {
  it('stays a tap until the finger moves, then follows the dominant axis', () => {
    expect(lockSwipeAxis(3, 4)).toBe('undecided');
    expect(lockSwipeAxis(-20, 6)).toBe('horizontal');
    expect(lockSwipeAxis(-9, 14)).toBe('vertical');
  });

  it('follows the finger between closed and open and rubber-bands beyond', () => {
    expect(swipeDragOffset(0, 30, 200)).toBe(0);
    expect(swipeDragOffset(0, -120, 200)).toBe(-120);
    expect(swipeDragOffset(-200, 50, 200)).toBe(-150);
    expect(swipeDragOffset(0, -240, 200)).toBe(-210);
  });

  it('settles by distance unless flicked', () => {
    expect(swipeSettlesOpen(-120, 200, 0)).toBe(true);
    expect(swipeSettlesOpen(-80, 200, 0)).toBe(false);
    expect(swipeSettlesOpen(-40, 200, -0.8)).toBe(true);
    expect(swipeSettlesOpen(-180, 200, 0.8)).toBe(false);
  });
});
