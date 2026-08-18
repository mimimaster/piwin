import { join } from 'node:path';
import type {
  HostResponse,
  LocalMobileAccessCommand,
  MobileAccessPairingCodeData,
  MobileAccessStatusData,
  PairedDeviceSummary,
} from '@piwin/contracts';
import {
  MOBILE_ACCESS_LOOPBACK_PROFILE_ID,
  projectPairedDeviceSummary,
} from '@piwin/contracts';
import { HostDevicePairing } from './device-pairing.js';
import { HostDevicePairingFileStore } from './device-pairing-store.js';
import {
  HostServer,
  type HostRuntimePort,
  type HostServerAddress,
} from './host-server.js';
import {
  assertPairingBindIsAdvertisable,
  createPairingQrPayload,
  pairingQrUri,
} from './pairing-qr.js';

const DEFAULT_BIND_HOST = '127.0.0.1';
const DEFAULT_BIND_PORT = 8787;
const PHONE_ACCESS_DISABLED_REASON = 'phone access disabled';
const DEVICE_REVOKED_REASON = 'device revoked';

export type MobileAccessControllerOptions = {
  runtime: HostRuntimePort;
  pairing: HostDevicePairing;
  pairingStore?: HostDevicePairingFileStore;
  instanceId: string;
  bindHost?: string;
  bindPort?: number;
  onError?: (error: Error) => void;
};

/**
 * Owns one HostServer for the sidecar lifetime so listen toggles keep
 * hostInstanceId, pairing records, and replay state.
 */
export class MobileAccessController {
  private readonly runtime: HostRuntimePort;
  private readonly pairing: HostDevicePairing;
  private readonly pairingStore: HostDevicePairingFileStore | undefined;
  private readonly instanceId: string;
  private readonly bindHost: string;
  private readonly bindPort: number;
  private readonly onError: ((error: Error) => void) | undefined;
  private server: HostServer | undefined;
  private listening = false;
  private bindAddress: HostServerAddress | undefined;
  private advertisedEndpoint: string | undefined;
  private profileId: string | undefined;

  public constructor(options: MobileAccessControllerOptions) {
    this.runtime = options.runtime;
    this.pairing = options.pairing;
    this.pairingStore = options.pairingStore;
    this.instanceId = options.instanceId;
    this.bindHost = options.bindHost ?? DEFAULT_BIND_HOST;
    this.bindPort = options.bindPort ?? DEFAULT_BIND_PORT;
    this.onError = options.onError;
  }

  public async handle(command: LocalMobileAccessCommand): Promise<HostResponse> {
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
  }

  public async dispose(): Promise<void> {
    if (this.listening) {
      await this.stopListener();
    }
  }

  private async dispatch(command: LocalMobileAccessCommand): Promise<unknown> {
    switch (command.type) {
      case 'mobile-access/status':
        return this.statusData();
      case 'mobile-access/start':
        return this.startListener(command.profileId, command.advertisedEndpoint);
      case 'mobile-access/stop':
        await this.stopListener();
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
      listening: this.listening,
      pairedDeviceCount: this.pairing.list().filter((device) => device.revokedAt === undefined).length,
      hostInstanceId: this.instanceId,
    };
    if (this.profileId !== undefined) {
      status.profileId = this.profileId;
    }
    if (this.bindAddress !== undefined) {
      status.bindHost = this.bindAddress.host;
      status.bindPort = this.bindAddress.port;
      status.bindUrl = this.bindAddress.url;
    }
    if (this.advertisedEndpoint !== undefined) {
      status.advertisedEndpoint = this.advertisedEndpoint;
    }
    return status;
  }

  private async startListener(
    profileId: string,
    advertisedEndpoint: string | undefined,
  ): Promise<MobileAccessStatusData> {
    const normalizedProfile = profileId.trim();
    if (normalizedProfile !== MOBILE_ACCESS_LOOPBACK_PROFILE_ID) {
      throw new Error(`Unsupported phone-access profile: ${normalizedProfile}`);
    }
    assertPairingBindIsAdvertisable(this.bindHost);

    if (this.listening) {
      this.advertisedEndpoint = resolveAdvertisedEndpoint(advertisedEndpoint, this.bindAddress?.url);
      return this.statusData();
    }

    const server = this.ensureServer();
    const address = await server.start();
    this.listening = true;
    this.bindAddress = address;
    this.profileId = normalizedProfile;
    this.advertisedEndpoint = resolveAdvertisedEndpoint(advertisedEndpoint, address.url);
    return this.statusData();
  }

