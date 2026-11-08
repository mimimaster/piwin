import type { HostPushBatchFrame, HostPushFrame } from '@piwin/contracts';
import { LIVE_SUBSCRIPTION_MAX_SESSION_IDS } from '@piwin/contracts';
import {
  formatHostEgressCloseDetail,
  type HostEgressChannel,
  type HostEgressCloseDetail,
  type HostEgressHub,
} from '@piwin/host-server';
import type { LiveSessionFilter } from '@piwin/host-transport';

/**
 * Local Desktop egress for `host serve` (ADR 0038 §7, stdio addendum).
 *
 * A WebSocket client whose channel is closed reconnects with its cursor and
 * replays. The stdio sidecar has no reconnect: its one pipe stays open for the
 * Host lifetime. Closing the local channel without re-attaching therefore made
 * Desktop permanently deaf to every push while commands kept working (the
 * 2026-09-28 oversized `job/log` incident).
 *
 * On close we re-attach a fresh channel at the Hub's current sequence. The
 * next batch then carries `afterSeq` beyond Desktop's applied cursor, which is
 * exactly the gap Desktop already reconciles from Host authority (transcript
 * tail, foreground Run, pending permissions). `onReattached` lets the caller
 * ingest a harmless control push so that gap surfaces immediately even when
 * no Run is streaming.
 */
export type SidecarLocalEgressOptions = {
  egressHub: HostEgressHub;
  clientId: string;
  canSend: () => boolean;
  send: (message: HostPushFrame | HostPushBatchFrame) => void;
  maxQueueBytes: number;
  maxQueueItems: number;
  log: (line: string) => void;
  onReattached?: () => void;
  /** Defer re-attach until the Hub has retired the closed channel. */
  scheduleReattach?: (callback: () => void) => void;
  /**
   * Optional frame built for newly subscribed session ids and sent (via
   * `send`) before the live filter swap — the same fence the remote
   * `applyLiveSubscriptionUpdate` uses. The local path normally omits this:
   * Desktop hydrates from the replay tail instead of a hydration frame.
   */
  hydration?: (sessionIds: string[], fenceSeq: number) => Promise<HostPushFrame | HostPushBatchFrame | null>;
};

export type SidecarLocalEgress = {
  flushNow: () => void;
  getReattachCount: () => number;
  dispose: () => void;
  /**
   * Apply a `client/subscriptions` interest set, mirroring the remote
   * `applyLiveSubscriptionUpdate` ordering: pause → fence → hydration →
   * filter swap → replay tail → advance cursor → applied. The confirmed
   * filter is re-applied after every channel re-attach.
   */
  applySubscriptions: (
    subscriptions: { sessionIds?: string[] },
    revision: number,
  ) => Promise<{ fenceSeq: number }>;
};

/** Dedupe + bound a live interest set, mirroring the remote normalizer. */
function normalizeLiveSessionIds(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const sessionId of value) {
    if (typeof sessionId !== 'string' || sessionId.trim().length === 0 || seen.has(sessionId)) {
      continue;
    }
    seen.add(sessionId);
    result.push(sessionId);
    if (result.length >= LIVE_SUBSCRIPTION_MAX_SESSION_IDS) break;
  }
  return result;
}

export function attachSidecarLocalEgress(options: SidecarLocalEgressOptions): SidecarLocalEgress {
  const scheduleReattach = options.scheduleReattach ?? ((callback) => queueMicrotask(callback));
  let disposed = false;
  let reattachCount = 0;
  let channel: HostEgressChannel | undefined;
  /** Last confirmed interest set; re-applied to every channel `open` creates. */
  let confirmedFilter: LiveSessionFilter = 'all';
  /** Serializes applies — overlapping pause/filter/replay would interleave. */
  let applyQueue: Promise<void> = Promise.resolve();

  const handleClose = (reason: string, detail?: HostEgressCloseDetail): void => {
    const suffix = detail === undefined ? '' : ` ${formatHostEgressCloseDetail(detail)}`;
    options.log(`[piwin host serve] local egress closed: ${reason}${suffix}`);
    channel = undefined;
    if (disposed) return;
    // The Hub removes the closed client only after this callback returns.
    scheduleReattach(() => {
      if (disposed || channel !== undefined) return;
      try {
        channel = open(options.egressHub.getCurrentSeq());
      } catch (error) {
        options.log(
          `[piwin host serve] local egress re-attach failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
        return;
      }
      reattachCount += 1;
      options.log(
        `[piwin host serve] local egress re-attached at seq=${options.egressHub.getCurrentSeq()} (count=${reattachCount}); Desktop reconciles the gap`,
      );
      options.onReattached?.();
    });
  };

  const open = (initialSeq: number): HostEgressChannel =>
    options.egressHub.addClient({
      id: options.clientId,
      initialSeq,
      supportsBatch: true,
      canSend: options.canSend,
      maxQueueBytes: options.maxQueueBytes,
      maxQueueItems: options.maxQueueItems,
      send: options.send,
      onSlowConsumer: handleClose,
      liveFilter: confirmedFilter,
    });

  channel = open(0);

  return {
    flushNow: () => channel?.flushNow(),
    getReattachCount: () => reattachCount,
    dispose: () => {
      disposed = true;
      channel = undefined;
    },
    applySubscriptions: (subscriptions, revision) => {
      const applied = applyQueue.then(async () => {
        const nextIds = normalizeLiveSessionIds(subscriptions.sessionIds);
        const previous = confirmedFilter === 'all' ? undefined : confirmedFilter.sessionIds;
        const added =
          previous === undefined ? [] : nextIds.filter((sessionId) => !previous.has(sessionId));
        // Channel may close mid-apply (slow-consumer kill or re-attach): mutations
        // must run against the CURRENT channel, not the one captured at start.
        channel?.setPaused(true);
        try {
          const fenceSeq = options.egressHub.getCurrentSeq();
          if (added.length > 0 && options.hydration !== undefined) {
            const frame = await options.hydration(added, fenceSeq);
            if (frame !== null) {
              // Direct send, before the filter swap — same order as remote.
              options.send(frame);
            }
          }
          // Confirm the filter before mutating the live channel: a re-attach
          // racing this await opens with the new filter already applied.
          const nextFilter: LiveSessionFilter = { sessionIds: new Set(nextIds) };
          confirmedFilter = nextFilter;
          const liveChannel = channel;
          liveChannel?.setLiveFilter(nextFilter);
          // Replay from the channel's last SENT seq, not the fence: queued
          // pre-fence records were never delivered and advanceCursor below
          // would drop them unsent. The remote path can afford fence replay
          // only because its hydration snapshot covers the same window; the
          // local path has no hydration, so every un-sent record must be
          // re-evaluated under the NEW filter.
          const tail = options.egressHub.listReplay(
            liveChannel?.getLastSentSeq() ?? fenceSeq,
          );
          liveChannel?.sendReplay(tail.records);
          liveChannel?.advanceCursor(tail.currentSeq);
          options.log(
            `[piwin host serve] local subscriptions applied rev=${revision} sessions=${nextIds.length} fenceSeq=${fenceSeq}`,
          );
          return { fenceSeq };
        } finally {
          channel?.setPaused(false);
        }
      });
      // Keep the queue moving after a rejection — a failed apply must not
      // wedge every later subscription update.
      applyQueue = applied.then(
        () => undefined,
        () => undefined,
      );
      return applied;
    },
  };
}
