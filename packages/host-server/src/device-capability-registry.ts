import type { ClientToolCapabilityAdvertisement } from '@piwin/contracts';
import { MAX_CLIENT_TOOL_CAPABILITIES } from '@piwin/contracts';
import {
  DeviceCapabilityStore,
  type DeviceCapabilityRecord,
  type DeviceCapabilitySnapshot,
} from './device-capability-store.js';

export const MAX_CAPABILITY_DEVICES = 32;

export type DeviceCapabilityRegistryOptions = {
  store: DeviceCapabilityStore;
  now?: () => number;
};

export type DeviceAdvertisementInput = {
  deviceId: string;
  capabilities: readonly ClientToolCapabilityAdvertisement[];
  clientType?: string;
  clientVersion?: string;
};

/**
 * Normalized, persisted capability facts keyed by paired deviceId.
 * Stores IDs/versions only — never HealthKit values or model prose.
 */
export class DeviceCapabilityRegistry {
  private readonly store: DeviceCapabilityStore;
  private readonly now: () => number;
  private persistTail: Promise<void> = Promise.resolve();
  private snapshot: DeviceCapabilitySnapshot = {
    version: 1,
    devices: {},
    primaryByCapability: {},
  };

  public constructor(options: DeviceCapabilityRegistryOptions) {
    this.store = options.store;
    this.now = options.now ?? Date.now;
  }

  public async load(): Promise<void> {
    this.snapshot = await this.store.load();
  }

  public recordAdvertisement(input: DeviceAdvertisementInput): Promise<void> {
    const operation = this.persistTail.then(() => this.writeAdvertisement(input));
    this.persistTail = operation.catch(() => undefined);
    return operation;
  }

  public removeDevice(deviceId: string): Promise<void> {
    const operation = this.persistTail.then(() => this.writeRemoval(deviceId));
    this.persistTail = operation.catch(() => undefined);
    return operation;
  }

  public async flush(): Promise<void> {
    await this.persistTail;
  }

  public isKnownCapable(deviceId: string, capabilityId: string): boolean {
    const record = this.snapshot.devices[deviceId];
    return record?.capabilities.some((item) => item.id === capabilityId) === true;
  }

  public mostRecentlyAdvertised(capabilityId: string): string | undefined {
    let latestId: string | undefined;
    let latestAt = Number.NEGATIVE_INFINITY;
    for (const [deviceId, record] of Object.entries(this.snapshot.devices)) {
      if (!record.capabilities.some((item) => item.id === capabilityId)) {
        continue;
      }
      const advertisedAt = Date.parse(record.lastAdvertisedAt);
      if (Number.isFinite(advertisedAt) && advertisedAt >= latestAt) {
        latestAt = advertisedAt;
        latestId = deviceId;
      }
    }
    return latestId;
  }

  public primaryDevice(capabilityId: string): string | undefined {
    const deviceId = this.snapshot.primaryByCapability[capabilityId];
    if (deviceId === undefined || !this.isKnownCapable(deviceId, capabilityId)) {
      return undefined;
    }
    return deviceId;
  }

  private async writeAdvertisement(input: DeviceAdvertisementInput): Promise<void> {
    if (input.capabilities.length > MAX_CLIENT_TOOL_CAPABILITIES) {
      throw new Error('Device capability advertisement exceeds the bound');
    }
    const devices = { ...this.snapshot.devices };
    if (devices[input.deviceId] === undefined && Object.keys(devices).length >= MAX_CAPABILITY_DEVICES) {
      throw new Error('Device capability registry is at the paired-device bound');
    }
    const record: DeviceCapabilityRecord = {
      lastAdvertisedAt: new Date(this.now()).toISOString(),
      capabilities: input.capabilities,
    };
    if (input.clientType !== undefined) {
      record.clientType = input.clientType;
    }
    if (input.clientVersion !== undefined) {
      record.clientVersion = input.clientVersion;
    }
    devices[input.deviceId] = record;
    this.snapshot = {
      version: 1,
      devices,
      primaryByCapability: this.snapshot.primaryByCapability,
    };
    await this.store.save(this.snapshot);
  }

  private async writeRemoval(deviceId: string): Promise<void> {
    if (this.snapshot.devices[deviceId] === undefined) {
      return;
    }
    const devices = { ...this.snapshot.devices };
    delete devices[deviceId];
    const primaryByCapability: Record<string, string> = {};
    for (const [capabilityId, primaryId] of Object.entries(this.snapshot.primaryByCapability)) {
      if (primaryId !== deviceId) {
        primaryByCapability[capabilityId] = primaryId;
      }
    }
    this.snapshot = { version: 1, devices, primaryByCapability };
    await this.store.save(this.snapshot);
  }

  public setPrimaryDevice(capabilityId: string, deviceId: string): Promise<boolean> {
    const operation = this.persistTail.then(() => this.writePrimary(capabilityId, deviceId));
    this.persistTail = operation.then(() => undefined).catch(() => undefined);
    return operation;
  }

  private async writePrimary(capabilityId: string, deviceId: string): Promise<boolean> {
    if (!this.isKnownCapable(deviceId, capabilityId)) {
      return false;
    }
    this.snapshot = {
      version: 1,
      devices: this.snapshot.devices,
      primaryByCapability: {
        ...this.snapshot.primaryByCapability,
        [capabilityId]: deviceId,
      },
    };
    await this.store.save(this.snapshot);
    return true;
  }
}
