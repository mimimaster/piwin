import { describe, expect, it } from 'vitest';
import { petSpriteShouldAnimate } from './pet-sprite-animation';

describe('petSpriteShouldAnimate', () => {
  it('stops on idle with no hover, no bubble, and no temp action', () => {
    expect(
      petSpriteShouldAnimate({
        state: 'idle',
        hovered: false,
        hasTempAction: false,
        hasBubble: false,
        visibilityState: 'visible',
      }),
    ).toBe(false);
  });

  it('runs while hovered, acting, showing a bubble, or not idle', () => {
    expect(
      petSpriteShouldAnimate({
        state: 'idle',
        hovered: true,
        hasTempAction: false,
        hasBubble: false,
        visibilityState: 'visible',
      }),
    ).toBe(true);
    expect(
      petSpriteShouldAnimate({
        state: 'idle',
        hovered: false,
        hasTempAction: true,
        hasBubble: false,
        visibilityState: 'visible',
      }),
    ).toBe(true);
    expect(
      petSpriteShouldAnimate({
        state: 'idle',
        hovered: false,
        hasTempAction: false,
        hasBubble: true,
        visibilityState: 'visible',
      }),
    ).toBe(true);
    expect(
      petSpriteShouldAnimate({
        state: 'running',
        hovered: false,
        hasTempAction: false,
        hasBubble: false,
        visibilityState: 'visible',
      }),
    ).toBe(true);
  });

  it('cancels when the document is hidden even if the pet is active', () => {
    expect(
      petSpriteShouldAnimate({
        state: 'running',
        hovered: true,
        hasTempAction: true,
        hasBubble: true,
        visibilityState: 'hidden',
      }),
    ).toBe(false);
  });
});
