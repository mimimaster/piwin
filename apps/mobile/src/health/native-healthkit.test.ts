import { describe, expect, it } from 'vitest';
import { APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID } from '@piwin/contracts';
import { healthkitReadContext, readHealthKitInvokeCode } from './native-healthkit.js';

describe('native HealthKit bridge', () => {
  it('rejects malformed arguments before invoking HealthKit', async () => {
    await expect(
      healthkitReadContext({
        type: 'client-tool/request',
        requestId: 'req-1',
        capabilityId: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID,
        sessionId: 'session-1',
        runId: 'run-1',
        toolCallId: 'tool-1',
        arguments: { metrics: [], range: { preset: 'today' } },
        deadlineAt: '2026-08-23T12:02:00.000Z',
        timeoutMs: 5_000,
        display: {
          title: '读取 Apple Health',
          metricLabels: ['步数'],
          periodLabel: '今天',
          explicitTurnIntent: false,
        },
      }),
    ).rejects.toThrow(/metrics/i);
  });

  it('maps native reject codes onto client-tool error codes', () => {
    expect(readHealthKitInvokeCode(new Error('healthkit-no-accessible-data'))).toBe(
      'healthkit-no-accessible-data',
    );
    expect(readHealthKitInvokeCode(new Error('cancelled'))).toBe('cancelled');
    expect(readHealthKitInvokeCode(new Error('healthkit-unavailable'))).toBe(
      'healthkit-unavailable',
    );
    expect(readHealthKitInvokeCode(new Error('HKErrorDomain code=5'))).toBe(
      'healthkit-query-failed',
    );
  });
});
