/**
 * Reduces the live AgentEvent stream into a PetRuntimeSnapshot and notifies
 * subscribers when the animation state OR the activity text (tool name /
 * permission action / run phase) changes, so the desktop bubble stays in
 * sync even while the animation state stays "running". HostRuntime feeds
 * every session event through reduce(); the desktop subscribes via the
 * pet/state push.
 */
import type { AgentEvent, PetActivityInfo, PetRuntimeSnapshot } from '@piwin/contracts';
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

/**
 * Build the activity info carried in the pushed snapshot. Returns `undefined`
 * when the pet is idle so the desktop can hide the bubble entirely.
 */
function buildActivity(context: PetAgentContext): PetActivityInfo | undefined {
  if (context.state === 'idle') return undefined;
  const activity: PetActivityInfo = {};
  if (context.activeToolName) activity.toolName = context.activeToolName;
  if (context.permissionAction) activity.permissionAction = context.permissionAction;
  if (context.runPhase) activity.phase = context.runPhase;
  return activity;
}

/**
 * A compact signature of the fields that affect the bubble text, used to
 * decide whether to push an update (the animation state alone is not enough
 * — the tool name can change while state stays "running").
 */
function activitySignature(context: PetAgentContext): string {
  return `${context.state}:${context.activeToolName ?? ''}:${context.permissionAction ?? ''}:${context.runPhase ?? ''}`;
}

export function createPetStateStore(options: PetStateStoreOptions): PetStateStore {
  let context = createInitialPetAgentContext();
  let basePet = options.basePet;
  const listeners = new Set<(snapshot: PetStateSnapshot) => void>();

  function snapshot(): PetStateSnapshot {
    const activity = buildActivity(context);
    return {
      pet: { ...basePet, state: context.state, ...(activity ? { activity } : {}) },
      context,
    };
  }

  function notifyIfChanged(prevSig: string): void {
    if (activitySignature(context) === prevSig) return;
    const snap = snapshot();
    for (const listener of listeners) listener(snap);
  }

  return {
    reduce(event: AgentEvent): void {
      const prevSig = activitySignature(context);
      context = reducePetAgentContext(context, event);
      notifyIfChanged(prevSig);
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
