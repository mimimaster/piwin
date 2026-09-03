import { describe, expect, it } from 'vitest';
import { FLIP_CLICK_MAX_DISTANCE_PX, shouldFlipOnClick } from './flashcard-face-click.js';

const CLEAN_TAP = {
  pointerTravelPx: 0,
  selectionExistedOnPress: false,
  selectionExistsOnClick: false,
  targetIsInteractive: false,
};

describe('shouldFlipOnClick', () => {
  it('flips on a clean tap anywhere on the card', () => {
    expect(shouldFlipOnClick(CLEAN_TAP)).toBe(true);
    expect(shouldFlipOnClick({ ...CLEAN_TAP, pointerTravelPx: FLIP_CLICK_MAX_DISTANCE_PX })).toBe(true);
  });

  it('does not flip when the pointer travelled (drag)', () => {
    expect(
      shouldFlipOnClick({ ...CLEAN_TAP, pointerTravelPx: FLIP_CLICK_MAX_DISTANCE_PX + 1 }),
    ).toBe(false);
  });

  it('does not flip when a drag-select ended with text selected', () => {
    expect(shouldFlipOnClick({ ...CLEAN_TAP, selectionExistsOnClick: true })).toBe(false);
  });

  it('does not flip on the press that clears an existing selection', () => {
    expect(shouldFlipOnClick({ ...CLEAN_TAP, selectionExistedOnPress: true })).toBe(false);
  });

  it('lets interactive targets keep their own activation', () => {
    expect(shouldFlipOnClick({ ...CLEAN_TAP, targetIsInteractive: true })).toBe(false);
  });
});