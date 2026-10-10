/**
 * Apple Health as a device tool of the mobile shell (ADR 0062).
 *
 * The Host asks this device to read a health summary; the read, the consent
 * prompt and the consent preferences all stay on the phone. This module owns
 * that device-side state for the workbench: it attaches the shared client-tool
 * runtime to the live Host client and exposes one snapshot for the settings
 * card, the composer entry and the consent dialog.
 *
 * Outside the mobile shell nothing is attached and the snapshot stays
 * `available: false`.
 */
import type { ClientToolRequestFrame, HealthSummaryStatus } from '@piwin/contracts';
import {
  advertiseMobileHealthRuntime,
  attachMobileClientToolRuntime,
  createHealthBackgroundSyncBridge,
  createHealthKitBridge,
  createLocalClientToolPreferenceStore,
  healthConsentScopeKey,
  healthExecutorUsable,
  readHealthConnectedSetting,
  resolveMobileHealthDeviceId,
  writeForegroundUseMode,
  writeHealthConnectedSetting,
  type HealthBackgroundSyncBridge,
  type HealthBackgroundSyncStatus,
  type HealthForegroundUseMode,
  type HealthKitBridge,
  type HealthKitInvoke,
  type HostClient,
  type MobileClientToolConsentDecision,
  type MobileClientToolRuntime,
} from '@piwin/host-client';
import { peekDeviceCredential } from './device-admission.js';
import { isMobileTauriRuntime } from './shell-runtime.js';

/** Why Apple Health is, or is not, usable right now. */
export type DeviceHealthStatus =
  /** No Host client is attached (not the mobile shell, or not connected yet). */
  | 'detached'
  | 'ready'
  /** This device has no Apple Health store. */
  | 'no-healthkit'
  /** The connected Host does not accept device tools. */
  | 'host-unsupported'
  /** This device is not paired; the Host only takes tools from enrolled devices. */
  | 'unpaired'
  | 'failed';

export type DeviceHealthSnapshot = {
  status: DeviceHealthStatus;
  /** This device can read Apple Health and the Host accepts device tools. */
  available: boolean;
  /** The user connected Apple Health to Piwin on this device. */
  connected: boolean;
  useMode: HealthForegroundUseMode;
  /** Connected, not switched off: a turn may ask for health data. */
  enabled: boolean;
  /** A read is waiting for the user's decision. */
  consentRequest: ClientToolRequestFrame | undefined;
  alwaysAllowUnlocked: boolean;
  /** Background summary sync from this device to the Host (ADR 0062 M2). */
  backgroundSync: DeviceHealthBackgroundSync;
};

export type DeviceHealthBackgroundSync = HealthBackgroundSyncStatus & {
  /** The Host keeps uploaded summaries; without it there is nowhere to sync to. */
  hostStorageEnabled: boolean;
};

const UNAVAILABLE: DeviceHealthSnapshot = {
  status: 'detached',
  available: false,
  connected: false,
  useMode: 'ask-every-time',
  enabled: false,
  consentRequest: undefined,
  alwaysAllowUnlocked: false,
  backgroundSync: { enabled: false, hostStorageEnabled: false },
};

type Attachment = {
  client: HostClient;
  runtime: MobileClientToolRuntime;
  scopeKey: string;
  endpoint: string;
};

const preferences = createLocalClientToolPreferenceStore();
const listeners = new Set<() => void>();
let snapshot: DeviceHealthSnapshot = UNAVAILABLE;
let attachment: Attachment | undefined;
let consentResolver: ((decision: MobileClientToolConsentDecision) => void) | undefined;
let bridge: HealthKitBridge | undefined;
let backgroundSyncBridge: HealthBackgroundSyncBridge | undefined;

const tauriInvoke: HealthKitInvoke = async (command, args) => {
  const { invoke } = await import('@tauri-apps/api/core');
  return args === undefined ? invoke(command) : invoke(command, args);
};

function healthKit(): HealthKitBridge {
  if (bridge === undefined) {
    bridge = createHealthKitBridge(tauriInvoke);
  }
  return bridge;
}

function backgroundSync(): HealthBackgroundSyncBridge {
  if (backgroundSyncBridge === undefined) {
    backgroundSyncBridge = createHealthBackgroundSyncBridge(tauriInvoke);
  }
  return backgroundSyncBridge;
}

function publish(next: Partial<Omit<DeviceHealthSnapshot, 'available' | 'enabled'>>): void {
  const merged = { ...snapshot, ...next };
  const available = merged.status === 'ready';
  snapshot = {
    ...merged,
    available,
    enabled: available && merged.connected && merged.useMode !== 'off',
  };
  for (const listener of listeners) {
    listener();
  }
}

