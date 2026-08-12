import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const OWNER_SCHEMA_VERSION = 1;
const HEARTBEAT_INTERVAL_MS = 5_000;
const MAX_ACQUISITION_ATTEMPTS = 4;

export type PiwinRootOwnerKind = 'desktop-sidecar' | 'standalone-server' | 'cli-command' | 'test';

export type PiwinRootOwner = {
  schemaVersion: 1;
  leaseId: string;
  hostInstanceId: string;
  processId: number;
  processStartedAt: string;
  acquiredAt: string;
  ownerKind: PiwinRootOwnerKind;
};

type PiwinRootHeartbeat = {
  schemaVersion: 1;
  leaseId: string;
  heartbeatAt: string;
};

export type AcquirePiwinRootLeaseOptions = {
  rootDir: string;
  ownerKind: PiwinRootOwnerKind;
  hostInstanceId?: string;
  heartbeatIntervalMs?: number;
  onCompromised?: (error: PiwinRootLeaseCompromisedError) => void;
};

export type PiwinRootLease = {
  readonly canonicalRootDir: string;
  readonly owner: PiwinRootOwner;
  readonly signal: AbortSignal;
  assertHeld(): void;
  release(): void;
};

export class PiwinRootAlreadyOwnedError extends Error {
  readonly name = 'PiwinRootAlreadyOwnedError';
  readonly code = 'piwin-root-already-owned';
  readonly owner: PiwinRootOwner;

  constructor(owner: PiwinRootOwner) {
    super(`piwin root is already owned by process ${owner.processId}`);
    this.owner = owner;
  }
}

export class PiwinRootOwnershipUnknownError extends Error {
  readonly name = 'PiwinRootOwnershipUnknownError';
  readonly code = 'piwin-root-ownership-unknown';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export class PiwinRootLeaseCompromisedError extends Error {
  readonly name = 'PiwinRootLeaseCompromisedError';
  readonly code = 'piwin-root-lease-compromised';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function resolveCanonicalRoot(rootDir: string): string {
  const absoluteRoot = resolve(rootDir);
  mkdirSync(absoluteRoot, { recursive: true, mode: 0o700 });
  return realpathSync(absoluteRoot);
}

function writePrivateJson(filePath: string, value: unknown): void {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    renameSync(temporaryPath, filePath);
  } catch (error) {
    try {
      rmSync(temporaryPath, { force: true });
    } catch {
      // Preserve the original publication failure.
    }
    throw error;
  }
}

function readJson(filePath: string, label: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new PiwinRootOwnershipUnknownError(`unable to read ${label}`, { cause: error });
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new PiwinRootOwnershipUnknownError(`invalid JSON in ${label}`, { cause: error });
  }
}

function parseOwner(value: unknown): PiwinRootOwner {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PiwinRootOwnershipUnknownError('invalid piwin root owner record');
  }
  const record = value as Record<string, unknown>;
  const validOwnerKinds: PiwinRootOwnerKind[] = [
    'desktop-sidecar',
    'standalone-server',
    'cli-command',
    'test',
  ];
  if (
    record.schemaVersion !== OWNER_SCHEMA_VERSION ||
    typeof record.leaseId !== 'string' ||
    record.leaseId.length === 0 ||
    typeof record.hostInstanceId !== 'string' ||
    record.hostInstanceId.length === 0 ||
    typeof record.processId !== 'number' ||
    !Number.isSafeInteger(record.processId) ||
    record.processId <= 0 ||
    typeof record.processStartedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.processStartedAt)) ||
    typeof record.acquiredAt !== 'string' ||
    !Number.isFinite(Date.parse(record.acquiredAt)) ||
    typeof record.ownerKind !== 'string' ||
    !validOwnerKinds.includes(record.ownerKind as PiwinRootOwnerKind)
  ) {
    throw new PiwinRootOwnershipUnknownError('invalid or unsupported piwin root owner record');
  }

  return {
    schemaVersion: 1,
    leaseId: record.leaseId,
    hostInstanceId: record.hostInstanceId,
    processId: record.processId,
    processStartedAt: record.processStartedAt,
    acquiredAt: record.acquiredAt,
    ownerKind: record.ownerKind as PiwinRootOwnerKind,
  };
}

function readOwner(ownerPath: string): PiwinRootOwner {
  return parseOwner(readJson(ownerPath, 'piwin root owner record'));
}

function isProcessAlive(processId: number): boolean | 'unknown' {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (isNodeError(error, 'ESRCH')) return false;
    if (isNodeError(error, 'EPERM')) return 'unknown';
    return 'unknown';
  }
}

function createOwner(options: AcquirePiwinRootLeaseOptions): PiwinRootOwner {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    leaseId: randomUUID(),
    hostInstanceId: options.hostInstanceId ?? randomUUID(),
    processId: process.pid,
    processStartedAt: new Date(Date.now() - process.uptime() * 1_000).toISOString(),
    acquiredAt: now,
    ownerKind: options.ownerKind,
  };
}

