/**
 * Cross-window pet state for the cosmetic overlay.
 *
 * The overlay has no Host authority (architecture: dedicated WebContent,
 * no sidecar). The main window is the only place that may call pet/get-active;
 * it publishes snapshots, and the overlay asks for the latest copy on boot.
 */
import type { PetRuntimeSnapshot } from '@piwin/contracts';

export const PET_OVERLAY_STATE_EVENT = 'pet-state-push';
export const PET_OVERLAY_STATE_REQUEST_EVENT = 'pet-overlay-request-state';

export type PetOverlayStatePayload = {
  pet: PetRuntimeSnapshot;
};

export type PetOverlayStateRelay = {
  publish(pet: PetRuntimeSnapshot | null): void;
  handleRequest(): void;
  getLatest(): PetRuntimeSnapshot | null;
};

export function createPetOverlayStateRelay(options: {
  emitState: (pet: PetRuntimeSnapshot) => void;
}): PetOverlayStateRelay {
  let latest: PetRuntimeSnapshot | null = null;
  return {
    publish(pet) {
      latest = pet;
      if (pet) options.emitState(pet);
    },
    handleRequest() {
      if (latest) options.emitState(latest);
    },
    getLatest() {
      return latest;
    },
  };
}

export async function emitPetOverlayState(pet: PetRuntimeSnapshot): Promise<void> {
  try {
    const { emit } = await import('@tauri-apps/api/event');
    const payload: PetOverlayStatePayload = { pet };
    await emit(PET_OVERLAY_STATE_EVENT, payload);
  } catch {
    // not in Tauri / overlay not open
  }
}

export async function requestPetOverlayState(): Promise<void> {
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(PET_OVERLAY_STATE_REQUEST_EVENT);
  } catch {
    // not in Tauri
  }
}

export async function listenPetOverlayState(
  onPet: (pet: PetRuntimeSnapshot) => void,
): Promise<() => void> {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen<PetOverlayStatePayload>(PET_OVERLAY_STATE_EVENT, (event) => {
      if (event.payload?.pet) onPet(event.payload.pet);
    });
  } catch {
    return () => {};
  }
}

export async function listenPetOverlayStateRequest(onRequest: () => void): Promise<() => void> {
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen(PET_OVERLAY_STATE_REQUEST_EVENT, () => {
      onRequest();
    });
  } catch {
    return () => {};
  }
}

const defaultRelay = createPetOverlayStateRelay({
  emitState: (pet) => {
    void emitPetOverlayState(pet);
  },
});

/** Main window: remember the active pet and push it to the overlay. */
export function publishPetOverlayState(pet: PetRuntimeSnapshot | null): void {
  defaultRelay.publish(pet);
}

/**
 * Main window: answer overlay boot requests with the last published pet.
 * Install before creating the overlay window so the first request is not lost.
 */
export async function installPetOverlayStateRelay(): Promise<() => void> {
  return listenPetOverlayStateRequest(() => {
    defaultRelay.handleRequest();
  });
}
