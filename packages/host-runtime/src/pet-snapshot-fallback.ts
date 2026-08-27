import type { PetRuntimeSnapshot } from '@piwin/contracts';

export function fallbackPetSnapshot(): PetRuntimeSnapshot {
  return {
    petId: 'piwin-default',
    displayName: 'Piwin Default',
    spritesheetAbsolutePath: '',
    state: 'idle',
    fps: 6,
    cellWidth: 48,
    cellHeight: 52,
    cols: 8,
    rows: 9,
    stateRows: {
      idle: 0,
      running: 1,
      waiting: 2,
      failed: 3,
      waving: 4,
      jumping: 5,
      review: 6,
    },
  };
}
