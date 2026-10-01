/**
 * Soft size budget for the turn-change object store.
 *
 * Undo data must never stop the user's work: when the store is over budget,
 * new bytes are simply not kept (the object store returns their hash without
 * writing), and capture marks the turn `storage-full` so it is shown as not
 * undoable instead of failing later. Reusing bytes already stored is always
 * free. The retention sweep sets the real on-disk total; between sweeps the
 * budget adds what it admitted.
 */

export const DEFAULT_TURN_CHANGE_STORAGE_BUDGET_BYTES = 5 * 1024 * 1024 * 1024;

/** Hashes remembered as "not stored"; only needed until their capture finishes. */
const MAX_DROPPED_TRACKED = 50_000;

export type TurnChangeStorageBudget = {
  readonly limitBytes: number;
  /** Bytes believed to be on disk; null until the first sweep measures it. */
  usedBytes(): number | null;
  isFull(): boolean;
  /** Reserve room for a new object; false means do not store it. */
  admit(byteLength: number): boolean;
  noteDropped(sha256: string): void;
  wasDropped(sha256: string): boolean;
  /** The sweep's measured total after cleanup. */
  setMeasuredBytes(bytes: number): void;
};

export function createTurnChangeStorageBudget(options: {
  limitBytes?: number;
  /** Called the first time an admit would cross the limit (e.g. run a sweep). */
  onFull?: () => void;
} = {}): TurnChangeStorageBudget {
  const limitBytes = options.limitBytes ?? DEFAULT_TURN_CHANGE_STORAGE_BUDGET_BYTES;
  let used: number | null = null;
  let full = false;
  const dropped = new Set<string>();

  const markFull = (): void => {
    if (full) return;
    full = true;
    options.onFull?.();
  };

  return {
    limitBytes,
    usedBytes: () => used,
    isFull: () => full,
    admit(byteLength) {
      if (full) return false;
      // Unmeasured yet: admit and count from zero; the first sweep corrects it.
      const next = (used ?? 0) + byteLength;
      if (next > limitBytes) {
        markFull();
        return false;
      }
      used = next;
      return true;
    },
    noteDropped(sha256) {
      if (dropped.size >= MAX_DROPPED_TRACKED) {
        const oldest = dropped.values().next().value;
        if (oldest !== undefined) dropped.delete(oldest);
      }
      dropped.add(sha256);
    },
    wasDropped: (sha256) => dropped.has(sha256),
    setMeasuredBytes(bytes) {
      used = bytes;
      full = bytes >= limitBytes;
    },
  };
}
