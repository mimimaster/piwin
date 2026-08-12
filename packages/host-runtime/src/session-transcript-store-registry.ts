import { constants } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { access, copyFile, readdir, rename, rm } from 'node:fs/promises';
import type { SessionTranscriptStore } from '@piwin/session';
import { loadSessionTranscript, openSessionTranscriptStore } from '@piwin/session';
import {
  getPiwinSessionTranscriptBackupPath,
  getPiwinSessionTranscriptDatabasePath,
  getPiwinSessionTranscriptPath,
  getPiwinSessionsDir,
} from './paths.js';

export class InterruptedTranscriptMigrationError extends Error {
  public readonly name = 'InterruptedTranscriptMigrationError';
}

export type SessionTranscriptStoreRegistry = {
  get(sessionId: string, projectPath: string): Promise<SessionTranscriptStore>;
  withStore<T>(
    sessionId: string,
    projectPath: string,
    operation: (store: SessionTranscriptStore) => Promise<T>,
    shouldRetain: (sessionId: string) => boolean,
  ): Promise<T>;
  withCommandLease<T>(
    operation: () => Promise<T>,
    shouldRetain: (sessionId: string) => boolean,
  ): Promise<T>;
  withMaintenanceLease<T>(sessionId: string, operation: () => Promise<T>): Promise<T>;
  tryWithMaintenanceLease<T>(
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<{ acquired: true; value: T } | { acquired: false }>;
  close(sessionId: string): void;
  closeAll(): void;
};

/**
 * Host-owned composition/lifecycle boundary for per-session SQLite handles.
 * Opening is deduplicated and legacy JSON becomes v2 authority only after a
 * transactionally imported database independently verifies its contents.
 */
export function createSessionTranscriptStoreRegistry(input: {
  rootDir: string;
  onDiagnostic?: (message: string) => void;
}): SessionTranscriptStoreRegistry {
  const stores = new Map<string, SessionTranscriptStore>();
  const openings = new Map<string, Promise<SessionTranscriptStore>>();
  const closingSessions = new Set<string>();
  /** Explicit close requested while one or more command leases still use the Store. */
  const deferredCloseSessions = new Set<string>();
  const commandLeaseContext = new AsyncLocalStorage<Set<string>>();
  const commandLeaseCounts = new Map<string, number>();
  /** Active and queued maintenance demand; any demand blocks new Store access. */
  const maintenanceDemandCounts = new Map<string, number>();
  const maintenanceQueues = new Map<string, Promise<void>>();
  const commandLeaseReleaseWaiters = new Map<string, Set<() => void>>();
  let disposed = false;

  async function open(sessionId: string, projectPath: string): Promise<SessionTranscriptStore> {
    const store = await openSessionTranscriptStore({
      dbPath: getPiwinSessionTranscriptDatabasePath(input.rootDir, sessionId),
      sessionId,
      projectPath,
    });
    try {
      if (await store.isMigrated()) {
        return store;
      }
      const legacyPath = getPiwinSessionTranscriptPath(input.rootDir, sessionId);
      const legacy = await loadSessionTranscript(legacyPath);
      if (legacy === null) {
        await store.markAuthoritative();
        return store;
      }
      const backupPath = getPiwinSessionTranscriptBackupPath(input.rootDir, sessionId);
      try {
        await copyFile(legacyPath, backupPath, constants.COPYFILE_EXCL);
      } catch (error) {
        if (!isAlreadyExists(error)) {
          throw error;
        }
      }
      await store.importLegacyDocument(legacy);
      const verification = await store.verifyLegacyDocument(legacy);
      if (!verification.matches || !(await store.isMigrated())) {
        throw new InterruptedTranscriptMigrationError(
          `Transcript migration requires doctor repair for session ${sessionId}; legacy JSON remains authoritative`,
        );
      }
      input.onDiagnostic?.(`migrated transcript ${sessionId} to SQLite; retained ${backupPath}`);
      return store;
    } catch (error) {
      store.close();
      throw error;
    }
  }

  const registry: SessionTranscriptStoreRegistry = {
    async get(sessionId, projectPath) {
      if (disposed) {
        throw new Error('SessionTranscriptStoreRegistry is closed');
      }
      const leasedSessions = commandLeaseContext.getStore();
      const alreadyLeased = leasedSessions?.has(sessionId) === true;
      if ((maintenanceDemandCounts.get(sessionId) ?? 0) > 0 && !alreadyLeased) {
        throw new Error(`Session transcript is under maintenance: ${sessionId}`);
      }
      if (leasedSessions !== undefined && !leasedSessions.has(sessionId)) {
        leasedSessions.add(sessionId);
        commandLeaseCounts.set(sessionId, (commandLeaseCounts.get(sessionId) ?? 0) + 1);
      }
      closingSessions.delete(sessionId);
      const existing = stores.get(sessionId);
      if (existing !== undefined) {
        return existing;
      }
      const pending = openings.get(sessionId);
      if (pending !== undefined) {
        return pending;
      }
      const opening = open(sessionId, projectPath)
        .then((store) => {
          if (disposed || closingSessions.has(sessionId)) {
            store.close();
            throw new Error(`Transcript Store opening was cancelled: ${sessionId}`);
          }
          stores.set(sessionId, store);
          return store;
        })
        .finally(() => {
          openings.delete(sessionId);
        });
      openings.set(sessionId, opening);
      return opening;
    },

    async withStore(sessionId, projectPath, operation, shouldRetain) {
      if (commandLeaseContext.getStore() !== undefined) {
        return operation(await registry.get(sessionId, projectPath));
      }
      return registry.withCommandLease(
        async () => operation(await registry.get(sessionId, projectPath)),
        shouldRetain,
      );
    },

    async withCommandLease(operation, shouldRetain) {
      const leasedSessions = new Set<string>();
      try {
        return await commandLeaseContext.run(leasedSessions, operation);
      } finally {
        for (const sessionId of leasedSessions) {
          const remaining = (commandLeaseCounts.get(sessionId) ?? 1) - 1;
          if (remaining > 0) {
            commandLeaseCounts.set(sessionId, remaining);
            continue;
          }
          commandLeaseCounts.delete(sessionId);
          notifyCommandLeaseReleased(sessionId);
          const closeWasDeferred = deferredCloseSessions.delete(sessionId);
          if (closeWasDeferred || !shouldRetain(sessionId)) {
            const store = stores.get(sessionId);
            if (store !== undefined) {
              stores.delete(sessionId);
              store.close();
            }
          }
        }
      }
    },

    async withMaintenanceLease(sessionId, operation) {
      if (disposed) {
        throw new Error('SessionTranscriptStoreRegistry is closed');
      }
      maintenanceDemandCounts.set(sessionId, (maintenanceDemandCounts.get(sessionId) ?? 0) + 1);
      const previousMaintenance = maintenanceQueues.get(sessionId) ?? Promise.resolve();
      const maintenance = previousMaintenance.then(async () => {
        if (disposed) {
          throw new Error('SessionTranscriptStoreRegistry is closed');
        }
        while ((commandLeaseCounts.get(sessionId) ?? 0) > 0) {
          await waitForCommandLeaseRelease(sessionId);
          if (disposed) {
            throw new Error('SessionTranscriptStoreRegistry is closed');
          }
        }
        return operation();
      });
      const queueTail = maintenance.then(
        () => undefined,
        () => undefined,
      );
      maintenanceQueues.set(sessionId, queueTail);
      try {
        return await maintenance;
      } finally {
        decrementMaintenanceDemand(sessionId);
        if (maintenanceQueues.get(sessionId) === queueTail) {
          maintenanceQueues.delete(sessionId);
        }
        notifyCommandLeaseReleased(sessionId);
      }
    },

    async tryWithMaintenanceLease(sessionId, operation) {
      if (
        disposed ||
        (maintenanceDemandCounts.get(sessionId) ?? 0) > 0 ||
        (commandLeaseCounts.get(sessionId) ?? 0) > 0
      ) {
        return { acquired: false };
      }
      maintenanceDemandCounts.set(sessionId, 1);
      try {
        return { acquired: true, value: await operation() };
      } finally {
        decrementMaintenanceDemand(sessionId);
        notifyCommandLeaseReleased(sessionId);
      }
    },

    close(sessionId) {
      if ((commandLeaseCounts.get(sessionId) ?? 0) > 0) {
        // Suspension may release the Agent runtime while a durable export,
        // fork, duplicate, or truncate command still owns the SQLite handle.
        // Runtime residency and Store lifetime are separate authorities: defer
        // the close until the last command lease exits.
        deferredCloseSessions.add(sessionId);
        return;
      }
      closingSessions.add(sessionId);
      const store = stores.get(sessionId);
      if (store !== undefined) {
        stores.delete(sessionId);
        store.close();
      }
    },

    closeAll() {
      disposed = true;
      for (const store of stores.values()) {
        store.close();
      }
      stores.clear();
      commandLeaseCounts.clear();
      maintenanceDemandCounts.clear();
      maintenanceQueues.clear();
      for (const waiters of commandLeaseReleaseWaiters.values()) {
        for (const resolve of waiters) {
          resolve();
        }
      }
      commandLeaseReleaseWaiters.clear();
      deferredCloseSessions.clear();
      for (const sessionId of openings.keys()) {
        closingSessions.add(sessionId);
      }
    },
  };

  function waitForCommandLeaseRelease(sessionId: string): Promise<void> {
    return new Promise((resolve) => {
      const waiters = commandLeaseReleaseWaiters.get(sessionId) ?? new Set<() => void>();
      waiters.add(resolve);
      commandLeaseReleaseWaiters.set(sessionId, waiters);
    });
  }

  function notifyCommandLeaseReleased(sessionId: string): void {
    const waiters = commandLeaseReleaseWaiters.get(sessionId);
    if (!waiters) {
      return;
    }
    commandLeaseReleaseWaiters.delete(sessionId);
    for (const resolve of waiters) {
      resolve();
    }
  }

  function decrementMaintenanceDemand(sessionId: string): void {
    const remaining = (maintenanceDemandCounts.get(sessionId) ?? 1) - 1;
    if (remaining > 0) {
      maintenanceDemandCounts.set(sessionId, remaining);
    } else {
      maintenanceDemandCounts.delete(sessionId);
    }
  }
  return registry;
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'EEXIST'
  );
}