function reclaimDeadOwner(input: {
  hostStateDir: string;
  lockDir: string;
  ownerPath: string;
  owner: PiwinRootOwner;
}): boolean {
  if (isProcessAlive(input.owner.processId) !== false) return false;

  const confirmedOwner = readOwner(input.ownerPath);
  if (
    confirmedOwner.leaseId !== input.owner.leaseId ||
    confirmedOwner.processId !== input.owner.processId
  ) {
    return false;
  }
  if (isProcessAlive(confirmedOwner.processId) !== false) return false;

  const tombstonePath = join(
    input.hostStateDir,
    `owner.stale.${confirmedOwner.leaseId}.${randomUUID()}`,
  );
  try {
    renameSync(input.lockDir, tombstonePath);
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return false;
    throw new PiwinRootOwnershipUnknownError('unable to fence a stale piwin root owner', {
      cause: error,
    });
  }

  try {
    rmSync(tombstonePath, { recursive: true, force: true });
  } catch {
    // A tombstone is outside the active lock path and can be removed later.
  }
  return true;
}

export function acquirePiwinRootLease(options: AcquirePiwinRootLeaseOptions): PiwinRootLease {
  const canonicalRootDir = resolveCanonicalRoot(options.rootDir);
  const hostStateDir = join(canonicalRootDir, '.host');
  const lockDir = join(hostStateDir, 'owner.lock');
  const ownerPath = join(lockDir, 'owner.json');
  const heartbeatPath = join(lockDir, 'heartbeat.json');
  mkdirSync(hostStateDir, { recursive: true, mode: 0o700 });

  let acquired = false;
  for (let attempt = 0; attempt < MAX_ACQUISITION_ATTEMPTS; attempt += 1) {
    try {
      mkdirSync(lockDir, { mode: 0o700 });
      acquired = true;
      break;
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) {
        throw new PiwinRootOwnershipUnknownError('unable to acquire piwin root ownership', {
          cause: error,
        });
      }

      const existingOwner = readOwner(ownerPath);
      const liveness = isProcessAlive(existingOwner.processId);
      if (liveness === true) throw new PiwinRootAlreadyOwnedError(existingOwner);
      if (liveness === 'unknown') {
        throw new PiwinRootOwnershipUnknownError(
          `cannot prove whether piwin root owner process ${existingOwner.processId} is alive`,
        );
      }
      reclaimDeadOwner({ hostStateDir, lockDir, ownerPath, owner: existingOwner });
    }
  }

  if (!acquired) {
    throw new PiwinRootOwnershipUnknownError('piwin root ownership changed during acquisition');
  }

  const owner = createOwner(options);
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
  const abortController = new AbortController();
  let heartbeatTimer: NodeJS.Timeout | undefined;
  let released = false;

  const compromise = (message: string, cause?: unknown): PiwinRootLeaseCompromisedError => {
    const error = new PiwinRootLeaseCompromisedError(message, { cause });
    if (!abortController.signal.aborted) {
      abortController.abort(error);
      options.onCompromised?.(error);
    }
    return error;
  };

  const assertHeld = (): void => {
    if (released) throw new PiwinRootLeaseCompromisedError('piwin root lease was released');
    let currentOwner: PiwinRootOwner;
    try {
      currentOwner = readOwner(ownerPath);
    } catch (error) {
      throw compromise('piwin root owner record is unavailable', error);
    }
    if (currentOwner.leaseId !== owner.leaseId) {
      throw compromise('piwin root ownership token changed');
    }
  };

  const writeHeartbeat = (): void => {
    try {
      assertHeld();
      const heartbeat: PiwinRootHeartbeat = {
        schemaVersion: 1,
        leaseId: owner.leaseId,
        heartbeatAt: new Date().toISOString(),
      };
      writePrivateJson(heartbeatPath, heartbeat);
    } catch (error) {
      if (!(error instanceof PiwinRootLeaseCompromisedError)) {
        compromise('piwin root heartbeat failed', error);
      }
    }
  };

  try {
    writePrivateJson(ownerPath, owner);
    writeHeartbeat();
    heartbeatTimer = setInterval(writeHeartbeat, heartbeatIntervalMs);
    heartbeatTimer.unref();
  } catch (error) {
    try {
      rmSync(lockDir, { recursive: true, force: true });
    } catch {
      // Preserve the initialization failure.
    }
    throw error;
  }

  return {
    canonicalRootDir,
    owner,
    signal: abortController.signal,
    assertHeld,
    release: () => {
      if (released) return;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
      assertHeld();

      const releasePath = join(hostStateDir, `owner.released.${owner.leaseId}.${randomUUID()}`);
      try {
        renameSync(lockDir, releasePath);
        released = true;
        rmSync(releasePath, { recursive: true, force: true });
      } catch (error) {
        throw compromise('unable to release piwin root ownership safely', error);
      }
    },
  };
}
