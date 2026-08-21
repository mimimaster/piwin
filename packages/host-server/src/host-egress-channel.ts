import type {
  HostPushBatchFrame,
  HostPushFrame,
  HostSequencedPush,
  HostWireMessage,
} from '@piwin/contracts';
import type { HostPushPolicy } from '@piwin/host-transport';
import type { HostEgressClientStats } from './host-egress-metrics.js';

export type HostEgressRecord = {
  sequence: HostSequencedPush;
  policy: HostPushPolicy;
  encodedBytes: number;
};

export type HostEgressChannelOptions = {
  id: string;
  hostInstanceId: string;
  initialSeq?: number;
  supportsBatch: boolean;
  targetBatchBytes?: number;
  maxBatchItems?: number;
  maxQueueBytes?: number;
  maxQueueItems?: number;
  maxFrameBytes?: number;
  send: (message: HostWireMessage) => void;
  canSend?: () => boolean;
  onSlowConsumer?: (reason: string) => void;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
};

const DEFAULT_TARGET_BATCH_BYTES = 128 * 1024;
const DEFAULT_MAX_BATCH_ITEMS = 128;
const DEFAULT_MAX_QUEUE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_QUEUE_ITEMS = 2_048;
const DEFAULT_MAX_FRAME_BYTES = 1 * 1024 * 1024;

/** One bounded priority-aware channel for one Host client. */
export class HostEgressChannel {
  private readonly id: string;
  private readonly hostInstanceId: string;
  private readonly supportsBatch: boolean;
  private readonly targetBatchBytes: number;
  private readonly maxBatchItems: number;
  private readonly maxQueueBytes: number;
  private readonly maxQueueItems: number;
  private readonly maxFrameBytes: number;
  private readonly send: (message: HostWireMessage) => void;
  private readonly canSend: () => boolean;
  private readonly onSlowConsumer: (reason: string) => void;
  private readonly schedule: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  private dataQueue: Array<HostEgressRecord & { keyToken?: string }> = [];
  private controlQueue: HostEgressRecord[] = [];
  private queuedBytes = 0;
  private lastSentSeq: number;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private drainTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private paused = false;
  private highWaterItems = 0;
  private highWaterBytes = 0;
  private sentFrames = 0;
  private sentItems = 0;
  private sentBytes = 0;
  private replayFrames = 0;
  private replayItems = 0;
  private replayBytes = 0;
  private projectionReplacements = 0;
  private diagnosticsEvicted = 0;
  private oversizedItems = 0;
  private slowConsumerDisconnects = 0;

  public constructor(options: HostEgressChannelOptions) {
    this.id = options.id;
    this.hostInstanceId = options.hostInstanceId;
    this.supportsBatch = options.supportsBatch;
    this.targetBatchBytes = options.targetBatchBytes ?? DEFAULT_TARGET_BATCH_BYTES;
    this.maxBatchItems = options.maxBatchItems ?? DEFAULT_MAX_BATCH_ITEMS;
    this.maxQueueBytes = options.maxQueueBytes ?? DEFAULT_MAX_QUEUE_BYTES;
    this.maxQueueItems = options.maxQueueItems ?? DEFAULT_MAX_QUEUE_ITEMS;
    this.maxFrameBytes = options.maxFrameBytes ?? DEFAULT_MAX_FRAME_BYTES;
    this.send = options.send;
    this.canSend = options.canSend ?? (() => true);
    this.onSlowConsumer = options.onSlowConsumer ?? (() => undefined);
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.lastSentSeq = options.initialSeq ?? 0;
    if (
      this.targetBatchBytes <= 0 ||
      this.maxBatchItems <= 0 ||
      this.maxQueueBytes <= 0 ||
      this.maxQueueItems <= 0 ||
      this.maxFrameBytes <= 0
    ) {
      throw new Error('Host egress channel budgets must be greater than zero');
    }
  }

