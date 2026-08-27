import { randomUUID } from 'node:crypto';
import type {
  HostPush,
  HostPushBatchFrame,
  HostPushFrame,
  HostSequencedPush,
  PushSink,
} from '@piwin/contracts';
import { classifyHostPush, type HostDeliveryKey, type HostPushPolicy } from '@piwin/host-transport';
import type { LiveSessionFilter } from '@piwin/host-transport';
import { HostEgressChannel, type HostEgressRecord } from './host-egress-channel.js';
import type { HostEgressClientStats, HostEgressStats } from './host-egress-metrics.js';
import { HostReplayJournal } from './host-replay-journal.js';

export type HostEgressHubOptions = {
  hostInstanceId?: string;
  attachRuntimeSink?: (sink: PushSink) => () => void;
  journal?: HostReplayJournal;
  flushCadenceMs?: number;
  maxReplayItems?: number;
  maxClientQueueItems?: number;
  maxClientQueueBytes?: number;
  maxFrameBytes?: number;
  maxPendingDataItems?: number;
  maxPendingDataBytes?: number;
  maxPendingDiagnosticItems?: number;
  maxPendingDiagnosticBytes?: number;
  onError?: (error: Error) => void;
  onCanonicalIngest?: (push: HostPush) => void;
};

export type HostEgressClientOptions = {
  id: string;
  canSend: () => boolean;
  initialSeq?: number;
  maxQueueItems?: number;
  maxQueueBytes?: number;
  send?: (message: HostPushFrame | HostPushBatchFrame) => void;
  onSlowConsumer?: (reason: string) => void;
  sendNow?: (frame: HostPushFrame) => void;
  sendBatchNow?: (frame: HostPushBatchFrame) => void;
  supportsBatch?: boolean;
  closeSlowConsumer?: (reason: string) => void;
  liveFilter?: LiveSessionFilter;
};

type PendingRecord = {
  push: HostPush;
  policy: HostPushPolicy;
  ingressOrdinal: number;
  encodedBytes: number;
};

/** The single semantic-to-transport egress authority for one Host instance. */
export class HostEgressHub {
  private readonly hostInstanceId: string;
  private readonly journal: HostReplayJournal;
  private readonly flushCadenceMs: number;
  private readonly attachRuntimeSink: ((sink: PushSink) => () => void) | undefined;
  private readonly maxClientQueueItems: number;
  private readonly maxClientQueueBytes: number;
  private readonly maxFrameBytes: number | undefined;
  private readonly maxPendingDataItems: number;
  private readonly maxPendingDataBytes: number;
  private readonly maxPendingDiagnosticItems: number;
  private readonly maxPendingDiagnosticBytes: number;
  private readonly onError: (error: Error) => void;
  private readonly clients = new Map<string, HostEgressChannel>();
  private readonly retiredClientStats = new Map<string, HostEgressClientStats>();
  private readonly pendingAppends: PendingRecord[] = [];
  private readonly pendingProjections = new Map<string, PendingRecord>();
  private readonly pendingDiagnostics: PendingRecord[] = [];
  private pendingDataBytes = 0;
  private pendingDiagnosticBytes = 0;
  private readonly ingressByType = new Map<string, number>();
  private readonly canonicalByPolicy = new Map<string, number>();
  private projectionsReplaced = 0;
  private diagnosticsEvicted = 0;
  private snapshotFallbacks = 0;
  private sequence = 0;
  private ingressOrdinal = 0;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private detachRuntimeSink: (() => void) | undefined;
  private disposed = false;
  private readonly ingestListeners = new Set<(push: HostPush) => void>();
  private readonly onCanonicalIngest: ((push: HostPush) => void) | undefined;

  public constructor(options: HostEgressHubOptions) {
    const hostInstanceId = options.hostInstanceId ?? randomUUID();
    if (hostInstanceId.trim().length === 0) {
      throw new Error('Host egress hub requires a host instance ID');
    }
    if (options.flushCadenceMs !== undefined && options.flushCadenceMs <= 0) {
      throw new Error('Host egress flush cadence must be greater than zero');
    }
    this.hostInstanceId = hostInstanceId;
    this.journal =
      options.journal ??
      new HostReplayJournal({
        ...(options.maxReplayItems === undefined ? {} : { maxItems: options.maxReplayItems }),
      });
    this.flushCadenceMs = options.flushCadenceMs ?? 24;
    this.attachRuntimeSink = options.attachRuntimeSink;
    this.maxClientQueueItems = options.maxClientQueueItems ?? 2_048;
    this.maxClientQueueBytes = options.maxClientQueueBytes ?? 2 * 1024 * 1024;
    this.maxFrameBytes = options.maxFrameBytes;
    this.maxPendingDataItems = options.maxPendingDataItems ?? 8;
    this.maxPendingDataBytes = options.maxPendingDataBytes ?? 128 * 1024;
    this.maxPendingDiagnosticItems = options.maxPendingDiagnosticItems ?? 1_024;
    this.maxPendingDiagnosticBytes = options.maxPendingDiagnosticBytes ?? 256 * 1024;
    if (
      this.maxPendingDataItems <= 0 ||
      this.maxPendingDataBytes <= 0 ||
      this.maxPendingDiagnosticItems <= 0 ||
      this.maxPendingDiagnosticBytes <= 0
    ) {
      throw new Error('Host egress pending budgets must be greater than zero');
    }
    this.onError = options.onError ?? (() => undefined);
    this.onCanonicalIngest = options.onCanonicalIngest;
  }