export function getDeviceHealthSnapshot(): DeviceHealthSnapshot {
  return snapshot;
}

export function subscribeDeviceHealth(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Bind Apple Health to a live Host client. Safe to call for every remote
 * client: it does nothing outside the mobile shell. Returns the detach handle.
 */
export function attachDeviceHealth(client: HostClient, endpoint: string): () => void {
  if (!isMobileTauriRuntime()) {
    return () => {};
  }
  let disposed = false;
  let starting = false;
  let own: Attachment | undefined;

  async function start(): Promise<void> {
    const hello = client.getHostHello();
    if (disposed || starting || own !== undefined || hello === undefined) {
      return;
    }
    starting = true;
    try {
      const nativeAvailable = await healthKit().isAvailable();
      const paired = readPairedDeviceId(endpoint, hello.deviceId);
      const deviceId = resolveMobileHealthDeviceId({
        ...paired,
        clientId: client.getClientId(),
      });
      const scopeKey = await healthConsentScopeKey(endpoint, deviceId);
      if (disposed) {
        return;
      }
      const grant = preferences.read(scopeKey);
      const connected = readHealthConnectedSetting();
      const usable = healthExecutorUsable({
        nativeAvailable,
        production: import.meta.env.PROD === true,
        allowFake: import.meta.env.DEV === true,
      });
      const runtime = attachMobileClientToolRuntime({
        client,
        endpoint,
        deviceId,
        preferences,
        healthEnabled: connected && grant?.mode !== 'off',
        nativeHealthAvailable: nativeAvailable,
        healthKit: healthKit(),
        production: import.meta.env.PROD === true,
        allowFakeHealth: import.meta.env.DEV === true,
        requestConsent: (request) => askForConsent(request, scopeKey),
      });
      own = { client, runtime, scopeKey, endpoint };
      attachment = own;
      publish({
        status: !usable
          ? 'no-healthkit'
          : !client.supportsClientToolRequests()
            ? 'host-unsupported'
            : paired.deviceId === undefined
              ? 'unpaired'
              : 'ready',
        connected,
        useMode: grant?.mode ?? 'ask-every-time',
        alwaysAllowUnlocked: grant?.alwaysAllowUnlocked === true,
      });
      await advertise(client, runtime);
      void refreshBackgroundSync(own, { syncIfEnabled: true });
    } catch (error) {
      console.warn('[piwin] Apple Health device tool failed to start', error);
      publish({ status: 'failed' });
    } finally {
      starting = false;
    }
  }

  const unsubscribeState = client.subscribeState((state) => {
    if (own === undefined) {
      void start();
      return;
    }
    // A reconnect is a new hello; the Host forgets what this device offered.
    if (state.kind === 'ready') {
      void advertise(client, own.runtime);
    }
  });
  void start();

  return () => {
    disposed = true;
    unsubscribeState();
    own?.runtime.stop();
    if (attachment === own) {
      attachment = undefined;
      settleConsent('deny');
      snapshot = UNAVAILABLE;
      for (const listener of listeners) {
        listener();
      }
    }
  };
}

/**
 * Offer the tool to the Host. Device-tool frames are only accepted on a ready
 * connection; during journal catch-up the offer is skipped, and the `ready`
 * state change sends it.
 */
async function advertise(client: HostClient, runtime: MobileClientToolRuntime): Promise<void> {
  if (client.getState().kind !== 'ready') {
    return;
  }
  try {
    await advertiseMobileHealthRuntime(runtime);
  } catch (error) {
    console.warn('[piwin] Apple Health offer was not delivered', error);
  }
}

function readPairedDeviceId(endpoint: string, helloDeviceId: string | undefined): { deviceId?: string } {
  const deviceId = peekDeviceCredential(endpoint)?.deviceId ?? helloDeviceId;
  return deviceId === undefined ? {} : { deviceId };
}

function askForConsent(
  request: ClientToolRequestFrame,
  scopeKey: string,
): Promise<MobileClientToolConsentDecision> {
  // One prompt at a time: a second read while one is pending is refused rather
  // than silently replacing the question the user is looking at.
  if (consentResolver !== undefined) {
    return Promise.resolve('deny');
  }
  return new Promise<MobileClientToolConsentDecision>((resolve) => {
    consentResolver = resolve;
    publish({
      consentRequest: request,
      alwaysAllowUnlocked: preferences.read(scopeKey)?.alwaysAllowUnlocked === true,
    });
  });
}

function settleConsent(decision: MobileClientToolConsentDecision): void {
  const resolve = consentResolver;
  consentResolver = undefined;
  resolve?.(decision);
}

export function resolveDeviceHealthConsent(decision: MobileClientToolConsentDecision): void {
  settleConsent(decision);
  publish({ consentRequest: undefined });
  const current = attachment;
  if (current !== undefined) {
    const grant = preferences.read(current.scopeKey);
    if (grant !== undefined) {
      publish({ useMode: grant.mode, alwaysAllowUnlocked: grant.alwaysAllowUnlocked });
    }
  }
}

/** Ask iOS for read access, then offer the tool to the Host. Throws on refusal. */
export async function connectDeviceHealth(): Promise<void> {
  const current = attachment;
  if (current === undefined) {
    throw new Error('Apple Health is not available on this device');
  }
  if (await healthKit().isAvailable()) {
    await healthKit().requestReadAuthorization();
  }
  writeHealthConnectedSetting(true);
  const useMode = snapshot.useMode === 'off' ? 'ask-every-time' : snapshot.useMode;
  if (useMode !== snapshot.useMode) {
    writeForegroundUseMode(preferences, current.scopeKey, useMode);
  }
  current.runtime.setHealthEnabled(true);
  publish({ connected: true, useMode });
  await advertise(current.client, current.runtime);
}

/**
 * Read both halves of background sync: whether the Host keeps summaries, and
 * what the native layer last did. Opening the app is also a chance to upload
 * whatever a missed background wake left behind.
 */
async function refreshBackgroundSync(
  current: Attachment,
  options: { syncIfEnabled?: boolean } = {},
): Promise<void> {
  try {
    const [nativeStatus, hostStorageEnabled] = await Promise.all([
      backgroundSync().status(),
      readHostStorageEnabled(current.client),
    ]);
    if (attachment !== current) {
      return;
    }
    let native = nativeStatus;
    // Background uploads ride on the connection that recorded the user's
    // sharing consent. Sync left on from before that consent stops here.
    if (native.enabled && !readHealthConnectedSetting()) {
      native = await backgroundSync().disable();
    }
    publish({ backgroundSync: { ...native, hostStorageEnabled } });
    if (options.syncIfEnabled === true && native.enabled && hostStorageEnabled) {
      const synced = await backgroundSync().syncNow();
      if (attachment === current) {
        publish({ backgroundSync: { ...synced, hostStorageEnabled } });
      }
    }
  } catch (error) {
    console.warn('[piwin] Apple Health background sync status is unavailable', error);
  }
}

async function readHostStorageEnabled(client: HostClient): Promise<boolean> {
  if (client.getState().kind !== 'ready') {
    return false;
  }
  const response = await client.request({ type: 'health/status' });
  return response.success && (response.data as HealthSummaryStatus | undefined)?.storageEnabled === true;
}

/**
 * Turn background sync on or off for this device. Turning it off also removes
 * what this device had uploaded: the switch is the user's consent to storage,
 * not just to future uploads.
 */
export async function setDeviceHealthBackgroundSync(enabled: boolean): Promise<void> {
  const current = attachment;
  if (current === undefined) {
    throw new Error('Apple Health is not available on this device');
  }
  if (!enabled) {
    const credential = peekDeviceCredential(current.endpoint);
    await backgroundSync().disable();
    if (credential !== undefined) {
      await current.client.request({ type: 'health/delete-summaries', deviceId: credential.deviceId });
    }
    await refreshBackgroundSync(current);
    return;
  }
  const credential = peekDeviceCredential(current.endpoint);
  if (credential === undefined) {
    throw new Error('This device is not paired with the Host');
  }
  // New categories may never have been asked for; the upload covers all of them.
  await healthKit().requestReadAuthorization();
  await backgroundSync().enable(current.endpoint, credential);
  await refreshBackgroundSync(current, { syncIfEnabled: true });
}

export async function disconnectDeviceHealth(): Promise<void> {
  writeHealthConnectedSetting(false);
  if (snapshot.backgroundSync.enabled) {
    await setDeviceHealthBackgroundSync(false).catch((error: unknown) => {
      console.warn('[piwin] Apple Health background sync could not be turned off', error);
    });
  }
  const current = attachment;
  if (current !== undefined) {
    current.runtime.setHealthEnabled(false);
    preferences.clear(current.scopeKey);
    await advertise(current.client, current.runtime);
  }
  publish({ connected: false, useMode: 'ask-every-time', alwaysAllowUnlocked: false });
}

export function setDeviceHealthUseMode(mode: HealthForegroundUseMode): void {
  const current = attachment;
  if (current === undefined) {
    return;
  }
  writeForegroundUseMode(preferences, current.scopeKey, mode);
  current.runtime.setHealthEnabled(mode !== 'off' && snapshot.connected);
  publish({ useMode: mode });
  void advertise(current.client, current.runtime);
}
