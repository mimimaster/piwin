/**
 * ADR 0101 §10 for the workbench: a shell still attached the old way (endpoint
 * + device credential or access token) moves itself onto the encrypted
 * channel once, without a new pairing code. It runs after the first render;
 * on success the saved target switches to the host id and the workbench
 * reconnects through the usual target-change listeners.
 *
 * An older Host, an unreachable one, or a failure leaves the legacy target
 * untouched and the next launch tries again.
 */
import {
  createChannelDialer,
  createLegacyConnector,
  dialPairedHost,
  isLoopbackHostEndpoint,
  migrateLegacyHost,
  type LegacyMigrationOutcome,
} from '@piwin/host-client';
import {
  describeThisDevice,
  forgetDeviceCredential,
  peekDeviceCredential,
} from '../devices/device-admission.js';
import { hasTauriBridge } from '../tool-cards/shell-runtime.js';
import {
  canPairOverChannel,
  channelHostBook,
  channelHostDisplayEndpoint,
  channelInnerSocketFactory,
  channelVault,
  primeChannelHost,
} from './channel-host-book.js';
import {
  DESKTOP_HOST_CLIENT_VERSION,
  desktopRemoteClientId,
  loadDesktopRemoteHostTarget,
  saveDesktopRemoteHostTarget,
  sameDesktopRemoteHostTarget,
  type DesktopRemoteHostTarget,
} from './remote-host-session.js';
import { createTauriHostWebSocket } from './tauri-host-websocket.js';

let running: Promise<LegacyMigrationOutcome | undefined> | undefined;

/** Whether this saved target is one the workbench should move onto the channel. */
export function isMigratableLegacyTarget(
  target: DesktopRemoteHostTarget | undefined,
  hasCredential: boolean,
): target is DesktopRemoteHostTarget {
  return (
    target !== undefined &&
    target.hostId === undefined &&
    !isLoopbackHostEndpoint(target.endpoint) &&
    (hasCredential || target.authToken !== undefined)
  );
}

/**
 * Migrates the saved legacy target if there is one. Device credentials must
 * already be primed (`primeDeviceCredential`). Concurrent calls share one run.
 */
export function migrateSavedLegacyTarget(): Promise<LegacyMigrationOutcome | undefined> {
  running ??= runMigration().finally(() => {
    running = undefined;
  });
  return running;
}

async function runMigration(): Promise<LegacyMigrationOutcome | undefined> {
  const target = loadDesktopRemoteHostTarget();
  const credential = target === undefined ? undefined : peekDeviceCredential(target.endpoint);
  const vault = channelVault();
  if (!isMigratableLegacyTarget(target, credential !== undefined) || vault === undefined) {
    return undefined;
  }
  const clientId = desktopRemoteClientId();
  const hello = {
    type: 'client/hello' as const,
    protocolVersion: 1 as const,
    clientType: 'desktop' as const,
    clientVersion: DESKTOP_HOST_CLIENT_VERSION,
  };
  const outcome = await migrateLegacyHost({
    record: {
      endpoint: target.endpoint,
      clientId,
      deviceName: describeThisDevice(),
      ...(credential === undefined ? {} : { credential }),
      ...(credential !== undefined || target.authToken === undefined
        ? {}
        : { authToken: target.authToken }),
    },
    hostBook: channelHostBook(),
    vault,
    connectLegacy: createLegacyConnector(
      hello,
      hasTauriBridge() ? createTauriHostWebSocket : undefined,
    ),
    verifyChannel: async (entry, secrets) => {
      const connection = await dialPairedHost({
        entry,
        secrets,
        dial: createChannelDialer(channelInnerSocketFactory()),
        hello: { ...hello, clientId },
      });
      await connection.close();
    },
  });
  if (outcome.status === 'failed') {
    console.warn('[piwin] moving this Host onto the encrypted channel failed', outcome.error);
    return outcome;
  }
  if (outcome.status !== 'migrated') return outcome;
  await primeChannelHost(outcome.entry.hostId);
  // The person may have switched Hosts while this ran; only replace the target we migrated.
  if (sameDesktopRemoteHostTarget(loadDesktopRemoteHostTarget(), target)) {
    saveDesktopRemoteHostTarget({
      endpoint: channelHostDisplayEndpoint(outcome.entry) || target.endpoint,
      hostId: outcome.entry.hostId,
    });
  }
  if (credential !== undefined) {
    await forgetDeviceCredential(target.endpoint).catch((error: unknown) =>
      console.warn('[piwin] could not drop the old device credential', error),
    );
  }
  return outcome;
}

/** Fire-and-forget entry for startup; returns immediately when there is nothing to do. */
export function startLegacyChannelMigration(): void {
  if (!canPairOverChannel()) return;
  void migrateSavedLegacyTarget();
}
