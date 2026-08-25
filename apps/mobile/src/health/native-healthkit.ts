import { invoke } from '@tauri-apps/api/core';
import type { AppleHealthReadResultV1, ClientToolRequestFrame } from '@piwin/contracts';
import {
  APPLE_HEALTH_METRIC_IDS,
  parseAppleHealthReadResultV1,
  parseHealthReadContextArguments,
} from '@piwin/contracts';
import { redactHealthRecord } from './apple-health-aggregation.js';

export async function healthkitIsAvailable(): Promise<boolean> {
  try {
    return (await invoke<boolean>('plugin:piwin-healthkit|healthkit_is_available')) === true;
  } catch {
    return false;
  }
}

export async function healthkitReadContext(
  request: ClientToolRequestFrame,
): Promise<AppleHealthReadResultV1> {
  const args = parseHealthReadContextArguments(request.arguments);
  if (!args.ok) {
    throw new Error(args.reason);
  }
  let raw: unknown;
  try {
    raw = await invoke<unknown>('plugin:piwin-healthkit|healthkit_read_context', {
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
  const record = raw as Record<string, unknown>;
  if (Array.isArray(record.records)) {
    record.records = record.records.map((item) =>
      typeof item === 'object' && item !== null
        ? redactHealthRecord(item as Record<string, unknown>)
        : item,
    );
  }
  const parsed = parseAppleHealthReadResultV1(record, {
    requestedMetrics: args.value.metrics,
  });
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }
  return parsed.value;
}

export async function healthkitCancelRead(requestId: string): Promise<void> {
  await invoke('plugin:piwin-healthkit|healthkit_cancel_read', { requestId });
}

export async function healthkitRequestReadAuthorization(
  metrics: readonly string[] = APPLE_HEALTH_METRIC_IDS,
): Promise<void> {
  await invoke('plugin:piwin-healthkit|healthkit_request_read_authorization', {
    metrics: [...metrics],
  });
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
