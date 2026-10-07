/**
 * HealthKit access through the shell's `piwin-healthkit` plugin (ADR 0062).
 * The caller supplies `invoke`; this package never imports Tauri. Results are
 * validated and redacted here so no shell can forward a raw native payload.
 */
import type { AppleHealthReadResultV1, ClientToolRequestFrame } from '@piwin/contracts';
import {
  APPLE_HEALTH_METRIC_IDS,
  computeHealthBaselines,
  formatLocalDateInTimeZone,
  isAppleHealthLocalDate,
  parseAppleHealthReadResultV1,
  parseHealthReadContextArguments,
} from '@piwin/contracts';
import { redactHealthRecord } from './apple-health-aggregation.js';

export type HealthKitInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export type HealthKitBridge = {
  isAvailable(): Promise<boolean>;
  readContext(request: ClientToolRequestFrame): Promise<AppleHealthReadResultV1>;
  cancelRead(requestId: string): Promise<void>;
  requestReadAuthorization(metrics?: readonly string[]): Promise<void>;
};

export function createHealthKitBridge(invoke: HealthKitInvoke): HealthKitBridge {
  return {
    async isAvailable() {
      try {
        return (await invoke('plugin:piwin-healthkit|healthkit_is_available')) === true;
      } catch {
        return false;
      }
    },
    async readContext(request) {
      const args = parseHealthReadContextArguments(request.arguments);
      if (!args.ok) {
        throw new Error(args.reason);
      }
      let raw: unknown;
      try {
        raw = await invoke('plugin:piwin-healthkit|healthkit_read_context', {
          request: {
            requestId: request.requestId,
            arguments: args.value,
          },
        });
      } catch (error) {
        throw new Error(readHealthKitInvokeCode(error));
      }
      if (typeof raw !== 'object' || raw === null) {
        throw new Error('healthkit-query-failed');
      }
      // The baseline days stay on the device: they are split off here and
      // only the statistics computed from them join the result.
      const { baselineRecords, baselineWindow, ...record } = raw as Record<string, unknown>;
      record.records = redactHealthRecords(record.records);
      const parsed = parseAppleHealthReadResultV1(record, {
        requestedMetrics: args.value.metrics,
      });
      if (!parsed.ok) {
        throw new Error(parsed.reason);
      }
      const result = parsed.value;
      const window = readBaselineWindow(baselineWindow);
      if (args.value.includeBaseline === true && window !== undefined) {
        const baselineDays = parseAppleHealthReadResultV1(
          {
            ...record,
            records: redactHealthRecords(baselineRecords),
            unavailableMetrics: [],
            warnings: [],
          },
          { requestedMetrics: args.value.metrics },
        );
        if (baselineDays.ok) {
          result.baselines = computeHealthBaselines({
            metrics: args.value.metrics,
            baselineRecords: baselineDays.value.records,
            records: result.records,
            window,
            latestLocalDate: window.endDateExclusive,
            todayLocalDate: formatLocalDateInTimeZone(
              new Date(result.generatedAt),
              result.timeZone,
            ),
          });
        }
      }
      return result;
    },
    async cancelRead(requestId) {
      await invoke('plugin:piwin-healthkit|healthkit_cancel_read', { requestId });
    },
    async requestReadAuthorization(metrics = APPLE_HEALTH_METRIC_IDS) {
      await invoke('plugin:piwin-healthkit|healthkit_request_read_authorization', {
        metrics: [...metrics],
      });
    },
  };
}

function redactHealthRecords(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) =>
    typeof item === 'object' && item !== null
      ? redactHealthRecord(item as Record<string, unknown>)
      : item,
  );
}

function readBaselineWindow(
  value: unknown,
): { startDate: string; endDateExclusive: string } | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const { startDate, endDateExclusive } = value as Record<string, unknown>;
  if (
    typeof startDate !== 'string' ||
    typeof endDateExclusive !== 'string' ||
    !isAppleHealthLocalDate(startDate) ||
    !isAppleHealthLocalDate(endDateExclusive) ||
    startDate >= endDateExclusive
  ) {
    return undefined;
  }
  return { startDate, endDateExclusive };
}

export function readHealthKitInvokeCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('healthkit-no-accessible-data')) {
    return 'healthkit-no-accessible-data';
  }
  if (message.includes('cancelled')) {
    return 'cancelled';
  }
  if (message.includes('healthkit-unavailable')) {
    return 'healthkit-unavailable';
  }
  return 'healthkit-query-failed';
}
