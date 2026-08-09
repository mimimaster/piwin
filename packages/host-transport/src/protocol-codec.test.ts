import { describe, expect, it } from 'vitest';
import type { HostClientHello, HostHydrationFrame, HostPushBatchFrame } from '@piwin/contracts';
import {
  decodeHostWireMessage,
  encodeHostWireMessage,
  HostProtocolError,
} from './protocol-codec.js';

describe('Host wire codec', () => {
  it('round-trips a client hello', () => {
    const hello: HostClientHello = {
      type: 'client/hello',
      protocolVersion: 1,
      clientType: 'mobile',
      clientVersion: 'test',
      clientId: 'mobile-test',
      lastSeq: 3,
    };

    expect(decodeHostWireMessage(encodeHostWireMessage(hello))).toEqual(hello);
  });

  it('rejects unknown or malformed frames', () => {
    expect(() => decodeHostWireMessage(JSON.stringify({ type: 'unknown' }))).toThrow(
      HostProtocolError,
    );
    expect(() => decodeHostWireMessage(JSON.stringify({ type: 'push', seq: 1 }))).toThrow(
      HostProtocolError,
    );
  });

  it('validates cursor batch ordering and inner envelope identity', () => {
    const batch: HostPushBatchFrame = {
      type: 'push/batch',
      hostInstanceId: 'host-1',
      afterSeq: 2,
      throughSeq: 5,
      items: [
        {
          seq: 3,
          eventId: 'event-3',
          push: { type: 'host/log', level: 'info', message: 'a' },
        },
        {
          seq: 5,
          eventId: 'event-5',
          push: { type: 'host/log', level: 'info', message: 'b' },
        },
      ],
    };

    expect(decodeHostWireMessage(encodeHostWireMessage(batch))).toEqual(batch);
    expect(() =>
      decodeHostWireMessage(
        JSON.stringify({
          ...batch,
          items: [{ ...batch.items[0], seq: 2 }],
        }),
      ),
    ).toThrow(HostProtocolError);
    expect(() =>
      decodeHostWireMessage(
        JSON.stringify({
          type: 'push',
          seq: 3,
          eventId: 'outer-event',
          push: { type: 'host/log', seq: 4, level: 'info', message: 'bad' },
        }),
      ),
    ).toThrow(HostProtocolError);
  });

  it('validates a bounded hydration replacement frame', () => {
    const hydration: HostHydrationFrame = {
      type: 'hydration',
      reason: 'replay-too-old',
      snapshot: {
        snapshotId: 'snapshot-1',
        hostInstanceId: 'host-1',
        snapshotSeq: 12,
        status: {
          hostInstanceId: 'host-1',
          protocolVersion: 1,
          mode: 'sdk',
          ready: true,
          mock: false,
          activeSessionCount: 1,
          capabilities: {
            pushSequencing: true,
            replay: true,
            snapshot: true,
            sessionRead: true,
            sessionControl: true,
            permissionResolve: true,
            mediaUpload: true,
          },
        },
        sessions: [],
        messagesBySession: {},
        truncatedSessionIds: [],
      },
    };

    expect(decodeHostWireMessage(encodeHostWireMessage(hydration))).toEqual(hydration);
    expect(() =>
      decodeHostWireMessage(
        JSON.stringify({ ...hydration, snapshot: { ...hydration.snapshot, snapshotSeq: -1 } }),
      ),
    ).toThrow(HostProtocolError);
  });
});
