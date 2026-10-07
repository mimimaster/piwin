/**
 * Background summary sync, device side (ADR 0062 M2). The native layer does
 * the work without a WebView; this module only tells it where to upload and
 * as whom, and reads back how the last upload went.
 */
import type { TrustedDeviceCredential } from '@piwin/contracts';
import { APPLE_HEALTH_METRIC_IDS, HEALTH_SUMMARY_SYNC_PATH } from '@piwin/contracts';
import type { HealthKitInvoke } from './healthkit-bridge.js';

export type HealthBackgroundSyncStatus = {
  enabled: boolean;
  lastSyncAt?: string;
  /** Stable code from the native layer, e.g. `host-unreachable`, `host-status-403`. */
  lastError?: string;
};

export type HealthBackgroundSyncBridge = {
  status(): Promise<HealthBackgroundSyncStatus>;
  /** Hands the pairing credential to the native layer and starts observing. */
  enable(endpoint: string, credential: TrustedDeviceCredential): Promise<HealthBackgroundSyncStatus>;
  /** Stops observing and removes the credential copy the native layer held. */
  disable(): Promise<HealthBackgroundSyncStatus>;
  syncNow(): Promise<HealthBackgroundSyncStatus>;
};

/**
 * The HTTP address of the Host's sync endpoint, derived from the paired
 * WebSocket endpoint's origin. Undefined when the endpoint is not a
 * WebSocket URL.
 */
export function healthSummarySyncUrl(endpoint: string): string | undefined {
  let url: URL;
  try {
    url = new URL(endpoint.trim());
  } catch {
    return undefined;
  }
  const protocol = url.protocol === 'wss:' ? 'https:' : url.protocol === 'ws:' ? 'http:' : undefined;
  if (protocol === undefined || url.username !== '' || url.password !== '') {
    return undefined;
  }
  return `${protocol}//${url.host}${HEALTH_SUMMARY_SYNC_PATH}`;
}

export function createHealthBackgroundSyncBridge(invoke: HealthKitInvoke): HealthBackgroundSyncBridge {
  return {
    async status() {
      try {
        return readStatus(await invoke('plugin:piwin-healthkit|healthkit_background_sync_status'));
      } catch {
        return { enabled: false };
      }
    },
    async enable(endpoint, credential) {
      const syncUrl = healthSummarySyncUrl(endpoint);
      if (syncUrl === undefined) {
        throw new Error('The Host address cannot be used for background sync');
      }
      return readStatus(
        await invoke('plugin:piwin-healthkit|healthkit_background_sync_configure', {
          config: {
            syncUrl,
            deviceId: credential.deviceId,
            deviceSecret: credential.deviceSecret,
            metrics: [...APPLE_HEALTH_METRIC_IDS],
          },
        }),
      );
    },
    async disable() {
      return readStatus(
        await invoke('plugin:piwin-healthkit|healthkit_background_sync_configure', { config: null }),
      );
    },
    async syncNow() {
      return readStatus(await invoke('plugin:piwin-healthkit|healthkit_background_sync_now'));
    },
  };
}

function readStatus(value: unknown): HealthBackgroundSyncStatus {
  if (typeof value !== 'object' || value === null) {
    return { enabled: false };
  }
  const record = value as Record<string, unknown>;
  const status: HealthBackgroundSyncStatus = { enabled: record.enabled === true };
  if (typeof record.lastSyncAt === 'string') {
    status.lastSyncAt = record.lastSyncAt;
  }
  if (typeof record.lastError === 'string') {
    status.lastError = record.lastError.slice(0, 64);
  }
  return status;
}
