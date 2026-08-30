export const LIVE_RECONNECT_WINDOW_MS = 10_000;
export const LIVE_RECONNECT_MAX = 2;

export class LiveReconnectBudget {
  private readonly stamps: number[] = [];

  tryConsume(now = Date.now()): boolean {
    const cutoff = now - LIVE_RECONNECT_WINDOW_MS;
    while (this.stamps[0] !== undefined && this.stamps[0] <= cutoff) {
      this.stamps.shift();
    }
    if (this.stamps.length >= LIVE_RECONNECT_MAX) return false;
    this.stamps.push(now);
    return true;
  }
}
