import { REMOTE_CHANNEL_MAX_FRAME_BYTES } from '@piwin/contracts';
import type { RelayUserLimits, RelayUserRecord } from './relay-user-registry.js';

export type RelayLimits = {
  maxFrameBytes: number;
  defaultMaxHosts: number;
  defaultMaxPeersPerHost: number;
  /** A socket whose unsent backlog passes this is closed; replay recovers it. */
  maxSendBufferBytes: number;
  /** New WebSocket upgrades per client IP per window. */
  connectionsPerIpPerWindow: number;
  rateWindowMs: number;
  hostAuthTimeoutMs: number;
  pingIntervalMs: number;
};

export const DEFAULT_RELAY_LIMITS: RelayLimits = {
  maxFrameBytes: REMOTE_CHANNEL_MAX_FRAME_BYTES,
  defaultMaxHosts: 8,
  defaultMaxPeersPerHost: 32,
  maxSendBufferBytes: 4 * 1024 * 1024,
  connectionsPerIpPerWindow: 60,
  rateWindowMs: 60_000,
  hostAuthTimeoutMs: 10_000,
  pingIntervalMs: 25_000,
};

export function effectiveUserLimits(limits: RelayLimits, user: RelayUserRecord): RelayUserLimits {
  return {
    maxHosts: user.limits?.maxHosts ?? limits.defaultMaxHosts,
    maxPeersPerHost: user.limits?.maxPeersPerHost ?? limits.defaultMaxPeersPerHost,
  };
}

/** Fixed-window counter per key (client IP). Old windows are dropped lazily. */
export class RelayRateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  public constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  public tryAcquire(key: string): boolean {
    const now = this.now();
    const window = this.windows.get(key);
    if (window === undefined || now - window.startedAt >= this.windowMs) {
      this.windows.set(key, { startedAt: now, count: 1 });
      this.prune(now);
      return true;
    }
    if (window.count >= this.maxPerWindow) {
      return false;
    }
    window.count += 1;
    return true;
  }

  private prune(now: number): void {
    if (this.windows.size < 10_000) return;
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= this.windowMs) this.windows.delete(key);
    }
  }
}
