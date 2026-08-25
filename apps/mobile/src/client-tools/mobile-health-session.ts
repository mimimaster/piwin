import type {
  ClientToolCapabilityAdvertisement,
  ClientToolRequestFrame,
  HostClientCapabilities,
} from '@piwin/contracts';
import { APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import {
  createMemoryClientToolPreferenceStore,
  type ClientToolPreferenceStore,
  type HealthConsentGrant,
  type HealthForegroundUseMode,
} from './client-tool-preferences.js';
import { isFakeHealthExecutorAllowed } from './fake-health-executor.js';
import {
  MobileClientToolRuntime,
  type MobileClientToolConsentDecision,
} from './mobile-client-tool-runtime.js';

const HEALTH_CONNECTED_KEY = 'piwin.mobile.health.connected';
const HEALTH_GRANT_PREFIX = 'piwin.mobile.health.grant.';

export function buildMobileHelloCapabilities(input: {
  advertiseHealth: boolean;
}): HostClientCapabilities {
  const capabilities: HostClientCapabilities = {
    pushBatching: true,
    cursorBatches: true,
    boundedReplay: true,
    hydration: true,
    liveSubscriptions: true,
  };
  if (!input.advertiseHealth) {
    return capabilities;
  }
  return {
    ...capabilities,
    clientTools: [{ id: APPLE_HEALTH_READ_CONTEXT_CAPABILITY_ID, version: 1 }],
  };
}

export function shouldAdvertiseHealthOnHello(input: {
  healthConnected: boolean;
  nativeAvailable: boolean;
  production: boolean;
  allowFake: boolean;
}): boolean {
  if (!input.healthConnected) {
    return false;
  }
  return healthExecutorUsable(input);
}

export function healthExecutorUsable(input: {
  nativeAvailable: boolean;
  production: boolean;
  allowFake: boolean;
}): boolean {
  return (
    input.nativeAvailable ||
    isFakeHealthExecutorAllowed({
      production: input.production,
      allowFake: input.allowFake,
    })
  );
}

export function resolveMobileHealthDeviceId(input: {
  deviceId?: string;
  clientId: string;
}): string {
  const deviceId = input.deviceId?.trim();
  return deviceId !== undefined && deviceId.length > 0 ? deviceId : input.clientId;
}

export function shouldIncludeAppleHealthOnSend(input: {
  healthEnabled: boolean;
  includeAppleHealth: boolean;
}): boolean {
  return input.healthEnabled && input.includeAppleHealth;
}

export function isMobileAppActive(): boolean {
  if (typeof document === 'undefined') {
    return true;
  }
  return document.visibilityState === 'visible';
}

export function readHealthConnectedSetting(): boolean {
  return getLocalStorage()?.getItem(HEALTH_CONNECTED_KEY) === '1';
}

export function writeHealthConnectedSetting(connected: boolean): void {
  const storage = getLocalStorage();
  if (storage === undefined) {
    return;
  }
  if (connected) {
    storage.setItem(HEALTH_CONNECTED_KEY, '1');
    return;
  }
  storage.removeItem(HEALTH_CONNECTED_KEY);
}

export function createLocalClientToolPreferenceStore(): ClientToolPreferenceStore {
  const storage = getLocalStorage();
  if (storage === undefined) {
    return createMemoryClientToolPreferenceStore();
  }
  return {
    read(scopeKey) {
      const raw = storage.getItem(`${HEALTH_GRANT_PREFIX}${scopeKey}`);
      if (raw === null || raw.length === 0) {
        return undefined;
      }
      try {
        const parsed = JSON.parse(raw) as unknown;
        return isHealthConsentGrant(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    },
    write(scopeKey, grant) {
      storage.setItem(`${HEALTH_GRANT_PREFIX}${scopeKey}`, JSON.stringify(grant));
    },
    clear(scopeKey) {
      storage.removeItem(`${HEALTH_GRANT_PREFIX}${scopeKey}`);
    },
  };
}

export function attachMobileClientToolRuntime(options: {
  client: HostClient;
  endpoint: string;
  deviceId: string;
  preferences: ClientToolPreferenceStore;
  healthEnabled: boolean;
  nativeHealthAvailable: boolean;
  production: boolean;
  allowFakeHealth: boolean;
  requestConsent: (request: ClientToolRequestFrame) => Promise<MobileClientToolConsentDecision>;
}): MobileClientToolRuntime {
  const runtime = new MobileClientToolRuntime({
    client: options.client,
    endpoint: options.endpoint,
    deviceId: options.deviceId,
    preferences: options.preferences,
    isAppActive: isMobileAppActive,
    production: options.production,
    allowFakeHealth: options.allowFakeHealth,
    nativeHealthAvailable: options.nativeHealthAvailable,
    healthEnabled: options.healthEnabled,
    requestConsent: options.requestConsent,
  });
  runtime.start();
  return runtime;
}

export async function advertiseMobileHealthRuntime(
  runtime: MobileClientToolRuntime,
): Promise<readonly ClientToolCapabilityAdvertisement[]> {
  await runtime.advertise();
  return runtime.advertisedCapabilities();
}

export function writeForegroundUseMode(
  preferences: ClientToolPreferenceStore,
  scopeKey: string,
  mode: HealthForegroundUseMode,
): HealthConsentGrant {
  const current = preferences.read(scopeKey);
  const grant: HealthConsentGrant = {
    mode,
    alwaysAllowUnlocked: current?.alwaysAllowUnlocked === true,
    ...(current?.sessionId === undefined ? {} : { sessionId: current.sessionId }),
    ...(current?.destinationFingerprint === undefined
      ? {}
      : { destinationFingerprint: current.destinationFingerprint }),
  };
  preferences.write(scopeKey, grant);
  return grant;
}

function isHealthConsentGrant(value: unknown): value is HealthConsentGrant {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    (record.mode === 'off' ||
      record.mode === 'ask-every-time' ||
      record.mode === 'allow-for-session' ||
      record.mode === 'always-allow-this-host') &&
    typeof record.alwaysAllowUnlocked === 'boolean'
  );
}

function getLocalStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
