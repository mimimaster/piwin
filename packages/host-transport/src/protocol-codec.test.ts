import { describe, expect, it } from 'vitest';
import type {
  HostClientHello,
  HostClientOutboundFrame,
  HostHydrationFrame,
  HostPushBatchFrame,
} from '@piwin/contracts';
import {
  APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
  HOST_PROTOCOL_VERSION,
} from '@piwin/contracts';
import {
  decodeHostWireMessage,
  encodeHostWireMessage,
  HostProtocolError,
  HOST_WIRE_HARD_FRAME_BYTES,
} from './protocol-codec.js';

describe('Host wire codec', () => {
  it('round-trips a live subscription update', () => {
    const frame = {
      type: 'client/subscriptions' as const,
      requestId: 'sub-1',
      revision: 2,
      subscriptions: { sessionIds: ['session-b'] },
    };
    expect(decodeHostWireMessage(encodeHostWireMessage(frame))).toEqual(frame);
    const applied = {
      type: 'subscriptions/applied' as const,
      requestId: 'sub-1',
      revision: 2,
      fenceSeq: 41,
    };
    expect(decodeHostWireMessage(encodeHostWireMessage(applied))).toEqual(applied);
  });

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

  it('keeps protocol version 1 while round-tripping negotiated client-tool frames', () => {
    expect(HOST_PROTOCOL_VERSION).toBe(1);
    const request = {
      type: 'client-tool/request' as const,
      requestId: 'req-1',
      capabilityId: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
      sessionId: 'session-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      arguments: { metrics: ['steps'], range: { preset: 'today' as const } },
      deadlineAt: '2026-08-23T12:02:00.000Z',
      timeoutMs: 120_000,
      display: {
        title: '读取 Apple Health' as const,
        metricLabels: ['步数'],
        periodLabel: '今天',
        explicitTurnIntent: false,
      },
    };
    const result = {
      type: 'client-tool/result' as const,
      requestId: 'req-1',
      status: 'success' as const,
      completedAt: '2026-08-23T12:00:10.000Z',
      result: { schemaVersion: 1, source: 'apple-health', records: [] },
    };
    const cancel = {
      type: 'client-tool/cancel' as const,
      requestId: 'req-1',
      reason: 'deadline' as const,
    };
    const capabilities = {
      type: 'client-tool/capabilities' as const,
      capabilities: [{ id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, version: 1 }],
      sentAt: '2026-08-23T12:00:00.000Z',
    };

    expect(decodeHostWireMessage(encodeHostWireMessage(request))).toEqual(request);
    expect(decodeHostWireMessage(encodeHostWireMessage(result))).toEqual(result);
    expect(decodeHostWireMessage(encodeHostWireMessage(cancel))).toEqual(cancel);
    expect(decodeHostWireMessage(encodeHostWireMessage(capabilities))).toEqual(capabilities);
  });

  it('rejects malformed, inconsistent, oversize, and unknown-enum client-tool frames', () => {
    expect(() =>
      decodeHostWireMessage(
        JSON.stringify({
          type: 'client-tool/result',
          requestId: 'req-1',
          status: 'success',
          completedAt: '2026-08-23T12:00:10.000Z',
        }),
      ),
    ).toThrow(HostProtocolError);

    expect(() =>
      decodeHostWireMessage(
        JSON.stringify({
          type: 'client-tool/result',
          requestId: 'req-1',
          status: 'nope',
          completedAt: '2026-08-23T12:00:10.000Z',
          errorCode: 'cancelled',
        }),
      ),
    ).toThrow(HostProtocolError);

    const nonFinite = JSON.stringify({
      type: 'client-tool/request',
      requestId: 'req-1',
      capabilityId: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
      sessionId: 'session-1',
      runId: 'run-1',
      toolCallId: 'tool-1',
      arguments: { value: 0 },
      deadlineAt: '2026-08-23T12:02:00.000Z',
      timeoutMs: 120_000,
      display: {
        title: '读取 Apple Health',
        metricLabels: ['步数'],
        periodLabel: '今天',
        explicitTurnIntent: false,
      },
    }).replace('"value":0', '"value":1e999');
    expect(() => decodeHostWireMessage(nonFinite)).toThrow(HostProtocolError);

    const oversizeResult = {
      type: 'client-tool/result',
      requestId: 'req-1',
      status: 'success',
      completedAt: '2026-08-23T12:00:10.000Z',
      result: { blob: 'x'.repeat(130 * 1024) },
    };
    expect(() => encodeHostWireMessage(oversizeResult as never)).toThrow(HostProtocolError);
    expect(HOST_WIRE_HARD_FRAME_BYTES).toBe(1_048_576);
  });

  it('still round-trips an old hello that omits client tools', () => {
    const hello: HostClientHello = {
      type: 'client/hello',
      protocolVersion: 1,
      clientType: 'mobile',
      clientVersion: 'test',
      clientId: 'mobile-test',
      lastSeq: 0,
    };
    expect(decodeHostWireMessage(encodeHostWireMessage(hello))).toEqual(hello);
  });

  it('types client outbound frames without Host-to-client request/cancel', () => {
    type Forbidden = Extract<
      HostClientOutboundFrame['type'],
      'client-tool/request' | 'client-tool/cancel'
    >;
    const noHostToClient: Forbidden extends never ? true : false = true;
    expect(noHostToClient).toBe(true);
  });
});
