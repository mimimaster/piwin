/**
 * Reduces the live AgentEvent stream into a PetRuntimeSnapshot and notifies
 * subscribers only when the animation state actually changes. HostRuntime
 * feeds every session event through reduce(); the desktop subscribes via
 * the pet/state push.
 */
import type { AgentEvent, PetAnimationState, PetRuntimeSnapshot } from '@piwin/contracts';
import {
  createInitialPetAgentContext,
  reducePetAgentContext,
  type PetAgentContext,
} from '@piwin/pet';

export type PetStateSnapshot = {
  pet: PetRuntimeSnapshot;
  context: PetAgentContext;
};

export type PetStateStoreOptions = {
  basePet: PetRuntimeSnapshot;
};

export type PetStateStore = {
  reduce(event: AgentEvent): void;
  snapshot(): PetStateSnapshot;
  setBase(pet: PetRuntimeSnapshot): void;
  subscribe(listener: (snapshot: PetStateSnapshot) => void): () => void;
};

export function createPetStateStore(options: PetStateStoreOptions): PetStateStore {
  let context = createInitialPetAgentContext();
  let basePet = options.basePet;
  const listeners = new Set<(snapshot: PetStateSnapshot) => void>();

  function snapshot(): PetStateSnapshot {
    return {
      pet: { ...basePet, state: context.state },
      context,
    };
  }

  function notifyIfChanged(prevState: PetAnimationState): void {
    if (context.state === prevState) return;
    const snap = snapshot();
    for (const listener of listeners) listener(snap);
  }

  return {
    reduce(event: AgentEvent): void {
      const prevState = context.state;
      context = reducePetAgentContext(context, event);
      notifyIfChanged(prevState);
    },
    snapshot,
    setBase(pet: PetRuntimeSnapshot): void {
      basePet = pet;
    },
    subscribe(listener: (snapshot: PetStateSnapshot) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
