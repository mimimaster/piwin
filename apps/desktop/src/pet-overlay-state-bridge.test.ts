import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PET_STATE_ROWS, type PetRuntimeSnapshot } from '@piwin/contracts';
import { createPetOverlayStateRelay } from './pet-overlay-state-bridge.js';

function createPet(petId = 'clawd'): PetRuntimeSnapshot {
  return {
    petId,
    displayName: 'Clawd',
    spritesheetAbsolutePath: '/Users/me/.piwin/pets/clawd/spritesheet.webp',
    state: 'idle',
    fps: 6,
    cellWidth: 192,
    cellHeight: 208,
    cols: 8,
    rows: 9,
    stateRows: { ...DEFAULT_PET_STATE_ROWS },
  };
}

describe('createPetOverlayStateRelay', () => {
  it('does not reply to an overlay request before the main window has a pet', () => {
    const emitState = vi.fn();
    const relay = createPetOverlayStateRelay({ emitState });

    relay.handleRequest();

    expect(emitState).not.toHaveBeenCalled();
  });

  it('replies with the last published pet when the overlay asks after bootstrap', () => {
    const emitState = vi.fn();
    const relay = createPetOverlayStateRelay({ emitState });
    const pet = createPet();

    relay.publish(pet);
    expect(emitState).toHaveBeenCalledTimes(1);
    expect(emitState).toHaveBeenCalledWith(pet);

    emitState.mockClear();
    relay.handleRequest();

    expect(emitState).toHaveBeenCalledTimes(1);
    expect(emitState).toHaveBeenCalledWith(pet);
  });

  it('replies with the updated pet after the active companion changes', () => {
    const emitState = vi.fn();
    const relay = createPetOverlayStateRelay({ emitState });
    relay.publish(createPet('clawd'));
    const next = createPet('piwin-default');
    relay.publish(next);
    emitState.mockClear();

    relay.handleRequest();

    expect(emitState).toHaveBeenCalledWith(next);
  });
});