  public subscribeIngest(listener: (push: HostPush) => void): () => void {
    this.ingestListeners.add(listener);
    return () => this.ingestListeners.delete(listener);
  }

  public getHostInstanceId(): string {
    return this.hostInstanceId;
  }

  public getCurrentSeq(): number {
    return this.sequence;
  }

  public getJournal(): HostReplayJournal {
    return this.journal;
  }

  public createPushSink(id: string): PushSink {
    return {
      id,
      sequenced: false,
      push: (message) => this.ingest(message),
    };
  }

  public start(): void {
    if (this.disposed) throw new Error('Host egress hub is disposed');
    if (this.detachRuntimeSink !== undefined) return;
    this.detachRuntimeSink = this.attachRuntimeSink?.(this.createPushSink('host-egress-hub'));
  }

  public stop(): void {
    this.detachRuntimeSink?.();
    this.detachRuntimeSink = undefined;
    this.dispose();
  }

  public addClient(options: HostEgressClientOptions): HostEgressChannel {
    if (this.disposed) throw new Error('Host egress hub is disposed');
    if (this.clients.has(options.id))
      throw new Error(`Host egress client already exists: ${options.id}`);
    this.retiredClientStats.delete(options.id);
    if (options.send === undefined && options.sendNow === undefined) {
      throw new Error(`Host egress client ${options.id} requires a send callback`);
    }
    const sendNow = options.sendNow;
    const closeSlowConsumer = options.closeSlowConsumer ?? (() => undefined);
    const channel = new HostEgressChannel({
      id: options.id,
      hostInstanceId: this.hostInstanceId,
      supportsBatch:
        options.supportsBatch === true &&
        (options.send !== undefined || options.sendBatchNow !== undefined),
      canSend: options.canSend,
      ...(options.initialSeq === undefined ? {} : { initialSeq: options.initialSeq }),
      ...(options.maxQueueItems === undefined
        ? { maxQueueItems: this.maxClientQueueItems }
        : { maxQueueItems: options.maxQueueItems }),
      ...(options.maxQueueBytes === undefined
        ? { maxQueueBytes: this.maxClientQueueBytes }
        : { maxQueueBytes: options.maxQueueBytes }),
      ...(this.maxFrameBytes === undefined ? {} : { maxFrameBytes: this.maxFrameBytes }),
      ...(options.liveFilter === undefined ? {} : { liveFilter: options.liveFilter }),
      send: (message) => {
        if (options.send !== undefined) {
          options.send(message as HostPushFrame | HostPushBatchFrame);
          return;
        }
        if (message.type === 'push') {
          if (sendNow === undefined) {
            throw new Error(`Host egress client ${options.id} has no singular send callback`);
          }
          sendNow(message);
        } else if (message.type === 'push/batch') {
          if (options.sendBatchNow !== undefined) {
            options.sendBatchNow(message);
          } else {
            if (sendNow === undefined) {
              throw new Error(`Host egress client ${options.id} has no singular send callback`);
            }
            for (const item of message.items) {
              sendNow({
                type: 'push',
                seq: item.seq,
                eventId: item.eventId,
                push: item.push,
              });
            }
          }
        }
      },
      onSlowConsumer: (reason) => {
        try {
          (options.onSlowConsumer ?? closeSlowConsumer)(reason);
        } finally {
          this.retiredClientStats.set(options.id, channel.getStats());
          this.clients.delete(options.id);
        }
      },
    });
    this.clients.set(options.id, channel);
    return channel;
  }

  public attachClient(options: HostEgressClientOptions): () => void {
    this.addClient(options);
    return () => this.removeClient(options.id);
  }

  public pauseClient(id: string): void {
    this.clients.get(id)?.setPaused(true);
  }

  public resumeClient(id: string): void {
    this.clients.get(id)?.setPaused(false);
  }

  public removeClient(id: string): void {
    const channel = this.clients.get(id);
    if (channel === undefined) return;
    channel.close();
    this.clients.delete(id);
  }

