import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ClientToolCapabilityAdvertisement } from '@piwin/contracts';
import { parseClientToolCapabilityAdvertisements } from '@piwin/contracts';

export type DeviceCapabilityRecord = {
  clientType?: string;
  clientVersion?: string;
  lastAdvertisedAt: string;
  capabilities: readonly ClientToolCapabilityAdvertisement[];
};

export type DeviceCapabilitySnapshot = {
  version: 1;
  devices: Record<string, DeviceCapabilityRecord>;
  primaryByCapability: Record<string, string>;
};

const EMPTY_SNAPSHOT: DeviceCapabilitySnapshot = {
  version: 1,
  devices: {},
  primaryByCapability: {},
};

/**
 * Owner-only atomic snapshot of paired-device capability advertisements.
 * Missing files are empty. A malformed existing file fails closed.
 */
export class DeviceCapabilityStore {
  private readonly filePath: string;
  private writeTail: Promise<void> = Promise.resolve();

  public constructor(filePath: string) {
    const normalized = filePath.trim();
    if (normalized.length === 0) {
      throw new Error('Device capability store path is required');
    }
    this.filePath = normalized;
  }

  public async load(): Promise<DeviceCapabilitySnapshot> {
    await this.writeTail;
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (isErrno(error, 'ENOENT')) {
        return { ...EMPTY_SNAPSHOT, devices: {}, primaryByCapability: {} };
      }
      throw new Error(`Unable to read device capabilities store: ${toErrorMessage(error)}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new Error(`Unable to parse device capabilities store: ${toErrorMessage(error)}`);
    }
    return parseSnapshot(parsed);
  }

  public save(snapshot: DeviceCapabilitySnapshot): Promise<void> {
    const normalized = parseSnapshot(snapshot);
    const operation = this.writeTail.then(() => this.writeSnapshot(normalized));
    this.writeTail = operation.catch(() => undefined);
    return operation;
  }

  private async writeSnapshot(snapshot: DeviceCapabilitySnapshot): Promise<void> {
    const parentDirectory = dirname(this.filePath);
    await mkdir(parentDirectory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporaryPath, this.filePath);
      await chmod(this.filePath, 0o600);
    } catch (error) {
      try {
        await unlink(temporaryPath);
      } catch {
        // Preserve the original write/rename error; cleanup is best effort.
      }
      throw new Error(`Unable to persist device capabilities store: ${toErrorMessage(error)}`);
    }
  }
}

function parseSnapshot(value: unknown): DeviceCapabilitySnapshot {
  if (!isRecord(value)) {
    throw new Error('Device capabilities store is malformed');
  }
  if (value.version !== 1) {
    throw new Error('Device capabilities store version is unsupported');
  }
  const devices: Record<string, DeviceCapabilityRecord> = {};
  if (!isRecord(value.devices)) {
    throw new Error('Device capabilities store devices map is malformed');
  }
  for (const [deviceId, record] of Object.entries(value.devices)) {
    if (typeof deviceId !== 'string' || deviceId.length === 0 || !isRecord(record)) {
      throw new Error('Device capabilities store record is malformed');
    }
    if (typeof record.lastAdvertisedAt !== 'string' || record.lastAdvertisedAt.length === 0) {
      throw new Error('Device capabilities store lastAdvertisedAt is malformed');
    }
    const parsed = parseClientToolCapabilityAdvertisements(record.capabilities);
    if (!parsed.ok) {
      throw new Error(`Device capabilities store advertisements are invalid: ${parsed.reason}`);
    }
    const next: DeviceCapabilityRecord = {
      lastAdvertisedAt: record.lastAdvertisedAt,
      capabilities: parsed.value.capabilities,
    };
    if (typeof record.clientType === 'string' && record.clientType.length > 0) {
      next.clientType = record.clientType;
    }
    if (typeof record.clientVersion === 'string' && record.clientVersion.length > 0) {
      next.clientVersion = record.clientVersion;
    }
    devices[deviceId] = next;
  }
  const primaryByCapability: Record<string, string> = {};
  if (value.primaryByCapability !== undefined) {
    if (!isRecord(value.primaryByCapability)) {
      throw new Error('Device capabilities store primary map is malformed');
    }
    for (const [capabilityId, deviceId] of Object.entries(value.primaryByCapability)) {
      if (typeof capabilityId !== 'string' || typeof deviceId !== 'string' || deviceId.length === 0) {
        throw new Error('Device capabilities store primary selector is malformed');
      }
      if (devices[deviceId] === undefined) {
        continue;
      }
      primaryByCapability[capabilityId] = deviceId;
    }
  }
  return { version: 1, devices, primaryByCapability };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
