import { describe, expect, it } from 'vitest';
import {
  overlayPointerBeganOnSurface,
  shouldDismissOverlayOnPointerUp,
} from './overlay-dismiss.js';

const overlay = { id: 'overlay' };
const field = { id: 'field' };

describe('overlay dismiss', () => {
  it('treats a press as starting on the overlay only when the target is the overlay', () => {
    expect(
      overlayPointerBeganOnSurface({ target: overlay, currentTarget: overlay }),
    ).toBe(true);
    expect(
      overlayPointerBeganOnSurface({ target: field, currentTarget: overlay }),
    ).toBe(false);
  });

  it('dismisses only when the press started and ended on the overlay', () => {
    expect(
      shouldDismissOverlayOnPointerUp({
        pointerBeganOnOverlay: true,
        target: overlay,
        currentTarget: overlay,
      }),
    ).toBe(true);
  });

  it('does not dismiss when a press started inside the dialog and ended on the overlay', () => {
    expect(
      shouldDismissOverlayOnPointerUp({
        pointerBeganOnOverlay: false,
        target: overlay,
        currentTarget: overlay,
      }),
    ).toBe(false);
  });

  it('does not dismiss when a press started on the overlay and ended inside the dialog', () => {
    expect(
      shouldDismissOverlayOnPointerUp({
        pointerBeganOnOverlay: true,
        target: field,
        currentTarget: overlay,
      }),
    ).toBe(false);
  });
});
