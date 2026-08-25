import { describe, expect, it } from 'vitest';
import {
  APPLE_HEALTH_METRIC_IDS,
  APPLE_HEALTH_MAX_RECORDS,
  APPLE_HEALTH_MAX_TOTAL_WINDOW_DAYS,
  CONNECTED_SOURCE_APPLE_HEALTH_LABEL,
  HEALTH_TOOL_CARD_STATUSES,
  isAppleHealthConnectedSourceRef,
  isAppleHealthMetricId,
  parseHealthReadContextArguments,
  parseAppleHealthReadResultV1,
  appleHealthMetricUnit,
  projectBoundedHealthToolCardSummary,
  resolveHealthToolCardStatus,
} from './apple-health.js';
import { isHostToolPermissionAction } from './tool-registration.js';
import type { SessionToolFamily } from './session-capability.js';
import { TOOL_KINDS, isToolKind, type ToolKind } from './host.js';
import { isHealthSensitiveToolResult, type ToolResultDetails } from './tool-result.js';

describe('apple health v1 contracts', () => {
  it('freezes the eight M1 metric IDs and canonical units', () => {
    expect([...APPLE_HEALTH_METRIC_IDS]).toEqual([
      'steps',
      'active-energy',
      'exercise-minutes',
      'workouts',
      'sleep-duration',
      'sleep-stages',
      'resting-heart-rate',
      'heart-rate-variability',
    ]);
    expect(APPLE_HEALTH_MAX_TOTAL_WINDOW_DAYS).toBe(90);
    expect(APPLE_HEALTH_MAX_RECORDS).toBe(720);
    expect(isAppleHealthMetricId('steps')).toBe(true);
    expect(isAppleHealthMetricId('blood-pressure')).toBe(false);
    expect(appleHealthMetricUnit('steps')).toBe('count');
    expect(appleHealthMetricUnit('active-energy')).toBe('kcal');
    expect(appleHealthMetricUnit('exercise-minutes')).toBe('minute');
    expect(appleHealthMetricUnit('workouts')).toBe('minute');
    expect(appleHealthMetricUnit('sleep-duration')).toBe('minute');
    expect(appleHealthMetricUnit('sleep-stages')).toBe('minute');
    expect(appleHealthMetricUnit('resting-heart-rate')).toBe('bpm');
    expect(appleHealthMetricUnit('heart-rate-variability')).toBe('ms');
  });

  it('parses health arguments and enforces unique metrics and the 90-day total window', () => {
    const last7 = parseHealthReadContextArguments({
      metrics: ['steps', 'sleep-duration'],
      range: { preset: 'last-7-days' },
    });
    expect(last7.ok).toBe(true);

    expect(
      parseHealthReadContextArguments({
        metrics: ['steps', 'steps'],
        range: { preset: 'today' },
      }).ok,
    ).toBe(false);

    expect(
      parseHealthReadContextArguments({
        metrics: [],
        range: { preset: 'today' },
      }).ok,
    ).toBe(false);

    const customOk = parseHealthReadContextArguments({
      metrics: ['steps'],
      range: { preset: 'custom', startDate: '2026-05-26', endDateExclusive: '2026-08-24' },
    });
    expect(customOk.ok).toBe(true);

    expect(
      parseHealthReadContextArguments({
        metrics: ['steps'],
        range: { preset: 'custom', startDate: '2026-05-25', endDateExclusive: '2026-08-24' },
        includePreviousPeriod: false,
      }).ok,
    ).toBe(false);

    expect(
      parseHealthReadContextArguments({
        metrics: ['steps'],
        range: { preset: 'last-30-days' },
        includePreviousPeriod: true,
      }).ok,
    ).toBe(true);

    expect(
      parseHealthReadContextArguments({
        metrics: ['steps'],
        range: { preset: 'custom', startDate: '2026-01-01', endDateExclusive: '2026-06-01' },
        includePreviousPeriod: true,
      }).ok,
    ).toBe(false);

    expect(
      parseHealthReadContextArguments({
        metrics: ['steps'],
        range: { preset: 'custom', startDate: '2026-08-24', endDateExclusive: '2026-08-23' },
      }).ok,
    ).toBe(false);

    expect(
      parseHealthReadContextArguments({
        metrics: ['glucose'],
        range: { preset: 'today' },
      }).ok,
    ).toBe(false);
  });

  it('validates normalized results and rejects unrequested metrics, mixed units, and duplicates', () => {
    const result = parseAppleHealthReadResultV1(
      {
        schemaVersion: 1,
        source: 'apple-health',
        timeZone: 'Asia/Shanghai',
        startAt: '2026-08-16T16:00:00.000Z',
        endAt: '2026-08-23T16:00:00.000Z',
        generatedAt: '2026-08-23T12:00:00.000Z',
        records: [
          {
            metric: 'steps',
            localDate: '2026-08-22',
            unit: 'count',
            value: 8123,
            sampleCount: 4,
            freshAsOf: '2026-08-23T08:00:00.000Z',
          },
        ],
        unavailableMetrics: [
          { metric: 'sleep-duration', reason: 'not-authorized-or-no-data' },
        ],
        warnings: ['partial-result'],
      },
      {
        requestedMetrics: ['steps', 'sleep-duration'],
        localDates: ['2026-08-22'],
      },
    );
    expect(result.ok).toBe(true);

    expect(
      parseAppleHealthReadResultV1(
        {
          schemaVersion: 1,
          source: 'apple-health',
          timeZone: 'Asia/Shanghai',
          startAt: '2026-08-16T16:00:00.000Z',
          endAt: '2026-08-23T16:00:00.000Z',
          generatedAt: '2026-08-23T12:00:00.000Z',
          records: [
            {
              metric: 'resting-heart-rate',
              localDate: '2026-08-22',
              unit: 'bpm',
              value: 58,
              freshAsOf: '2026-08-23T08:00:00.000Z',
            },
          ],
          unavailableMetrics: [],
          warnings: [],
        },
        { requestedMetrics: ['steps'] },
      ).ok,
    ).toBe(false);

    expect(
      parseAppleHealthReadResultV1({
        schemaVersion: 1,
        source: 'apple-health',
        timeZone: 'Asia/Shanghai',
        startAt: '2026-08-16T16:00:00.000Z',
        endAt: '2026-08-23T16:00:00.000Z',
        generatedAt: '2026-08-23T12:00:00.000Z',
        records: [
          {
            metric: 'workouts',
            localDate: '2026-08-22',
            unit: 'minute',
            value: 40,
            sampleCount: 2,
            components: { walking: 20, running: 20, energy: 300 },
            freshAsOf: '2026-08-23T08:00:00.000Z',
          },
        ],
        unavailableMetrics: [],
        warnings: [],
      }).ok,
    ).toBe(false);

    expect(
      parseAppleHealthReadResultV1({
        schemaVersion: 1,
        source: 'apple-health',
        timeZone: 'Asia/Shanghai',
        startAt: '2026-08-16T16:00:00.000Z',
        endAt: '2026-08-23T16:00:00.000Z',
        generatedAt: '2026-08-23T12:00:00.000Z',
        records: [
          {
            metric: 'steps',
            localDate: '2026-08-22',
            unit: 'count',
            value: 10,
            freshAsOf: '2026-08-23T08:00:00.000Z',
          },
          {
            metric: 'steps',
            localDate: '2026-08-22',
            unit: 'count',
            value: 11,
            freshAsOf: '2026-08-23T08:00:00.000Z',
          },
        ],
        unavailableMetrics: [],
        warnings: [],
      }).ok,
    ).toBe(false);

    expect(
      parseAppleHealthReadResultV1({
        schemaVersion: 1,
        source: 'apple-health',
        timeZone: 'Asia/Shanghai',
        startAt: '2026-08-16T16:00:00.000Z',
        endAt: '2026-08-23T16:00:00.000Z',
        generatedAt: '2026-08-23T12:00:00.000Z',
        records: [
          {
            metric: 'steps',
            localDate: '2026-08-22',
            unit: 'count',
            value: Number.NaN,
            freshAsOf: '2026-08-23T08:00:00.000Z',
          },
        ],
        unavailableMetrics: [],
        warnings: [],
      }).ok,
    ).toBe(false);

    expect(
      parseAppleHealthReadResultV1({
        schemaVersion: 1,
        source: 'apple-health',
        timeZone: 'Asia/Shanghai',
        startAt: '2026-08-16T16:00:00.000Z',
        endAt: '2026-08-23T16:00:00.000Z',
        generatedAt: '2026-08-23T12:00:00.000Z',
        records: [
          {
            metric: 'steps',
            localDate: '2026-08-22',
            unit: 'count',
            value: 10,
            uuid: 'HK-OBJECT-1',
            sourceName: "Yorick's iPhone",
            freshAsOf: '2026-08-23T08:00:00.000Z',
          },
        ],
        unavailableMetrics: [],
        warnings: [],
      }).ok,
    ).toBe(false);
  });

  it('registers the Host tool family, permission action, and health presentation kinds', () => {
    const family: SessionToolFamily = 'device-health';
    const kind: ToolKind = 'health';
    const details: ToolResultDetails = { sensitivity: 'health' };
    expect(family).toBe('device-health');
    expect(kind).toBe('health');
    expect(TOOL_KINDS).toContain('health');
    expect(isToolKind('health')).toBe(true);
    expect(isToolKind('other')).toBe(true);
    expect(isToolKind('unknown-kind')).toBe(false);
    expect(HEALTH_TOOL_CARD_STATUSES).toContain('waiting-for-phone');
    expect(details.sensitivity).toBe('health');
    expect(isHealthSensitiveToolResult(details)).toBe(true);
    expect(isHealthSensitiveToolResult({ kind: 'health' })).toBe(true);
    expect(isHealthSensitiveToolResult({ kind: 'shell' })).toBe(false);
    expect(isHostToolPermissionAction('device:health-read')).toBe(true);
  });

  it('defaults Health cards without status to waiting-for-phone, never completed', () => {
    expect(resolveHealthToolCardStatus({ kind: 'health' })).toBe('waiting-for-phone');
    expect(resolveHealthToolCardStatus({ kind: 'health' }, 'running')).toBe('waiting-for-phone');
    expect(resolveHealthToolCardStatus({ kind: 'health' }, 'error')).toBe('failed');
    expect(
      resolveHealthToolCardStatus({ kind: 'health', health: { status: 'denied' } }, 'done'),
    ).toBe('denied');
  });

  it('rejects future custom ranges before a broker call', () => {
    expect(
      parseHealthReadContextArguments({
        metrics: ['steps'],
        range: { preset: 'custom', startDate: '2099-01-01', endDateExclusive: '2099-01-08' },
      }).ok,
    ).toBe(false);
  });

  it('projects a bounded Health card and drops series, UUIDs, and output', () => {
    const projected = projectBoundedHealthToolCardSummary({
      metrics: ['steps', 'sleep-duration', 'not-a-metric', 'steps'],
      periodLabel: '近 7 天',
      status: 'completed',
      freshnessLabel: '08:42',
      timezone: 'Asia/Shanghai',
      unavailableMetrics: ['heart-rate-variability', 'bogus'],
      warnings: ['partial-result', 'not-a-warning'],
      records: [{ uuid: 'HK-SECRET', value: 1111 }],
      output: 'sleep-duration 420 min',
      error: 'healthkit-query-failed',
    });
    expect(projected).toEqual({
      metrics: ['steps', 'sleep-duration'],
      periodLabel: '近 7 天',
      status: 'completed',
      freshnessLabel: '08:42',
      timezone: 'Asia/Shanghai',
      unavailableMetrics: ['heart-rate-variability'],
      warnings: ['partial-result'],
    });
    expect(JSON.stringify(projected)).not.toContain('HK-SECRET');
    expect(JSON.stringify(projected)).not.toContain('1111');
    expect(JSON.stringify(projected)).not.toContain('sleep-duration 420');
    expect(projectBoundedHealthToolCardSummary({ status: 'completed' })).toBeUndefined();
  });

  it('accepts only the exact Apple Health connected-source ref', () => {
    expect(CONNECTED_SOURCE_APPLE_HEALTH_LABEL).toBe('Apple Health');
    expect(
      isAppleHealthConnectedSourceRef({
        kind: 'connected-source',
        source: 'apple-health',
        label: 'Apple Health',
      }),
    ).toBe(true);
    expect(
      isAppleHealthConnectedSourceRef({
        kind: 'connected-source',
        source: 'apple-health',
        label: 'Health',
      }),
    ).toBe(false);
    expect(
      isAppleHealthConnectedSourceRef({
        kind: 'connected-source',
        source: 'google-fit',
        label: 'Apple Health',
      }),
    ).toBe(false);
  });
});