/** Doctor-facing read-only signal for an interrupted v1→v2 migration. */
export async function hasLegacyTranscriptBackup(
  rootDir: string,
  sessionId: string,
): Promise<boolean> {
  try {
    await access(getPiwinSessionTranscriptBackupPath(rootDir, sessionId));
    return true;
  } catch (error) {
    if (isNotFound(error)) {
      return false;
    }
    throw error;
  }
}

export type InterruptedTranscriptMigration = {
  sessionId: string;
  databasePath: string;
  legacyPath: string;
};

/** Read-only doctor scan; valid authoritative databases are opened then closed. */
export async function listInterruptedTranscriptMigrations(
  rootDir: string,
): Promise<InterruptedTranscriptMigration[]> {
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(getPiwinSessionsDir(rootDir), { withFileTypes: true });
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  const interrupted: InterruptedTranscriptMigration[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sessionId = entry.name;
    const databasePath = getPiwinSessionTranscriptDatabasePath(rootDir, sessionId);
    if (!(await pathExists(databasePath))) continue;
    const legacyPath = (await pathExists(getPiwinSessionTranscriptPath(rootDir, sessionId)))
      ? getPiwinSessionTranscriptPath(rootDir, sessionId)
      : getPiwinSessionTranscriptBackupPath(rootDir, sessionId);
    if (!(await pathExists(legacyPath))) continue;
    const store = await openSessionTranscriptStore({
      dbPath: databasePath,
      sessionId,
      projectPath: 'doctor-inspection',
    });
    try {
      if (!(await store.isMigrated())) {
        interrupted.push({ sessionId, databasePath, legacyPath });
      }
    } finally {
      store.close();
    }
  }
  return interrupted;
}

