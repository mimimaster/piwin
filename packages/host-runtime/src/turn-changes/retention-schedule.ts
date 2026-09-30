/**
 * Periodic turn-change retention: expire old turns and delete unreferenced
 * object bytes (see @piwin/git retention.ts for the rules).
 *
 * Runs once shortly after start, then on a fixed interval. Sweeps never
 * overlap, and the timer is unref'd so it never keeps the Host alive.
 */
import {
  sweepTurnChangeRetention,
  type TurnChangeRetentionResult,
  type TurnChangeStore,
} from '@piwin/git';

export const DEFAULT_TURN_CHANGE_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type TurnChangeRetentionSchedule = {
  /** Run one sweep now (skipped and resolved with null if one is already running or stopped). */
  runNow(): Promise<TurnChangeRetentionResult | null>;
  stop(): void;
};

export function scheduleTurnChangeRetention(input: {
  store: TurnChangeStore;
  rootDir: string;
  intervalMs?: number;
  /** Delay before the first sweep, so startup work finishes first. */
  initialDelayMs?: number;
  onResult?: (result: TurnChangeRetentionResult) => void;
  onError: (error: unknown) => void;
}): TurnChangeRetentionSchedule {
  let stopped = false;
  let running: Promise<TurnChangeRetentionResult | null> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const runNow = (): Promise<TurnChangeRetentionResult | null> => {
    if (stopped) return Promise.resolve(null);
    if (running) return running.then(() => null);
    running = sweepTurnChangeRetention({ store: input.store, rootDir: input.rootDir })
      .then((result) => {
        input.onResult?.(result);
        return result;
      })
      .catch((error: unknown) => {
        // A failed sweep only delays cleanup; the next interval retries.
        input.onError(error);
        return null;
      })
      .finally(() => {
        running = null;
      });
    return running;
  };

  const arm = (delayMs: number): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void runNow().finally(() => arm(input.intervalMs ?? DEFAULT_TURN_CHANGE_RETENTION_INTERVAL_MS));
    }, delayMs);
    timer.unref?.();
  };
  arm(input.initialDelayMs ?? 60_000);

  return {
    runNow,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
