/** Host scheduling only; BrowserSession owns eligibility and atomic suspension. */
import type { BrowserSession } from '@piwin/browser';

const IDLE_TTL_MS = 5 * 60_000;
const SWEEP_INTERVAL_MS = 30_000;
const MAX_ELIGIBLE_IDLE_RUNTIMES = 2;

export class BrowserResidencyPool {
  private readonly timer: ReturnType<typeof setInterval>;
  private inFlight: Promise<void> | undefined;
  private disposed = false;

  constructor(private readonly deps: {
    sessions: () => Promise<BrowserSession>[];
    onError: (error: unknown) => void;
    now?: () => number;
  }) {
    this.timer = setInterval(() => { void this.sweep().catch(deps.onError); }, SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  sweep(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.inFlight ??= this.runSweep().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    clearInterval(this.timer);
    await this.inFlight;
  }

  private async runSweep(): Promise<void> {
    const entries = await Promise.allSettled(this.deps.sessions());
    if (this.disposed) return;
    const candidates: Array<{ session: BrowserSession; lastUsedAtMs: number }> = [];
    for (const entry of entries) {
      if (entry.status === 'rejected') { this.deps.onError(entry.reason); continue; }
      try {
        const snapshot = entry.value.residencySnapshot();
        if (snapshot.eligible) candidates.push({ session: entry.value, lastUsedAtMs: snapshot.lastUsedAtMs });
      } catch (error) { this.deps.onError(error); }
    }
    candidates.sort((left, right) => left.lastUsedAtMs - right.lastUsedAtMs);
    const now = (this.deps.now ?? Date.now)();
    const expiredBefore = now - IDLE_TTL_MS;
    let retained = candidates.length;
    for (const candidate of candidates) {
      if (this.disposed) return;
      const expired = candidate.lastUsedAtMs <= expiredBefore;
      if (!expired && retained <= MAX_ELIGIBLE_IDLE_RUNTIMES) continue;
      try {
        const result = await candidate.session.suspendIdle(expired ? expiredBefore : now);
        if (result.suspended || !candidate.session.residencySnapshot().eligible) retained -= 1;
      } catch (error) { this.deps.onError(error); }
    }
  }
}
