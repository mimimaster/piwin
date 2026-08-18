import type { PetAnimationState } from '@piwin/contracts';

export const PET_IDLE_ACTION_INTERVAL_MS = 4000;
export const PET_ACTION_DURATION_MS = 1200;

export type PetSpriteAnimationInput = {
  state: PetAnimationState;
  hovered: boolean;
  hasTempAction: boolean;
  hasBubble: boolean;
  visibilityState: DocumentVisibilityState;
};

/**
 * The overlay window is always-on-top / all-spaces, so visibilityState is
 * almost always `visible`. Idle + no hover + no bubble is the real stop
 * condition; hidden is only an extra cancel.
 */
export function petSpriteShouldAnimate(input: PetSpriteAnimationInput): boolean {
  if (input.visibilityState === 'hidden') {
    return false;
  }
  if (input.hovered || input.hasTempAction || input.hasBubble) {
    return true;
  }
  return input.state !== 'idle';
}