  public listReplay(sinceSeq: number): {
    complete: boolean;
    records: HostEgressRecord[];
    currentSeq: number;
  } {
    const records = this.journal.listSince(sinceSeq).map((sequence) => this.toRecord(sequence));
    // Empty/expired journals are incomplete whenever the client is behind the
    // live head — otherwise reconnects skip hydration and filter new pushes.
    const complete =
      sinceSeq >= this.sequence || this.journal.isCompleteSince(sinceSeq);
    return { complete, records, currentSeq: this.sequence };
  }

  public selectReplay(sinceSeq: number): {
    complete: boolean;
    currentSeq: number;
    frames: HostPushFrame[];
  } {
    const replay = this.listReplay(sinceSeq);
    return {
      complete: replay.complete,
      currentSeq: replay.currentSeq,
      frames: replay.records.map((record) => ({
        type: 'push',
        seq: record.sequence.seq,
        eventId: record.sequence.eventId,
        push: record.sequence.push,
      })),
    };
  }

  public replayClient(id: string, sinceSeq: number): void {
    const channel = this.clients.get(id);
    if (channel === undefined) return;
    const records = this.listReplay(sinceSeq).records;
    channel.sendReplay(records);
  }

  public noteSnapshotFallback(): void {
    this.snapshotFallbacks += 1;
  }

  public getStats(): HostEgressStats {
    const clients = [
      ...[...this.clients.values()].map((client) => client.getStats()),
      ...this.retiredClientStats.values(),
    ].sort((left, right) => left.clientId.localeCompare(right.clientId));
    return {
      ingressByType: mapToRecord(this.ingressByType),
      canonicalByPolicy: mapToRecord(this.canonicalByPolicy),
      batches: clients.reduce((total, client) => total + client.sentFrames, 0),
      bytes: clients.reduce((total, client) => total + client.sentBytes, 0),
      projectionsReplaced:
        this.projectionsReplaced +
        clients.reduce((total, client) => total + client.projectionReplacements, 0),
      diagnosticsEvicted:
        this.diagnosticsEvicted +
        clients.reduce((total, client) => total + client.diagnosticsEvicted, 0),
      oversizedItems: clients.reduce((total, client) => total + client.oversizedItems, 0),
      slowConsumerDisconnects: clients.reduce(
        (total, client) => total + client.slowConsumerDisconnects,
        0,
      ),
      replayRecords: clients.reduce((total, client) => total + client.replayItems, 0),
      replayBytes: clients.reduce((total, client) => total + client.replayBytes, 0),
      snapshotFallbacks: this.snapshotFallbacks,
      clients,
    };
  }

  public ingest(push: HostPush): void {
    if (this.disposed) return;
    this.ingressByType.set(push.type, (this.ingressByType.get(push.type) ?? 0) + 1);
    const policy = classifyHostPush(push);
    const pending = this.createPending(push, policy);
    if (policy.kind === 'control') {
      this.flushMatching(policy);
      this.emitCanonical(pending);
      return;
    }

    if (policy.kind === 'projection') {
      const token = keyToken(policy.key);
      const previous = this.pendingProjections.get(token);
      if (previous !== undefined) {
        this.pendingDataBytes -= previous.encodedBytes;
        this.projectionsReplaced += 1;
      }
      this.pendingProjections.set(token, pending);
      this.pendingDataBytes += pending.encodedBytes;
    } else if (policy.kind === 'diagnostic') {
      this.pendingDiagnostics.push(pending);
      this.pendingDataBytes += pending.encodedBytes;
      this.pendingDiagnosticBytes += pending.encodedBytes;
      this.evictPendingDiagnostics();
    } else {
      this.pendingAppends.push(pending);
      this.pendingDataBytes += pending.encodedBytes;
    }
    if (
      this.pendingItemCount() >= this.maxPendingDataItems ||
      this.pendingDataBytes >= this.maxPendingDataBytes
    ) {
      this.flush();
    } else {
      this.scheduleFlush();
    }
  }

