import { join } from 'node:path';
import type {
  HostResponse,
  LocalMobileAccessCommand,
  MobileAccessEndpointCandidate,
  MobileAccessPairingCodeData,
  MobileAccessStatusData,
  PairedDeviceSummary,
} from '@piwin/contracts';
import { MOBILE_ACCESS_LAN_PROFILE_ID, MOBILE_ACCESS_LOOPBACK_PROFILE_ID } from '@piwin/contracts';
import { HostDevicePairing } from './device-pairing.js';
import { HostDevicePairingFileStore } from './device-pairing-store.js';
import {
  HostServer,
  type HostRuntimePort,
  type HostServerAddress,
} from './host-server.js';
import type { HostCommandIdempotencyRegistry } from './host-command-idempotency-registry.js';
import type { HostEgressHub } from './host-egress-hub.js';
import { listMobileAccessEndpointCandidates } from './mobile-access-endpoints.js';
import { startWithPortFallback } from './mobile-access-listen.js';
import {
  MobileAccessSettingsFileStore,
  type MobileAccessSettings,
} from './mobile-access-settings-store.js';
import {
  countActivePairedDevices,
  listPairedDevices,
  mintPairingCode,
  revokePairedDevice,
  type PairingRegistry,
} from './pairing-operations.js';
import { assertPairingEndpointIsDialable } from './pairing-qr.js';

const BIND_HOST_BY_PROFILE: Readonly<Record<string, string>> = {
  [MOBILE_ACCESS_LOOPBACK_PROFILE_ID]: '127.0.0.1',
  [MOBILE_ACCESS_LAN_PROFILE_ID]: '0.0.0.0',
};
/**
 * Not the standalone Host's 8787: on macOS a wildcard bind can coexist with a
 * dev Host on 127.0.0.1:8787, and two services on one port number confuses
 * everyone. The first bound port is persisted and reused afterwards.
 */
const DEFAULT_BIND_PORT = 8790;
const PHONE_ACCESS_DISABLED_REASON = 'phone access disabled';
const DEVICE_REVOKED_REASON = 'device revoked';

export type MobileAccessControllerOptions = {
  runtime: HostRuntimePort;
  pairing: HostDevicePairing;
  pairingStore?: HostDevicePairingFileStore;
  /** Persisted on/off, port and address override; in-memory when absent. */
  settingsStore?: MobileAccessSettingsFileStore;
  settings?: MobileAccessSettings;
  instanceId: string;
  /** Test/ops override: bind this address whatever the profile says. */
  bindHost?: string;
  /** Preferred port; falls back upward when busy. Overrides the persisted port. */
  bindPort?: number;
  /** Injected for tests; defaults to this machine's interfaces. */
  listEndpointCandidates?: (port: number) => MobileAccessEndpointCandidate[];
  onError?: (error: Error) => void;
  clientToolBroker?: import('./device-tool-broker.js').DeviceToolBroker;
  egressHub?: HostEgressHub;
  idempotencyRegistry?: HostCommandIdempotencyRegistry;
};

/**
 * Owns the phone-access WebSocket listener for the sidecar lifetime.
 * Stop removes only that listener and its clients. Host identity and a
 * shared injected egress hub stay with the sidecar process.
 *
 * The on/off choice persists: `resume()` reopens the listener at sidecar
 * start so a paired phone reconnects without the operator visiting settings.
 */
export class MobileAccessController {
  private readonly options: MobileAccessControllerOptions;
  private readonly pairing: HostDevicePairing;
  private readonly instanceId: string;
  private settings: MobileAccessSettings;
  private server: HostServer | undefined;
  private bindAddress: HostServerAddress | undefined;
  private profileId: string | undefined;
  private lastError: string | undefined;
  /** Commands and resume run one at a time so a start cannot race a stop. */
  private operationTail: Promise<unknown> = Promise.resolve();

  public constructor(options: MobileAccessControllerOptions) {
    this.options = options;
    this.pairing = options.pairing;
    this.instanceId = options.instanceId;
    this.settings = { ...(options.settings ?? { enabled: false }) };
  }

  public handle(command: LocalMobileAccessCommand): Promise<HostResponse> {
    return this.serialize(async () => {
      try {
        const data = await this.dispatch(command);
        return {
          type: 'response',
          command: command.type,
          success: true,
          data,
          ...(command.id === undefined ? {} : { id: command.id }),
        };
      } catch (error) {
        return {
          type: 'response',
          command: command.type,
          success: false,
          error: error instanceof Error ? error.message : 'Phone access command failed',
          ...(command.id === undefined ? {} : { id: command.id }),
        };
      }
    });
  }

