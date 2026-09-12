/**
 * Per-lineage mutex plus predecessor claim for reviewed continue.
 * Prevents two overlapping continues from both accepting as the next generation
 * when scheme maxConcurrency is greater than 1.
 */
export type ReviewedContinueGate = {
  acquire(key: string): Promise<() => void>;
  claimPredecessor(key: string): boolean;
  releasePredecessor(key: string): void;
};

export function createReviewedContinueGate(): ReviewedContinueGate {
  const tails = new Map<string, Promise<void>>();
  const claimedPredecessors = new Set<string>();
  return {
    async acquire(key) {
      let releaseHeld = (): void => {};
      const held = new Promise<void>((resolve) => {
        releaseHeld = resolve;
      });
      const previous = tails.get(key) ?? Promise.resolve();
      tails.set(
        key,
        previous.then(
          () => held,
          () => held,
        ),
      );
      try {
        await previous;
      } catch {
        // Previous holder released after a failure; this waiter still owns the slot.
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        releaseHeld();
      };
    },
    claimPredecessor(key) {
      if (claimedPredecessors.has(key)) return false;
      claimedPredecessors.add(key);
      return true;
    },
    releasePredecessor(key) {
      claimedPredecessors.delete(key);
    },
  };
}
