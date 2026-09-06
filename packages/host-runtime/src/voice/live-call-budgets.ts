export const LIVE_START_WINDOW_MS = 30_000;
export const LIVE_START_MAX = 5;
export const LIVE_RECONNECT_WINDOW_MS = 10_000;
export const LIVE_RECONNECT_MAX = 2;

export class SlidingWindowBudget {
  private readonly stamps: number[] = [];

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
  ) {}

  tryConsume(now = Date.now()): boolean {
    this.prune(now);
    if (this.stamps.length >= this.max) return false;
    this.stamps.push(now);
    return true;
  }

  remaining(now = Date.now()): number {
    this.prune(now);
    return Math.max(0, this.max - this.stamps.length);
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.stamps[0] !== undefined && this.stamps[0] <= cutoff) {
      this.stamps.shift();
    }
  }

  reset(): void {
    this.stamps.length = 0;
  }
}

export function createLiveStartBudget(): SlidingWindowBudget {
  return new SlidingWindowBudget(LIVE_START_WINDOW_MS, LIVE_START_MAX);
}

export function createLiveReconnectBudget(): SlidingWindowBudget {
  return new SlidingWindowBudget(LIVE_RECONNECT_WINDOW_MS, LIVE_RECONNECT_MAX);
}
