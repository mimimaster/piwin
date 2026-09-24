import type { HostPush, HostPushBatchFrame, HostServerMessage } from '@piwin/contracts';
import { isHostPushBatchFrame, isSafeSequence } from './host-push-frame.js';
import { HostClientState, type HostClientListener } from './host-client-state.js';

/**
 * A push batch arrived whose `afterSeq` is beyond the applied cursor: frames
 * between the cursor and the batch never reached the WebView. Detected on the
 * local Stage 1 bridge too, where a dropped JSONL line otherwise heals over
 * silently (ADR 0038 §9).
 */
export type HostPushSequenceGap = {
  hostInstanceId: string;
  /** First sequence number we can no longer account for. */
  missedFromSeq: number;
  /** First sequence number this batch proved arrived. */
  receivedFromSeq: number;
};

export type HostSequenceGapHandler = (gap: HostPushSequenceGap) => void;

/**
 * Push fan-out: broadcast Host pushes to UI subscribers and apply inbound
 * batches as one cursor transaction (ADR 0038 §9).
 */
export abstract class HostClientPushLayer extends HostClientState {
  private sequenceGapHandler: HostSequenceGapHandler | null = null;

  isReady(): boolean {
    return this.ready;
  }

  /**
   * Register (or clear) the push-sequence gap handler. Gaps mean pushes were
   * lost in transit; the handler is expected to resync from Host authority.
   */
  registerSequenceGapHandler(handler: HostSequenceGapHandler | null): void {
    this.sequenceGapHandler = handler;
  }

  subscribe(listener: HostClientListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  protected emit(message: HostPush | HostServerMessage): void {
    for (const listener of this.listeners) {
      listener(message);
    }
  }

  protected emitBatch(batch: HostPushBatchFrame): void {
    if (!isHostPushBatchFrame(batch)) {
      console.warn('[host] ignoring malformed push batch');
      return;
    }

    const hostChanged = this.hostInstanceId !== batch.hostInstanceId;
    const previousSeq = hostChanged ? 0 : this.lastHostSeq;
    if (batch.throughSeq < previousSeq) {
      console.warn('[host] ignoring stale push batch', {
        hostInstanceId: batch.hostInstanceId,
        previousSeq,
        throughSeq: batch.throughSeq,
      });
      return;
    }

    if (!hostChanged && previousSeq > 0 && batch.afterSeq > previousSeq) {
      // Everything in the hole is gone as live events; reconcile reloads the
      // transcript. Keep a trace so a missing tool row can be tied to a gap.
      console.warn('[host] push sequence gap', {
        hostInstanceId: batch.hostInstanceId,
        missedFromSeq: previousSeq + 1,
        receivedFromSeq: batch.afterSeq + 1,
      });
      this.sequenceGapHandler?.({
        hostInstanceId: batch.hostInstanceId,
        missedFromSeq: previousSeq + 1,
        receivedFromSeq: batch.afterSeq + 1,
      });
    }

    // Advance the cursor only after every contained push has been offered to
    // subscribers. If a subscriber throws, this transaction remains unacked.
    for (const item of batch.items) {
      if (item.seq <= previousSeq) {
        continue;
      }
      if (item.push.type === 'host/status') {
        this.ready = item.push.ready;
        this.mode = item.push.mode;
      }
      this.emit(item.push);
    }
    this.hostInstanceId = batch.hostInstanceId;
    this.lastHostSeq = batch.throughSeq;
  }

  /**
   * `currentSeq` is the Host's cursor fence, not the last item this client's
   * subscription could see. Filtered replay tails skip records; live delivery
   * then resumes at afterSeq=currentSeq. Adopt the fence or emitBatch treats
   * the next valid batch as a hole and kicks reconcile/replay.
   */
  protected adoptHostCursorFence(currentSeq: number): void {
    if (!isSafeSequence(currentSeq) || currentSeq <= this.lastHostSeq) {
      return;
    }
    this.lastHostSeq = currentSeq;
  }
}
