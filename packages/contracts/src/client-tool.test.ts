import { describe, expect, it } from 'vitest';
import { HOST_PROTOCOL_VERSION } from './remote-protocol.js';
import type {
  HostClientOutboundFrame,
  HostPush,
  HostHydrationFrame,
  HostSnapshotFrame,
  HostReplayFrame,
  HostPushBatchFrame,
} from './index.js';
import {
  APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
  CLIENT_TOOL_CLOCK_SKEW_MS,
  CLIENT_TOOL_DEFAULT_DEADLINE_MS,
  CLIENT_TOOL_MAX_DEADLINE_MS,
  MAX_APPLE_HEALTH_PENDING_PER_DEVICE,
  MAX_CLIENT_TOOL_CAPABILITIES,
  MAX_CLIENT_TOOL_CAPABILITY_ID_CHARS,
  MAX_CLIENT_TOOL_PENDING_HOST,
  MAX_CLIENT_TOOL_REQUEST_BYTES,
  MAX_CLIENT_TOOL_RESULT_BYTES,
  MAX_CLIENT_TOOL_CAPABILITIES_FRAME_BYTES,
  isValidClientToolCapabilityId,
  parseClientToolCapabilityAdvertisements,
  parseClientToolRequestFrame,
  parseClientToolResultFrame,
  parseClientToolCancelFrame,
  parseClientToolCapabilitiesFrame,
  isClientToolTimestampWithinSkew,
} from './client-tool.js';

const VALID_DISPLAY = {
  title: '读取 Apple Health' as const,
  metricLabels: ['步数'],
  periodLabel: '近 7 天',
  explicitTurnIntent: false,
};

const VALID_REQUEST = {
  type: 'client-tool/request' as const,
  requestId: 'req-1',
  capabilityId: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
  sessionId: 'session-1',
  runId: 'run-1',
  toolCallId: 'tool-1',
  arguments: { metrics: ['steps'], range: { preset: 'last-7-days' } },
  deadlineAt: '2026-08-23T12:02:00.000Z',
  timeoutMs: 120_000,
  display: VALID_DISPLAY,
};