  /** Reopen the listener when the operator left phone access on. Never rejects. */
  public resume(): Promise<void> {
    return this.serialize(async () => {
      if (!this.settings.enabled || this.server !== undefined) {
        return;
      }
      try {
        await this.startListener(MOBILE_ACCESS_LAN_PROFILE_ID, this.settings.advertisedEndpoint);
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        this.options.onError?.(normalized);
      }
    });
  }

  public dispose(): Promise<void> {
    return this.serialize(async () => {
      await this.closeListener();
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationTail.then(operation, operation);
    this.operationTail = next.catch(() => undefined);
    return next;
  }

  private async dispatch(command: LocalMobileAccessCommand): Promise<unknown> {
    switch (command.type) {
      case 'mobile-access/status':
        return this.statusData();
      case 'mobile-access/start':
        return this.startListener(command.profileId, command.advertisedEndpoint);
      case 'mobile-access/stop':
        await this.closeListener();
        this.lastError = undefined;
        await this.saveSettings({ ...this.settings, enabled: false });
        return this.statusData();
      case 'mobile-access/create-pairing-code':
        return this.createPairingCode();
      case 'mobile-access/list-devices':
        return { devices: this.listDevices() };
      case 'mobile-access/revoke-device':
        return this.revokeDevice(command.deviceId);
    }
  }

  private statusData(): MobileAccessStatusData {
    const status: MobileAccessStatusData = {
      listening: this.server !== undefined,
      pairedDeviceCount: countActivePairedDevices(this.registry()),
      hostInstanceId: this.instanceId,
      enabled: this.settings.enabled,
      advertisedEndpointSource: this.settings.advertisedEndpoint === undefined ? 'auto' : 'custom',
    };
    if (this.profileId !== undefined) {
      status.profileId = this.profileId;
    }
    if (this.bindAddress !== undefined) {
      status.bindHost = this.bindAddress.host;
      status.bindPort = this.bindAddress.port;
      status.bindUrl = this.bindAddress.url;
      status.endpointCandidates = this.endpointCandidates();
    }
    const advertised = this.effectiveAdvertisedEndpoint();
    if (advertised !== undefined) {
      status.advertisedEndpoint = advertised;
    }
    if (this.lastError !== undefined) {
      status.lastError = this.lastError;
    }
    return status;
  }

  private async startListener(
    profileId: string,
    advertisedEndpoint: string | undefined,
  ): Promise<MobileAccessStatusData> {
    try {
      const profile = profileId.trim();
      const profileBindHost = BIND_HOST_BY_PROFILE[profile];
      if (profileBindHost === undefined) {
        throw new Error(`Unsupported phone-access profile: ${profile}`);
      }
      // Absent keeps the saved choice (switch back on); blank switches to auto.
      const override =
        advertisedEndpoint === undefined
          ? this.settings.advertisedEndpoint
          : normalizeAdvertisedOverride(advertisedEndpoint);
      if (this.server !== undefined && this.profileId !== profile) {
        await this.closeListener();
      }
      if (this.server === undefined) {
        const bindHost = this.options.bindHost ?? profileBindHost;
        const preferredPort = this.options.bindPort ?? this.settings.port ?? DEFAULT_BIND_PORT;
        const started = await startWithPortFallback(
          (port) => this.createServer(bindHost, port),
          preferredPort,
        );
        this.server = started.server;
        this.bindAddress = started.address;
        this.profileId = profile;
      }
      const settings: MobileAccessSettings = { enabled: true };
      if (this.bindAddress !== undefined && this.bindAddress.port > 0) {
        settings.port = this.bindAddress.port;
      }
      if (override !== undefined) {
        settings.advertisedEndpoint = override;
      }
      await this.saveSettings(settings);
      this.lastError = undefined;
      return this.statusData();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /** Close the listener without touching the persisted preference (shutdown path). */
  private async closeListener(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.bindAddress = undefined;
    this.profileId = undefined;
    if (server === undefined) {
      return;
    }
    this.pairing.invalidatePendingTokens();
    await this.persistPairing();
    await server.stop(PHONE_ACCESS_DISABLED_REASON);
  }

  private async createPairingCode(): Promise<MobileAccessPairingCodeData> {
    const advertised = this.effectiveAdvertisedEndpoint();
    if (this.server === undefined || advertised === undefined) {
      throw new Error('Enable phone access before creating a pairing code');
    }
    return mintPairingCode(this.registry(), {
      advertisedEndpoint: advertised,
      hostInstanceId: this.instanceId,
    });
  }

  /**
   * Operator override first; otherwise the best detected LAN/tailnet address
   * for a wildcard bind, re-read each time so a Wi-Fi change shows up in the
   * next QR; a loopback bind advertises itself (tunnel setups).
   */
  private effectiveAdvertisedEndpoint(): string | undefined {
    if (this.bindAddress === undefined) {
      return undefined;
    }
    if (this.settings.advertisedEndpoint !== undefined) {
      return this.settings.advertisedEndpoint;
    }
    if (this.profileId === MOBILE_ACCESS_LAN_PROFILE_ID && this.options.bindHost === undefined) {
      return this.endpointCandidates()[0]?.url;
    }
    return this.bindAddress.url;
  }

  private endpointCandidates(): MobileAccessEndpointCandidate[] {
    if (this.bindAddress === undefined) {
      return [];
    }
    const list = this.options.listEndpointCandidates ?? listMobileAccessEndpointCandidates;
    return list(this.bindAddress.port);
  }

  private listDevices(): PairedDeviceSummary[] {
    return listPairedDevices(this.registry());
  }

  private async revokeDevice(deviceId: string): Promise<{ revoked: boolean }> {
    return revokePairedDevice(this.registry(), deviceId, (revokedId) => {
      this.options.clientToolBroker?.forgetDevice(revokedId);
      this.server?.disconnectDevice(revokedId, DEVICE_REVOKED_REASON);
    });
  }

  private registry(): PairingRegistry {
    return { pairing: this.pairing, store: this.options.pairingStore };
  }

  private createServer(host: string, port: number): HostServer {
    const options = this.options;
    return new HostServer({
      runtime: options.runtime,
      host,
      port,
      instanceId: this.instanceId,
      devicePairing: this.pairing,
      ...(options.pairingStore === undefined ? {} : { devicePairingStore: options.pairingStore }),
      ...(options.onError === undefined ? {} : { onError: options.onError }),
      ...(options.clientToolBroker === undefined ? {} : { clientToolBroker: options.clientToolBroker }),
      ...(options.egressHub === undefined ? {} : { egressHub: options.egressHub }),
      ...(options.idempotencyRegistry === undefined
        ? {}
        : { idempotencyRegistry: options.idempotencyRegistry }),
    });
  }

  private async saveSettings(settings: MobileAccessSettings): Promise<void> {
    this.settings = settings;
    await this.options.settingsStore?.save(settings);
  }

  private async persistPairing(): Promise<void> {
    if (this.options.pairingStore === undefined) {
      return;
    }
    await this.options.pairingStore.save(this.pairing);
  }
}

export async function createMobileAccessController(options: {
  runtime: HostRuntimePort;
  instanceId: string;
  piwinRoot: string;
  bindHost?: string;
  bindPort?: number;
  onError?: (error: Error) => void;
  clientToolBroker?: import('./device-tool-broker.js').DeviceToolBroker;
  egressHub?: HostEgressHub;
  idempotencyRegistry?: HostCommandIdempotencyRegistry;
}): Promise<MobileAccessController> {
  const pairing = new HostDevicePairing();
  const pairingStore = new HostDevicePairingFileStore(join(options.piwinRoot, 'devices', 'pairing.json'));
  await pairingStore.load(pairing);
  const settingsStore = new MobileAccessSettingsFileStore(
    join(options.piwinRoot, 'devices', 'mobile-access.json'),
  );
  let settings: MobileAccessSettings;
  try {
    settings = await settingsStore.load();
  } catch (error) {
    // A damaged preference file must not take pairing management down with it;
    // stay closed until the operator turns phone access on again (which rewrites it).
    options.onError?.(error instanceof Error ? error : new Error(String(error)));
    settings = { enabled: false };
  }
  return new MobileAccessController({
    runtime: options.runtime,
    pairing,
    pairingStore,
    settingsStore,
    settings,
    instanceId: options.instanceId,
    ...(options.bindHost === undefined ? {} : { bindHost: options.bindHost }),
    ...(options.bindPort === undefined ? {} : { bindPort: options.bindPort }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    ...(options.clientToolBroker === undefined ? {} : { clientToolBroker: options.clientToolBroker }),
    ...(options.egressHub === undefined ? {} : { egressHub: options.egressHub }),
    ...(options.idempotencyRegistry === undefined
      ? {}
      : { idempotencyRegistry: options.idempotencyRegistry }),
  });
}

/** Blank means "auto". A custom address must be a dialable ws:// or wss:// URL. */
function normalizeAdvertisedOverride(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }
  let protocol: string;
  try {
    protocol = new URL(trimmed).protocol;
  } catch {
    throw new Error(`Phone address is not a valid URL: ${trimmed}`);
  }
  if (protocol !== 'ws:' && protocol !== 'wss:') {
    throw new Error('Phone address must start with ws:// or wss://');
  }
  assertPairingEndpointIsDialable(trimmed);
  return trimmed;
}