  public flush(): void {
    if (this.disposed) return;
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    const pending = [
      ...this.pendingAppends.splice(0),
      ...this.pendingProjections.values(),
      ...this.pendingDiagnostics.splice(0),
    ].sort((left, right) => left.ingressOrdinal - right.ingressOrdinal);
    this.pendingDataBytes = 0;
    this.pendingDiagnosticBytes = 0;
    this.pendingProjections.clear();
    for (const item of pending) this.emitCanonical(item);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.flushTimer !== undefined) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    for (const client of this.clients.values()) client.close();
    this.clients.clear();
    this.pendingAppends.length = 0;
    this.pendingDiagnostics.length = 0;
    this.pendingDataBytes = 0;
    this.pendingDiagnosticBytes = 0;
    this.pendingProjections.clear();
  }

  private createPending(push: HostPush, policy: HostPushPolicy): PendingRecord {
    const semanticPush = { ...push };
    delete semanticPush.seq;
    delete semanticPush.eventId;
    const normalizedPush = semanticPush as HostPush;
    return {
      push: normalizedPush,
      policy,
      ingressOrdinal: ++this.ingressOrdinal,
      encodedBytes: new TextEncoder().encode(JSON.stringify(normalizedPush)).byteLength,
    };
  }

  private flushMatching(controlPolicy: Extract<HostPushPolicy, { kind: 'control' }>): void {
    const matches = (pending: PendingRecord): boolean => {
      if (
        controlPolicy.runBarrierId !== undefined &&
        (pending.policy.kind === 'append' || pending.policy.kind === 'projection') &&
        pending.policy.runId === controlPolicy.runBarrierId
      ) {
        return true;
      }
      if (controlPolicy.barrierKeys.length === 0) return false;
      const keys = new Set(controlPolicy.barrierKeys.map((key) => keyToken(key)));
      if (pending.policy.kind === 'control') return false;
      return keys.has(keyToken(pending.policy.key));
    };

    const selected: PendingRecord[] = [];
    this.removeMatching(this.pendingAppends, matches, selected);
    this.removeMatching(this.pendingDiagnostics, matches, selected);
    for (const [token, pending] of this.pendingProjections) {
      if (matches(pending)) {
        this.pendingProjections.delete(token);
        selected.push(pending);
      }
    }
    this.recomputePendingBytes();
    selected.sort((left, right) => left.ingressOrdinal - right.ingressOrdinal);
    for (const item of selected) this.emitCanonical(item);
  }

  private removeMatching(
    source: PendingRecord[],
    matches: (pending: PendingRecord) => boolean,
    selected: PendingRecord[],
  ): void {
    const remaining: PendingRecord[] = [];
    for (const item of source) {
      if (matches(item)) selected.push(item);
      else remaining.push(item);
    }
    source.splice(0, source.length, ...remaining);
  }

  private emitCanonical(pending: PendingRecord): void {
    const eventId = randomUUID();
    const sequence: HostSequencedPush = {
      seq: ++this.sequence,
      eventId,
      push: { ...pending.push, seq: this.sequence, eventId },
    };
    const record: HostEgressRecord = {
      sequence,
      policy: pending.policy,
      encodedBytes: pending.encodedBytes,
    };
    this.canonicalByPolicy.set(
      pending.policy.kind,
      (this.canonicalByPolicy.get(pending.policy.kind) ?? 0) + 1,
    );
    this.journal.append(sequence);
    this.onCanonicalIngest?.(pending.push);
    for (const listener of this.ingestListeners) {
      try {
        listener(pending.push);
      } catch (error) {
        this.onError(error instanceof Error ? error : new Error('Host ingest listener failed'));
      }
    }
    for (const [id, client] of this.clients) {
      try {
        client.offer(record);
      } catch (error) {
        this.onError(error instanceof Error ? error : new Error(`Host client ${id} offer failed`));
      }
    }
  }

  private toRecord(sequence: HostSequencedPush): HostEgressRecord {
    return {
      sequence,
      policy: classifyHostPush(sequence.push),
      encodedBytes: new TextEncoder().encode(JSON.stringify(sequence.push)).byteLength,
    };
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== undefined || this.disposed) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, this.flushCadenceMs);
  }

  private pendingItemCount(): number {
    return (
      this.pendingAppends.length + this.pendingProjections.size + this.pendingDiagnostics.length
    );
  }

  private evictPendingDiagnostics(): void {
    while (
      (this.pendingDiagnostics.length > this.maxPendingDiagnosticItems ||
        this.pendingDiagnosticBytes > this.maxPendingDiagnosticBytes) &&
      this.pendingDiagnostics.length > 0
    ) {
      const evicted = this.pendingDiagnostics.shift();
      if (evicted === undefined) break;
      this.diagnosticsEvicted += 1;
      this.pendingDiagnosticBytes -= evicted.encodedBytes;
      this.pendingDataBytes -= evicted.encodedBytes;
    }
  }

  private recomputePendingBytes(): void {
    this.pendingDataBytes = [
      ...this.pendingAppends,
      ...this.pendingProjections.values(),
      ...this.pendingDiagnostics,
    ].reduce((total, pending) => total + pending.encodedBytes, 0);
    this.pendingDiagnosticBytes = this.pendingDiagnostics.reduce(
      (total, pending) => total + pending.encodedBytes,
      0,
    );
  }
}

function keyToken(key: HostDeliveryKey): string {
  return JSON.stringify(key);
}

function mapToRecord(values: Map<string, number>): Record<string, number> {
  return Object.fromEntries(values.entries());
}
