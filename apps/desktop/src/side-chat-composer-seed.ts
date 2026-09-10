import type { PromptContextRef } from '@piwin/contracts';

export type SideChatComposerSeed = {
  refs: PromptContextRef[];
  sideChatSessionId?: string;
};

type SeedListener = (seed: SideChatComposerSeed) => void;

let queued: SideChatComposerSeed | null = null;
const listeners = new Set<SeedListener>();

export function publishSideChatComposerSeed(seed: SideChatComposerSeed): void {
  queued = seed;
  for (const listener of listeners) {
    listener(seed);
  }
}

export function takeSideChatComposerSeed(): SideChatComposerSeed | null {
  const next = queued;
  queued = null;
  return next;
}

export function subscribeSideChatComposerSeed(listener: SeedListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetSideChatComposerSeedForTests(): void {
  queued = null;
  listeners.clear();
}