  public getId(): string {
    return this.id;
  }

  public getLastSentSeq(): number {
    return this.lastSentSeq;
  }

  /** Mark a hydration snapshot cursor as applied before post-snapshot replay. */
  public advanceCursor(sequence: number): void {
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new Error('Host egress cursor must be a non-negative safe integer');
    }
    // Allow rewind after Host restart / journal reset. A throw here would tear
    // the socket after hello already succeeded (future-cursor reconnects).
    this.lastSentSeq = sequence;
    this.dataQueue = this.dataQueue.filter((record) => record.sequence.seq > sequence);
    this.controlQueue = this.controlQueue.filter((record) => record.sequence.seq > sequence);
    this.queuedBytes = [...this.dataQueue, ...this.controlQueue].reduce(
      (total, record) => total + record.encodedBytes,
      0,
    );
  }

  public getQueueSize(): { items: number; bytes: number } {
    return {
      items: this.dataQueue.length + this.controlQueue.length,
      bytes: this.queuedBytes,
    };
  }

  public getStats(): HostEgressClientStats {
    const queueSize = this.getQueueSize();
    return {
      clientId: this.id,
      queuedItems: queueSize.items,
      queuedBytes: queueSize.bytes,
      highWaterItems: this.highWaterItems,
      highWaterBytes: this.highWaterBytes,
      sentFrames: this.sentFrames,
      sentItems: this.sentItems,
      sentBytes: this.sentBytes,
      replayFrames: this.replayFrames,
      replayItems: this.replayItems,
      replayBytes: this.replayBytes,
      projectionReplacements: this.projectionReplacements,
      diagnosticsEvicted: this.diagnosticsEvicted,
      oversizedItems: this.oversizedItems,
      slowConsumerDisconnects: this.slowConsumerDisconnects,
      closed: this.closed,
    };
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) {
      this.flushControl();
      this.flushData();
    }
  }

  public flushNow(): void {
    this.flushControl();
    this.flushData();
  }

  public offer(record: HostEgressRecord): void {
    if (this.closed) return;
    if (record.sequence.seq <= this.lastSentSeq) return;
    if (record.encodedBytes > this.maxFrameBytes) {
      this.oversizedItems += 1;
      if (record.policy.kind === 'append' || record.policy.kind === 'control') {
        this.closeInternal('oversized-item');
      }
      return;
    }
    if (record.policy.kind === 'control') {
      this.controlQueue.push(record);
      this.queuedBytes += record.encodedBytes;
      if (
        this.dataQueue.length + this.controlQueue.length > this.maxQueueItems ||
        this.queuedBytes > this.maxQueueBytes
      ) {
        this.closeSlow('slow-consumer');
        return;
      }
      this.updateHighWater();
      this.flushControl();
      return;
    }

    const keyToken =
      record.policy.kind === 'projection' ? JSON.stringify(record.policy.key) : undefined;
    if (keyToken !== undefined) {
      const previousIndex = this.dataQueue.findIndex((entry) => entry.keyToken === keyToken);
      if (previousIndex >= 0) {
        const previous = this.dataQueue[previousIndex];
        if (previous !== undefined) {
          this.dataQueue.splice(previousIndex, 1);
          this.queuedBytes -= previous.encodedBytes;
          this.projectionReplacements += 1;
        }
      }
    }
    this.dataQueue.push({ ...record, ...(keyToken === undefined ? {} : { keyToken }) });
    this.queuedBytes += record.encodedBytes;
    this.evictDiagnosticsToBudget();
    if (
      this.dataQueue.length + this.controlQueue.length > this.maxQueueItems ||
      this.queuedBytes > this.maxQueueBytes
    ) {
      this.closeSlow('slow-consumer');
      return;
    }
    this.updateHighWater();
    // A synchronous producer (for example a tool emitting a large retained
    // output) can enqueue far more than one cadence window before a timer gets
    // a turn. Drain a full target batch immediately whenever the socket can
    // accept it; otherwise the normal timer/backpressure path remains in force.
    if (
      !this.paused &&
      this.canSend() &&
      (this.queuedBytes >= this.targetBatchBytes || this.dataQueue.length >= this.maxBatchItems)
    ) {
      this.flushData();
    } else {
      this.scheduleDataFlush();
    }
  }

  public sendReplay(records: HostEgressRecord[]): void {
    if (this.closed || records.length === 0) return;
    if (!this.paused) {
      this.flushData();
    }
    const replayRecords = records.filter((record) => record.sequence.seq > this.lastSentSeq);
    if (replayRecords.length === 0) return;
    if (!this.canSend()) {
      for (const record of replayRecords) {
        this.dataQueue.push(record);
        this.queuedBytes += record.encodedBytes;
      }
      this.updateHighWater();
      this.scheduleDrainRetry();
      return;
    }
    this.sendRecordsInChunks(replayRecords, 'replay');
  }

  public close(): void {
    this.closed = true;
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.drainTimer !== undefined) {
      clearTimeout(this.drainTimer);
      this.drainTimer = undefined;
    }
    this.dataQueue = [];
    this.controlQueue = [];
    this.queuedBytes = 0;
  }

  private flushControl(): void {
    if (this.controlQueue.length === 0 || this.closed || this.paused) return;
    if (!this.canSend()) {
      this.scheduleDrainRetry();
      return;
    }
    const controls = this.controlQueue.splice(0, this.maxBatchItems);
    const firstControl = controls[0];
    if (firstControl === undefined) return;
    const precedingData: HostEgressRecord[] = [];
    while (true) {
      const queued = this.dataQueue[0];
      if (queued === undefined || queued.sequence.seq >= firstControl.sequence.seq) {
        break;
      }
      const record = this.dataQueue.shift();
      if (record === undefined) break;
      precedingData.push(record);
    }
    const records = [...precedingData, ...controls].sort(
      (left, right) => left.sequence.seq - right.sequence.seq,
    );
    this.queuedBytes -= records.reduce((sum, record) => sum + record.encodedBytes, 0);
    this.sendRecordsInChunks(records);
  }

  private scheduleDataFlush(): void {
    if (this.flushTimer !== undefined || this.closed) return;
    this.flushTimer = this.schedule(() => {
      this.flushTimer = undefined;
      this.flushData();
    }, 24);
  }

  private scheduleDrainRetry(): void {
    if (this.drainTimer !== undefined || this.closed || this.paused) return;
    this.drainTimer = this.schedule(() => {
      this.drainTimer = undefined;
      this.flushControl();
      this.flushData();
    }, 16);
  }

  private flushData(): void {
    if (this.closed || this.paused || this.dataQueue.length === 0) return;
    if (!this.canSend()) {
      this.scheduleDrainRetry();
      return;
    }
    const records: HostEgressRecord[] = [];
    let bytes = 0;
    while (records.length < this.maxBatchItems && this.dataQueue.length > 0) {
      const next = this.dataQueue[0];
      if (next === undefined) break;
      if (records.length > 0 && bytes + next.encodedBytes > this.targetBatchBytes) break;
      this.dataQueue.shift();
      records.push(next);
      bytes += next.encodedBytes;
      this.queuedBytes -= next.encodedBytes;
    }
    this.sendRecords(records);
    if (this.dataQueue.length > 0) this.scheduleDataFlush();
  }

  private sendRecords(records: HostEgressRecord[], mode: 'live' | 'replay' = 'live'): void {
    if (records.length === 0 || this.closed) return;
    try {
      if (!this.supportsBatch) {
        for (const record of records) {
          this.send({
            type: 'push',
            seq: record.sequence.seq,
            eventId: record.sequence.eventId,
            push: record.sequence.push,
          });
          this.lastSentSeq = record.sequence.seq;
          this.recordSend(1, 1, record.encodedBytes, mode);
        }
        return;
      }

      const first = records[0];
      const last = records.at(-1);
      if (first === undefined || last === undefined) return;
      const frame: HostPushBatchFrame = {
        type: 'push/batch',
        hostInstanceId: this.hostInstanceId,
        afterSeq: this.lastSentSeq,
        throughSeq: last.sequence.seq,
        items: records.map((record) => record.sequence),
      };
      this.send(frame);
      this.lastSentSeq = last.sequence.seq;
      this.recordSend(1, records.length, sumEncodedBytes(records), mode);
    } catch (error) {
      this.closeSlow(error instanceof Error ? error.message : 'Host egress send failed');
    }
  }

  private sendRecordsInChunks(records: HostEgressRecord[], mode: 'live' | 'replay' = 'live'): void {
    let recordIndex = 0;
    while (!this.closed && recordIndex < records.length) {
      if (!this.canSend()) {
        // Pause and resume instead of 4008 mid-replay — large reconnect
        // catch-up must not immediately re-kick the socket.
        const remaining = records.slice(recordIndex);
        for (const record of remaining) {
          this.dataQueue.push(record);
          this.queuedBytes += record.encodedBytes;
        }
        this.updateHighWater();
        this.scheduleDrainRetry();
        return;
      }
      const chunk: HostEgressRecord[] = [];
      let bytes = 0;
      while (chunk.length < this.maxBatchItems && recordIndex < records.length) {
        const next = records[recordIndex];
        if (next === undefined) {
          break;
        }
        if (chunk.length > 0 && bytes + next.encodedBytes > this.targetBatchBytes) {
          break;
        }
        chunk.push(next);
        bytes += next.encodedBytes;
        recordIndex += 1;
      }
      if (chunk.length === 0) {
        return;
      }
      this.sendRecords(chunk, mode);
    }
  }

  private closeSlow(reason: string): void {
    this.slowConsumerDisconnects += 1;
    this.closeInternal(reason);
  }

  private closeInternal(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.drainTimer !== undefined) {
      clearTimeout(this.drainTimer);
      this.drainTimer = undefined;
    }
    this.dataQueue = [];
    this.controlQueue = [];
    this.queuedBytes = 0;
    this.onSlowConsumer(reason);
  }

  private updateHighWater(): void {
    const queueSize = this.getQueueSize();
    this.highWaterItems = Math.max(this.highWaterItems, queueSize.items);
    this.highWaterBytes = Math.max(this.highWaterBytes, queueSize.bytes);
  }

  private evictDiagnosticsToBudget(): void {
    while (
      (this.dataQueue.length + this.controlQueue.length > this.maxQueueItems ||
        this.queuedBytes > this.maxQueueBytes) &&
      this.removeOldestDiagnostic()
    ) {
      // Keep evicting diagnostics until append/control capacity is preserved.
    }
  }

  private removeOldestDiagnostic(): boolean {
    const index = this.dataQueue.findIndex((entry) => entry.policy.kind === 'diagnostic');
    if (index < 0) return false;
    const [removed] = this.dataQueue.splice(index, 1);
    if (removed === undefined) return false;
    this.queuedBytes -= removed.encodedBytes;
    this.diagnosticsEvicted += 1;
    return true;
  }

  private recordSend(
    frameCount: number,
    itemCount: number,
    bytes: number,
    mode: 'live' | 'replay',
  ): void {
    this.sentFrames += frameCount;
    this.sentItems += itemCount;
    this.sentBytes += bytes;
    if (mode === 'replay') {
      this.replayFrames += frameCount;
      this.replayItems += itemCount;
      this.replayBytes += bytes;
    }
  }
}

function sumEncodedBytes(records: HostEgressRecord[]): number {
  return records.reduce((total, record) => total + record.encodedBytes, 0);
}