describe('client-tool contracts', () => {
  it('keeps protocol version 1 and M1 capability id frozen', () => {
    expect(HOST_PROTOCOL_VERSION).toBe(1);
    expect(APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID).toBe('apple-health.read-context.v1');
    expect(MAX_CLIENT_TOOL_CAPABILITIES).toBe(32);
    expect(MAX_CLIENT_TOOL_CAPABILITY_ID_CHARS).toBe(128);
    expect(MAX_CLIENT_TOOL_REQUEST_BYTES).toBe(32 * 1024);
    expect(MAX_CLIENT_TOOL_RESULT_BYTES).toBe(128 * 1024);
    expect(MAX_CLIENT_TOOL_CAPABILITIES_FRAME_BYTES).toBe(8 * 1024);
    expect(CLIENT_TOOL_DEFAULT_DEADLINE_MS).toBe(120_000);
    expect(CLIENT_TOOL_MAX_DEADLINE_MS).toBe(180_000);
    expect(CLIENT_TOOL_CLOCK_SKEW_MS).toBe(10 * 60 * 1000);
    expect(MAX_CLIENT_TOOL_PENDING_HOST).toBe(32);
    expect(MAX_APPLE_HEALTH_PENDING_PER_DEVICE).toBe(1);
  });

  it('accepts bounded capability advertisements and rejects duplicates, oversize, and model prose', () => {
    const parsed = parseClientToolCapabilityAdvertisements([
      { id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, version: 1 },
    ]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.capabilities).toEqual([
        { id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, version: 1 },
      ]);
    }

    expect(isValidClientToolCapabilityId(APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID)).toBe(true);
    expect(isValidClientToolCapabilityId('not a id')).toBe(false);
    expect(isValidClientToolCapabilityId('a'.repeat(129))).toBe(false);
    expect(
      parseClientToolCapabilityAdvertisements([
        { id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, version: 1 },
        { id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, version: 2 },
      ]).ok,
    ).toBe(false);
    expect(
      parseClientToolCapabilityAdvertisements(
        Array.from({ length: 33 }, (_, index) => ({ id: `cap.${index}.v1`, version: 1 })),
      ).ok,
    ).toBe(false);
    expect(parseClientToolCapabilityAdvertisements([{ id: 'ok.v1', version: 0 }]).ok).toBe(false);
    expect(
      parseClientToolCapabilityAdvertisements([
        {
          id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
          version: 1,
          description: 'Reads Apple Health',
        },
      ]).ok,
    ).toBe(false);
  });

  it('parses a valid request frame and rejects missing IDs, bad timeout, and prototype data', () => {
    const parsed = parseClientToolRequestFrame(VALID_REQUEST);
    expect(parsed.ok).toBe(true);

    expect(parseClientToolRequestFrame({ ...VALID_REQUEST, requestId: '' }).ok).toBe(false);
    expect(parseClientToolRequestFrame({ ...VALID_REQUEST, timeoutMs: 180_001 }).ok).toBe(false);
    expect(parseClientToolRequestFrame({ ...VALID_REQUEST, timeoutMs: 0 }).ok).toBe(false);
    expect(parseClientToolRequestFrame({ ...VALID_REQUEST, timeoutMs: 1.5 }).ok).toBe(false);
    expect(parseClientToolRequestFrame({ ...VALID_REQUEST, deadlineAt: 'not-rfc3339' }).ok).toBe(
      false,
    );
    expect(
      parseClientToolRequestFrame({
        ...VALID_REQUEST,
        arguments: JSON.parse('{"__proto__": {"polluted": true}}'),
      }).ok,
    ).toBe(false);
    expect(
      parseClientToolRequestFrame({
        ...VALID_REQUEST,
        display: { ...VALID_DISPLAY, title: 'model wrote this' },
      }).ok,
    ).toBe(false);
  });

  it('enforces result/status consistency', () => {
    const success = parseClientToolResultFrame({
      type: 'client-tool/result',
      requestId: 'req-1',
      status: 'success',
      completedAt: '2026-08-23T12:00:01.000Z',
      result: { schemaVersion: 1, source: 'apple-health', records: [] },
    });
    expect(success.ok).toBe(true);

    expect(
      parseClientToolResultFrame({
        type: 'client-tool/result',
        requestId: 'req-1',
        status: 'success',
        completedAt: '2026-08-23T12:00:01.000Z',
        result: { schemaVersion: 1 },
        errorCode: 'cancelled',
      }).ok,
    ).toBe(false);

    expect(
      parseClientToolResultFrame({
        type: 'client-tool/result',
        requestId: 'req-1',
        status: 'success',
        completedAt: '2026-08-23T12:00:01.000Z',
      }).ok,
    ).toBe(false);

    expect(
      parseClientToolResultFrame({
        type: 'client-tool/result',
        requestId: 'req-1',
        status: 'permission-denied',
        completedAt: '2026-08-23T12:00:01.000Z',
        result: { schemaVersion: 1 },
        errorCode: 'local-policy-denied',
      }).ok,
    ).toBe(false);

    const denied = parseClientToolResultFrame({
      type: 'client-tool/result',
      requestId: 'req-1',
      status: 'permission-denied',
      completedAt: '2026-08-23T12:00:01.000Z',
      errorCode: 'local-policy-denied',
    });
    expect(denied.ok).toBe(true);

    expect(
      parseClientToolResultFrame({
        type: 'client-tool/result',
        requestId: 'req-1',
        status: 'permission-denied',
        completedAt: '2026-08-23T12:00:01.000Z',
        errorCode: 'healthkit-query-failed',
      }).ok,
    ).toBe(false);

    expect(
      parseClientToolResultFrame({
        type: 'client-tool/result',
        requestId: 'req-1',
        status: 'mystery',
        completedAt: '2026-08-23T12:00:01.000Z',
        errorCode: 'cancelled',
      }).ok,
    ).toBe(false);

    expect(
      parseClientToolResultFrame({
        type: 'client-tool/result',
        requestId: 'req-1',
        status: 'failed',
        completedAt: '2026-08-23T12:00:01.000Z',
        errorCode: 'healthkit-query-failed',
        extraProse: 'the user has arrhythmia',
      }).ok,
    ).toBe(false);
  });

  it('parses cancel and capability replacement frames', () => {
    expect(
      parseClientToolCancelFrame({
        type: 'client-tool/cancel',
        requestId: 'req-1',
        reason: 'run-aborted',
      }).ok,
    ).toBe(true);
    expect(
      parseClientToolCancelFrame({
        type: 'client-tool/cancel',
        requestId: 'req-1',
        reason: 'user-clicked',
      }).ok,
    ).toBe(false);

    const replacement = parseClientToolCapabilitiesFrame({
      type: 'client-tool/capabilities',
      capabilities: [{ id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, version: 1 }],
      sentAt: '2026-08-23T12:00:00.000Z',
    });
    expect(replacement.ok).toBe(true);
    expect(
      parseClientToolCapabilitiesFrame({
        type: 'client-tool/capabilities',
        capabilities: [],
        sentAt: '2026-08-23T12:00:00.000Z',
      }).ok,
    ).toBe(true);
  });

  it('rejects timestamps outside the ten-minute clock-skew window', () => {
    const issuedAtMs = Date.parse('2026-08-23T12:00:00.000Z');
    const deadlineAtMs = Date.parse('2026-08-23T12:02:00.000Z');
    expect(
      isClientToolTimestampWithinSkew({
        timestamp: '2026-08-23T11:50:00.000Z',
        issuedAtMs,
        deadlineAtMs,
      }),
    ).toBe(true);
    expect(
      isClientToolTimestampWithinSkew({
        timestamp: '2026-08-23T12:12:00.000Z',
        issuedAtMs,
        deadlineAtMs,
      }),
    ).toBe(true);
    expect(
      isClientToolTimestampWithinSkew({
        timestamp: '2026-08-23T11:49:59.000Z',
        issuedAtMs,
        deadlineAtMs,
      }),
    ).toBe(false);
    expect(
      isClientToolTimestampWithinSkew({
        timestamp: '2026-08-23T12:12:01.000Z',
        issuedAtMs,
        deadlineAtMs,
      }),
    ).toBe(false);
  });

  it('keeps client-tool frames out of HostPush, replay, hydration, and snapshot unions', () => {
    type PushLeak = Extract<HostPush['type'], `client-tool/${string}`>;
    type HydrationLeak = Extract<HostHydrationFrame['type'], `client-tool/${string}`>;
    type SnapshotLeak = Extract<HostSnapshotFrame['type'], `client-tool/${string}`>;
    type ReplayLeak = Extract<HostReplayFrame['type'], `client-tool/${string}`>;
    type BatchLeak = Extract<HostPushBatchFrame['type'], `client-tool/${string}`>;
    const noPushLeak: PushLeak extends never ? true : false = true;
    const noHydrationLeak: HydrationLeak extends never ? true : false = true;
    const noSnapshotLeak: SnapshotLeak extends never ? true : false = true;
    const noReplayLeak: ReplayLeak extends never ? true : false = true;
    const noBatchLeak: BatchLeak extends never ? true : false = true;
    expect(noPushLeak && noHydrationLeak && noSnapshotLeak && noReplayLeak && noBatchLeak).toBe(
      true,
    );
  });

  it('forbids Host-to-client request/cancel on the client outbound union', () => {
    type Forbidden = Extract<
      HostClientOutboundFrame['type'],
      'client-tool/request' | 'client-tool/cancel'
    >;
    type AllowedResult = Extract<HostClientOutboundFrame['type'], 'client-tool/result'>;
    type AllowedCaps = Extract<HostClientOutboundFrame['type'], 'client-tool/capabilities'>;
    const noHostToClient: Forbidden extends never ? true : false = true;
    const hasResult: AllowedResult extends never ? false : true = true;
    const hasCaps: AllowedCaps extends never ? false : true = true;
    expect(noHostToClient && hasResult && hasCaps).toBe(true);
  });
});
