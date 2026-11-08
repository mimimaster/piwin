import type { HostSubscriptionsAppliedFrame } from '@piwin/contracts';

/**
 * Live-interest ("subscriptions") controller for the local sidecar transport.
 *
 * The remote path talks `client/subscriptions` over the HostClient WebSocket;
 * the local JSONL pipe has no socket layer, so the frame goes through the
 * Rust bridge (`host_update_subscriptions`) which replies with
 * `subscriptions/applied`. A restarted sidecar forgets the confirmed filter,
 * so the last desired set is resent whenever the transport reports
 * `host/status` ready after having been not-ready.
 */
export type HostSubscriptionState = 'idle' | 'awaiting-hello' | 'applied';

const DEFAULT_SUBSCRIPTION_TIMEOUT_MS = 15_000;

export class LocalSubscriptionController {
  private desiredIds: readonly string[] = [];
  /** True once the UI declared any interest set — an empty set still counts
   *  (it narrows the server filter, which a restart resets to 'all'). */
  private hasDesired = false;
  private revision = 0;
  private appliedSignature: string | null = null;
  private hostReady = false;
  private state: HostSubscriptionState = 'idle';
  private disposed = false;
  /** Chains writes so a later update cannot be overtaken by an in-flight one. */
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly send: (
      sessionIds: readonly string[],
      revision: number,
      timeoutMs: number,
    ) => Promise<HostSubscriptionsAppliedFrame>,
  ) {}

  getSubscriptionState(): HostSubscriptionState {
    return this.state;
  }

  /**
   * Record a new desired interest set. Resolves after the frame is applied,
   * or immediately when the host is not ready — the ready edge re-sends.
   */
  update(sessionIds: readonly string[]): Promise<void> {
    this.desiredIds = sessionIds.slice();
    this.hasDesired = true;
    if (!this.hostReady) {
      this.state = 'awaiting-hello';
      return Promise.resolve();
    }
    return this.enqueue();
  }

  /**
   * Track `host/status` readiness. A restart drops the confirmed server-side
   * filter, so the first ready edge after not-ready re-sends the desired set
   * even when it is unchanged.
   */
  noteHostReady(ready: boolean): void {
    const wasReady = this.hostReady;
    this.hostReady = ready;
    if (ready && !wasReady) {
      this.appliedSignature = null;
      this.enqueueIfPending();
    }
  }

  /** Forget all state (dispose); next update starts a fresh revision chain. */
  reset(): void {
    this.disposed = true;
    this.desiredIds = [];
    this.hasDesired = false;
    this.appliedSignature = null;
    this.hostReady = false;
    this.state = 'idle';
  }

  private enqueueIfPending(): void {
    if (!this.hasDesired) {
      return;
    }
    void this.enqueue().catch((error: unknown) => {
      console.warn('Failed to restore live subscriptions after Host ready.', error);
    });
  }

  private enqueue(): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    const signature = signatureOf(this.desiredIds);
    if (signature === this.appliedSignature) {
      return Promise.resolve();
    }
    this.state = 'awaiting-hello';
    const run = this.inFlight.then(async () => {
      // Re-check desired inside the chain turn: a later update may have
      // changed desiredIds while an earlier send was in flight. Capture the
      // signature for the set actually being sent so appliedSignature never
      // confirms a payload the server did not receive.
      if (this.disposed) {
        return;
      }
      const sentSignature = signatureOf(this.desiredIds);
      if (sentSignature === this.appliedSignature) {
        return;
      }
      this.revision += 1;
      await this.send(this.desiredIds, this.revision, DEFAULT_SUBSCRIPTION_TIMEOUT_MS);
      this.appliedSignature = sentSignature;
      this.state = 'applied';
    });
    // Serialize sends; a rejected in-flight update must not poison the queue.
    this.inFlight = run.catch(() => undefined);
    return run;
  }
}

function signatureOf(sessionIds: readonly string[]): string {
  // NUL join: ids are Host session ids and never contain NUL; an empty join
  // would collide ['ab','c'] with ['a','bc'].
  return sessionIds.join('\u0000');
}