/**
 * Explicit doctor repair. Rebuilds into a side database, verifies it, then
 * preserves the interrupted database before selecting the repaired file.
 */
export async function repairInterruptedTranscriptMigration(
  rootDir: string,
  sessionId: string,
): Promise<{ repaired: boolean; previousDatabasePath?: string }> {
  const databasePath = getPiwinSessionTranscriptDatabasePath(rootDir, sessionId);
  const originalLegacyPath = getPiwinSessionTranscriptPath(rootDir, sessionId);
  const backupLegacyPath = getPiwinSessionTranscriptBackupPath(rootDir, sessionId);
  const legacyPath = (await pathExists(originalLegacyPath)) ? originalLegacyPath : backupLegacyPath;
  const legacy = await loadSessionTranscript(legacyPath);
  if (legacy === null) {
    throw new Error(`No legacy transcript is available to repair session ${sessionId}`);
  }
  const temporaryDatabasePath = `${databasePath}.doctor-${process.pid}-${Date.now()}`;
  const repaired = await openSessionTranscriptStore({
    dbPath: temporaryDatabasePath,
    sessionId,
    projectPath: legacy.projectPath,
  });
  try {
    await repaired.importLegacyDocument(legacy);
    const verification = await repaired.verifyLegacyDocument(legacy);
    if (!verification.matches || !(await repaired.isMigrated())) {
      throw new Error(`Rebuilt transcript failed verification for session ${sessionId}`);
    }
  } catch (error) {
    repaired.close();
    await removeSqliteFiles(temporaryDatabasePath);
    throw error;
  }
  repaired.close();

  const previousDatabasePath = `${databasePath}.interrupted-${Date.now()}.bak`;
  if (await pathExists(databasePath)) {
    await rename(databasePath, previousDatabasePath);
    await moveIfPresent(`${databasePath}-wal`, `${previousDatabasePath}-wal`);
    await moveIfPresent(`${databasePath}-shm`, `${previousDatabasePath}-shm`);
  }
  try {
    await rename(temporaryDatabasePath, databasePath);
    await moveIfPresent(`${temporaryDatabasePath}-wal`, `${databasePath}-wal`);
    await moveIfPresent(`${temporaryDatabasePath}-shm`, `${databasePath}-shm`);
  } catch (error) {
    if (await pathExists(previousDatabasePath)) {
      await rename(previousDatabasePath, databasePath);
      await moveIfPresent(`${previousDatabasePath}-wal`, `${databasePath}-wal`);
      await moveIfPresent(`${previousDatabasePath}-shm`, `${databasePath}-shm`);
    }
    throw error;
  }
  return { repaired: true, previousDatabasePath };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

async function moveIfPresent(source: string, target: string): Promise<void> {
  if (await pathExists(source)) await rename(source, target);
}

async function removeSqliteFiles(databasePath: string): Promise<void> {
  await Promise.all([
    rm(databasePath, { force: true }),
    rm(`${databasePath}-wal`, { force: true }),
    rm(`${databasePath}-shm`, { force: true }),
  ]);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}
