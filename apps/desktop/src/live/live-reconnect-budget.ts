export const LIVE_RECONNECT_WINDOW_MS = 10_000;
export const LIVE_RECONNECT_MAX = 2;

export class LiveReconnectBudget {
  private readonly stamps: number[] = [];

  tryConsume(now = Date.now()): boolean {
    this.prune(now);
    if (this.stamps.length >= LIVE_RECONNECT_MAX) return false;
    this.stamps.push(now);
    return true;
  }

  remaining(now = Date.now()): number {
    this.prune(now);
    return Math.max(0, LIVE_RECONNECT_MAX - this.stamps.length);
  }

  private prune(now: number): void {
    const cutoff = now - LIVE_RECONNECT_WINDOW_MS;
    while (this.stamps[0] !== undefined && this.stamps[0] <= cutoff) {
      this.stamps.shift();
    }
  }
}
