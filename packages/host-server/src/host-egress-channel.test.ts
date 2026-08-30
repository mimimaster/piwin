import { describe, expect, it } from 'vitest';
import type { HostPush, HostWireMessage } from '@piwin/contracts';
import type { HostEgressRecord } from './host-egress-channel.js';
import { HostEgressChannel } from './host-egress-channel.js';

function record(
  seq: number,
  push: HostPush,
  kind: 'append' | 'projection' = 'append',
): HostEgressRecord {
  return {
    sequence: { seq, eventId: `event-${seq}`, push },
    policy:
      kind === 'append'
        ? { kind, key: ['host', 'log', String(seq)] }
        : { kind, key: ['host', 'status'] },
    encodedBytes: 32,
  };
}

function diagnosticRecord(seq: number, encodedBytes = 32): HostEgressRecord {
  return {
    sequence: {
      seq,
      eventId: `event-${seq}`,
      push: { type: 'host/log', level: 'info', message: 'log' },
    },
    policy: { kind: 'diagnostic', key: ['host', 'log'] },
    encodedBytes,
  };
}

describe('HostEgressChannel', () => {
  it('sends filtered projection replacements in one cursor batch', () => {
    const sent: HostWireMessage[] = [];
    let flush: (() => void) | undefined;
    const channel = new HostEgressChannel({
      id: 'client-1',
      hostInstanceId: 'host-1',
      supportsBatch: true,
      schedule: (callback) => {
        flush = callback;
        return undefined as unknown as ReturnType<typeof setTimeout>;
      },
      send: (message) => sent.push(message),
    });

    channel.offer(
      record(1, { type: 'host/status', mode: 'sdk', ready: false, mock: false }, 'projection'),
    );
    channel.offer(
      record(2, { type: 'host/status', mode: 'sdk', ready: true, mock: false }, 'projection'),
    );
    channel.offer(record(3, { type: 'host/log', level: 'info', message: 'done' }));
    flush?.();

    const batches = sent.filter((message) => message.type === 'push/batch');
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ type: 'push/batch', afterSeq: 0, throughSeq: 3 });
    if (batches[0]?.type === 'push/batch') {
      expect(batches[0].items.map((item) => item.seq)).toEqual([2, 3]);
    }
    expect(channel.getStats().projectionReplacements).toBe(1);
  });

  it('keeps singular clients compatible', () => {
    const sent: HostWireMessage[] = [];
    const channel = new HostEgressChannel({
      id: 'legacy-client',
      hostInstanceId: 'host-1',
      supportsBatch: false,
      send: (message) => sent.push(message),
    });
    channel.offer(record(1, { type: 'host/log', level: 'info', message: 'one' }));
    channel.sendReplay([record(2, { type: 'host/log', level: 'info', message: 'two' })]);

    expect(sent.map((message) => message.type)).toEqual(['push', 'push']);
    expect(channel.getLastSentSeq()).toBe(2);
  });

  it('drains a synchronous append burst before the bounded queue overflows', () => {
    const sent: HostWireMessage[] = [];
    const slowReasons: string[] = [];
    const channel = new HostEgressChannel({
      id: 'burst-client',
      hostInstanceId: 'host-1',
      supportsBatch: true,
      targetBatchBytes: 100,
      maxQueueBytes: 250,
      maxQueueItems: 32,
      send: (message) => sent.push(message),
      onSlowConsumer: (reason) => slowReasons.push(reason),
    });

    for (let sequence = 1; sequence <= 100; sequence += 1) {
      channel.offer({
        ...record(sequence, { type: 'host/log', level: 'info', message: String(sequence) }),
        encodedBytes: 60,
      });
    }
    channel.flushNow();

    expect(slowReasons).toEqual([]);
    expect(channel.getLastSentSeq()).toBe(100);
    expect(sent.some((message) => message.type === 'push/batch')).toBe(true);
  });

  it('evicts diagnostics before disconnecting a bounded queue', () => {
    const slowReasons: string[] = [];
    const channel = new HostEgressChannel({
      id: 'diagnostic-client',
      hostInstanceId: 'host-1',
      supportsBatch: true,
      canSend: () => false,
      maxQueueItems: 2,
      maxQueueBytes: 64,
      send: () => undefined,
      onSlowConsumer: (reason) => slowReasons.push(reason),
    });

    channel.offer(diagnosticRecord(1));
    channel.offer(diagnosticRecord(2));
    channel.offer(diagnosticRecord(3));

    expect(slowReasons).toEqual([]);
    expect(channel.getQueueSize()).toEqual({ items: 2, bytes: 64 });
    expect(channel.getStats().diagnosticsEvicted).toBe(1);
  });

  it('fails an oversized append with an explicit boundary reason', () => {
    const reasons: string[] = [];
    const channel = new HostEgressChannel({
      id: 'oversized-client',
      hostInstanceId: 'host-1',
      supportsBatch: true,
      maxFrameBytes: 64,
      send: () => undefined,
      onSlowConsumer: (reason) => reasons.push(reason),
    });

    channel.offer({
      ...record(1, { type: 'host/log', level: 'info', message: 'too large' }),
      encodedBytes: 65,
    });

    expect(reasons).toEqual(['oversized-item']);
    expect(channel.getStats()).toMatchObject({
      oversizedItems: 1,
      slowConsumerDisconnects: 0,
      closed: true,
    });
  });

  it('fences queued live records after a hydration replay', () => {
    const sent: HostWireMessage[] = [];
    const channel = new HostEgressChannel({
      id: 'hydration-client',
      hostInstanceId: 'host-1',
      supportsBatch: false,
      send: (message) => sent.push(message),
    });

    channel.setPaused(true);
    channel.offer(record(1, { type: 'host/log', level: 'info', message: 'one' }));
    channel.offer(record(2, { type: 'host/log', level: 'info', message: 'two' }));
    channel.offer(record(3, { type: 'host/log', level: 'info', message: 'three' }));
    channel.advanceCursor(2);
    channel.sendReplay([record(3, { type: 'host/log', level: 'info', message: 'three' })]);
    channel.advanceCursor(3);
    channel.setPaused(false);

    expect(sent.map((message) => message.type === 'push' && message.seq)).toEqual([3]);
  });

  it('drops Live owner actions for non-owner clients', () => {
    const sent: HostWireMessage[] = [];
    const channel = new HostEgressChannel({
      id: 'paired-phone',
      hostInstanceId: 'host-1',
      supportsBatch: false,
      deliverOwnerActions: false,
      send: (message) => sent.push(message),
    });
    channel.offer(
      record(1, {
        type: 'voice/live-owner-action',
        callId: 'c1',
        action: 'release-media',
      }),
    );
    channel.offer(record(2, { type: 'host/log', level: 'info', message: 'ok' }));
    channel.flushNow();
    expect(channel.getStats().filteredItems).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'push', seq: 2 });
  });

  it('fences paired-device owner actions to the active Live owner', () => {
    const sent: HostWireMessage[] = [];
    const channel = new HostEgressChannel({
      id: 'paired-phone-b',
      hostInstanceId: 'host-1',
      supportsBatch: false,
      ownerDeviceId: 'phone-b',
      liveOwnerDeviceId: 'phone-a',
      deliverOwnerActions: true,
      send: (message) => sent.push(message),
    });

    channel.offer(
      record(1, {
        type: 'voice/live-owner-action',
        callId: 'c1',
        action: 'release-media',
      }),
    );
    channel.setLiveOwnerDeviceId('phone-b');
    channel.offer(
      record(2, {
        type: 'voice/live-owner-action',
        callId: 'c1',
        action: 'release-media',
      }),
    );
    channel.flushNow();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'push', seq: 2 });
  });
});
