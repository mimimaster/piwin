import { describe, expect, it } from 'vitest';
import type { AppleHealthMetricId, AppleHealthRecord } from '@piwin/contracts';
import { createHealthKitBridge } from './healthkit-bridge.js';

const FRESH = '2026-10-07T04:00:00.000Z';
const WINDOW = { startDate: '2026-09-07', endDateExclusive: '2026-10-07' };

function day(offset: number): string {
  return new Date(Date.UTC(2026, 8, 7 + offset)).toISOString().slice(0, 10);
}

function daily(
  metric: AppleHealthMetricId,
  unit: AppleHealthRecord['unit'],
  values: readonly number[],
): AppleHealthRecord[] {
  return values.map((value, index) => ({
    metric,
    localDate: day(index),
    unit,
    value,
    freshAsOf: FRESH,
  }));
}

describe('HealthKit bridge baselines', () => {
  const request = (includeBaseline: boolean) => ({
    type: 'client-tool/request' as const,
    requestId: 'request-1',
    arguments: { metrics: ['steps'], range: { preset: 'today' }, includeBaseline },
  });
  const nativePayload = {
    schemaVersion: 1,
    source: 'apple-health',
    timeZone: 'Asia/Shanghai',
    startAt: '2026-10-06T16:00:00.000Z',
    endAt: '2026-10-07T16:00:00.000Z',
    generatedAt: FRESH,
    records: [{ metric: 'steps', localDate: '2026-10-07', unit: 'count', value: 4000, freshAsOf: FRESH }],
    unavailableMetrics: [],
    warnings: [],
    baselineRecords: daily('steps', 'count', [8000, 9000, 7000, 8000, 8500, 7500, 8000]).map((record) => ({
      ...record,
      uuid: 'must-be-dropped',
    })),
    baselineWindow: WINDOW,
  };

  it('turns baseline days into statistics and keeps the days on the device', async () => {
    const bridge = createHealthKitBridge(async () => structuredClone(nativePayload));
    const result = await bridge.readContext(request(true) as never);
    expect(result.records).toHaveLength(1);
    expect(result.baselines).toHaveLength(1);
    expect(result.baselines?.[0]).toMatchObject({
      metric: 'steps',
      sampleDays: 7,
      mean: 8000,
      latest: { localDate: '2026-10-07', value: 4000, deltaPercent: -50, partialDay: true },
    });
    expect(JSON.stringify(result)).not.toContain('baselineRecords');
    expect(JSON.stringify(result)).not.toContain('2026-09-07","unit');
  });

  it('drops baseline days when no baseline was requested', async () => {
    const bridge = createHealthKitBridge(async () => structuredClone(nativePayload));
    const result = await bridge.readContext(request(false) as never);
    expect(result.baselines).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('baselineRecords');
  });
});
