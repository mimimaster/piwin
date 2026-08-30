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
    const cutoff = now - this.windowMs;
    while (this.stamps[0] !== undefined && this.stamps[0] <= cutoff) {
      this.stamps.shift();
    }
    if (this.stamps.length >= this.max) return false;
    this.stamps.push(now);
    return true;
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