  private async stopListener(): Promise<void> {
    if (!this.listening || this.server === undefined) {
      this.listening = false;
      this.bindAddress = undefined;
      this.advertisedEndpoint = undefined;
      this.profileId = undefined;
      return;
    }
    this.pairing.invalidatePendingTokens();
    await this.persist();
    await this.server.stop(PHONE_ACCESS_DISABLED_REASON);
    this.server = undefined;
    this.listening = false;
    this.bindAddress = undefined;
    this.advertisedEndpoint = undefined;
    this.profileId = undefined;
  }

  private async createPairingCode(): Promise<MobileAccessPairingCodeData> {
    if (!this.listening || this.bindAddress === undefined) {
      throw new Error('Enable phone access before creating a pairing code');
    }
    const advertised = this.advertisedEndpoint?.trim();
    if (advertised === undefined || advertised.length === 0) {
      throw new Error('An advertised WebSocket endpoint is required to mint a pairing QR');
    }
    assertPairingBindIsAdvertisable(this.bindAddress.host);
    this.pairing.invalidatePendingTokens();
    const minted = this.pairing.mintToken();
    await this.persist();
    const payload = createPairingQrPayload({
      advertisedEndpoint: advertised,
      pairingToken: minted.token,
      hostInstanceId: this.instanceId,
      expiresAt: minted.expiresAt,
    });
    return {
      endpoint: payload.endpoint,
      pairingToken: payload.pairingToken,
      hostInstanceId: payload.hostInstanceId,
      protocolVersion: payload.protocolVersion,
      expiresAt: payload.expiresAt,
      uri: pairingQrUri(payload),
    };
  }

  private listDevices(): PairedDeviceSummary[] {
    return this.pairing.list().map((device) => projectPairedDeviceSummary(device));
  }

  private async revokeDevice(deviceId: string): Promise<{ revoked: boolean }> {
    const revoked = this.pairing.revoke(deviceId.trim());
    if (revoked) {
      this.server?.disconnectDevice(deviceId.trim(), DEVICE_REVOKED_REASON);
      await this.persist();
    }
    return { revoked };
  }

  private ensureServer(): HostServer {
    if (this.server !== undefined) {
      return this.server;
    }
    this.server = new HostServer({
      runtime: this.runtime,
      host: this.bindHost,
      port: this.bindPort,
      instanceId: this.instanceId,
      devicePairing: this.pairing,
      ...(this.pairingStore === undefined ? {} : { devicePairingStore: this.pairingStore }),
      ...(this.onError === undefined ? {} : { onError: this.onError }),
    });
    return this.server;
  }

  private async persist(): Promise<void> {
    if (this.pairingStore === undefined) {
      return;
    }
    await this.pairingStore.save(this.pairing);
  }
}

export async function createMobileAccessController(options: {
  runtime: HostRuntimePort;
  instanceId: string;
  piwinRoot: string;
  bindHost?: string;
  bindPort?: number;
  onError?: (error: Error) => void;
}): Promise<MobileAccessController> {
  const pairing = new HostDevicePairing();
  const pairingStore = new HostDevicePairingFileStore(join(options.piwinRoot, 'devices', 'pairing.json'));
  await pairingStore.load(pairing);
  return new MobileAccessController({
    runtime: options.runtime,
    pairing,
    pairingStore,
    instanceId: options.instanceId,
    ...(options.bindHost === undefined ? {} : { bindHost: options.bindHost }),
    ...(options.bindPort === undefined ? {} : { bindPort: options.bindPort }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  });
}

function resolveAdvertisedEndpoint(
  advertisedEndpoint: string | undefined,
  bindUrl: string | undefined,
): string | undefined {
  const advertised = advertisedEndpoint?.trim();
  if (advertised !== undefined && advertised.length > 0) {
    return advertised;
  }
  const bind = bindUrl?.trim();
  return bind !== undefined && bind.length > 0 ? bind : undefined;
}
