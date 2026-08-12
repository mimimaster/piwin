/**
 * Manual cold-storage plan / execute / restore / reconcile (R1 PR3).
 *
 * Plans live only in Host memory. Destructive offload requires the plan
 * confirmation digest. Journals under ~/.piwin/cold-storage/transactions/
 * recover crash mid-move; they are never executable delete tickets.
 */
import { realpath, statfs } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type {
  HostCommand,
  HostResponse,
  SessionColdStorageConfig,
  SessionColdStorageExecuteResult,
  SessionColdStoragePlan,
  SessionColdStorageRestoreResult,
  SessionColdStorageStatus,
} from '@piwin/contracts';
import { createDefaultSessionColdStorageConfig, formatError } from '@piwin/contracts';
import {
  buildSessionColdStoragePlan,
  coldStoragePathExists,
  createColdStorageConfirmationDigest,
  evaluateColdStorageEligibility,
  getSessionRecord,
  hashSessionPayload,
  listAllSessionRecords,
  listColdStorageJournals,
  offloadSessionPayload,
  reconcileSessionColdStorage,
  restoreSessionPayload,
  verifySessionPack,
} from '@piwin/session';
import { fail, ok } from '../response-helpers.js';
import { loadPiwinConfig } from '../config-store.js';
import {
  getPiwinPackStagingDir,
  getPiwinRoot,
  getPiwinSessionIndexPath,
  getPiwinSessionMediaDir,
  getPiwinSessionTranscriptDatabasePath,
} from '../paths.js';
import type { SessionStorageCoordinator } from '../session-storage-coordinator.js';

export type SessionColdStorageCommandContext = {
  piwinRoot?: string;
  withTranscriptMaintenance: <T>(sessionId: string, operation: () => Promise<T>) => Promise<T>;
  storageCoordinator: SessionStorageCoordinator;
  isLiveSession: (sessionId: string) => boolean | Promise<boolean>;
  rememberPlan: (plan: SessionColdStoragePlan) => void;
  takePlan: (planId: string) => SessionColdStoragePlan | undefined;
};

const COMMAND_TYPES = new Set<HostCommand['type']>([
  'session/cold-storage-status',
  'session/cold-storage-plan',
  'session/cold-storage-execute',
  'session/cold-storage-restore',
  'session/cold-storage-import',
  'session/cold-storage-reconcile',
]);

export function isSessionColdStorageCommand(command: HostCommand): boolean {
  return COMMAND_TYPES.has(command.type);
}

export async function handleSessionColdStorageCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: SessionColdStorageCommandContext,
): Promise<HostResponse | null> {
  if (!isSessionColdStorageCommand(command)) {
    return null;
  }
  try {
    switch (command.type) {
      case 'session/cold-storage-status':
        return ok(requestId, command.type, await handleStatus(context));
      case 'session/cold-storage-plan':
        return ok(requestId, command.type, await handlePlan(command.sessionIds, context));
      case 'session/cold-storage-execute':
        return ok(
          requestId,
          command.type,
          await handleExecute(command.planId, command.confirmationDigest, context),
        );
      case 'session/cold-storage-restore':
        return ok(
          requestId,
          command.type,
          await handleRestore(command.sessionId, command.packPath, context),
        );
      case 'session/cold-storage-import':
        return ok(requestId, command.type, await handleImport(command.packPath, context));
      case 'session/cold-storage-reconcile':
        return ok(requestId, command.type, await handleReconcile(context));
      default:
        return null;
    }
  } catch (error) {
    return fail(requestId, command.type, formatError(error));
  }
}

async function handleStatus(
  context: SessionColdStorageCommandContext,
): Promise<SessionColdStorageStatus> {
  const rootDir = getPiwinRoot(context.piwinRoot);
  const config = await loadColdStorageConfig(rootDir);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const records = await listAllSessionRecords(indexPath);
  let localPayloadBytes = 0;
  let eligibleCount = 0;
  for (const record of records) {
    const paths = resolvePayloadPaths(rootDir, record.id);
    if (await coldStoragePathExists(paths.transcriptPath)) {
      try {
        localPayloadBytes += (await hashSessionPayload(paths)).payloadBytes;
      } catch {
        // Status is best-effort; skip unreadable payloads.
      }
    }
    const live = await context.isLiveSession(record.id);
    const eligibility = evaluateColdStorageEligibility({
      record,
      config,
      live,
      transcriptExists: await coldStoragePathExists(paths.transcriptPath),
      ignoreAge: true,
    });
    if (eligibility.eligible) {
      eligibleCount += 1;
    }
  }
  const journals = await listColdStorageJournals(rootDir);
  const missingPackSessionIds = records
    .filter((record) => record.storage?.state === 'missing-pack')
    .map((record) => record.id);
  const packOutputDirValid = await isValidPackOutputDir(config.packOutputDir, rootDir);
  const overBudget =
    typeof config.localBudgetBytes === 'number' && localPayloadBytes > config.localBudgetBytes;
  return {
    config,
    packOutputDirValid,
    localPayloadBytes,
    overBudget,
    eligibleCount,
    residualTransactions: journals.map((journal) => ({
      transactionId: journal.transactionId,
      sessionId: journal.sessionId,
      kind: journal.kind,
      phase: journal.phase,
    })),
    missingPackSessionIds,
  };
}

async function handlePlan(
  sessionIds: string[] | undefined,
  context: SessionColdStorageCommandContext,
): Promise<SessionColdStoragePlan> {
  const rootDir = getPiwinRoot(context.piwinRoot);
  const config = await loadColdStorageConfig(rootDir);
  if (config.enabled !== true) {
    throw new Error('Cold storage is disabled. Enable session.coldStorage.enabled first.');
  }
  const packOutputDir = await resolveExternalOutputDir(config.packOutputDir, rootDir);
  const records = await listAllSessionRecords(getPiwinSessionIndexPath(rootDir));
  const plan = await buildSessionColdStoragePlan({
    records,
    config: { ...config, packOutputDir },
    resolvePaths: (sessionId) => resolvePayloadPaths(rootDir, sessionId),
    isLive: (sessionId) => context.isLiveSession(sessionId),
    transcriptExists: (sessionId) =>
      coldStoragePathExists(resolvePayloadPaths(rootDir, sessionId).transcriptPath),
    ...(sessionIds ? { explicitSessionIds: sessionIds } : {}),
  });
  context.rememberPlan(plan);
  return plan;
}

async function handleExecute(
  planId: string,
  confirmationDigest: string,
  context: SessionColdStorageCommandContext,
): Promise<SessionColdStorageExecuteResult> {
  const rootDir = getPiwinRoot(context.piwinRoot);
  const remembered = context.takePlan(planId);
  if (!remembered) {
    throw new Error(`Cold storage plan is unknown or expired: ${planId}`);
  }
  if (Date.parse(remembered.expiresAt) <= Date.now()) {
    throw new Error(`Cold storage plan expired: ${planId}`);
  }
  const expectedDigest = createColdStorageConfirmationDigest({
    planId: remembered.planId,
    packOutputDir: remembered.packOutputDir,
    targets: remembered.targets,
  });
  if (confirmationDigest !== remembered.confirmationDigest || confirmationDigest !== expectedDigest) {
    throw new Error('Cold storage confirmation digest does not match the plan');
  }
  const config = await loadColdStorageConfig(rootDir);
  if (config.enabled !== true) {
    throw new Error('Cold storage is disabled');
  }
  const packOutputDir = await resolveExternalOutputDir(config.packOutputDir, rootDir);
  if (packOutputDir !== remembered.packOutputDir) {
    throw new Error('packOutputDir changed since the plan was created');
  }
  await assertEnoughDisk(packOutputDir, remembered.estimatedPeakBytes);

  const result: SessionColdStorageExecuteResult = {
    planId,
    executedAt: new Date().toISOString(),
    offloaded: [],
    failed: [],
  };
  const indexPath = getPiwinSessionIndexPath(rootDir);
  for (const target of remembered.targets) {
    try {
      const offloaded = await context.storageCoordinator.withLock(target.sessionId, () =>
        context.withTranscriptMaintenance(target.sessionId, async () => {
          if (await context.isLiveSession(target.sessionId)) {
            throw new Error(`Session is live and cannot be offloaded: ${target.sessionId}`);
          }
          const record = await getSessionRecord(indexPath, target.sessionId);
          if (!record) {
            throw new Error(`Unknown session: ${target.sessionId}`);
          }
          const paths = resolvePayloadPaths(rootDir, target.sessionId);
          return offloadSessionPayload({
            rootDir,
            indexPath,
            record,
            transcriptPath: paths.transcriptPath,
            mediaDir: paths.mediaDir,
            stagingDir: getPiwinPackStagingDir(rootDir),
            outputDir: packOutputDir,
            expectedTranscriptSha256: target.transcriptSha256,
            ...(target.mediaTreeSha256
              ? { expectedMediaTreeSha256: target.mediaTreeSha256 }
              : {}),
          });
        }),
      );
      result.offloaded.push({
        sessionId: offloaded.sessionId,
        packId: offloaded.packId,
        packPath: offloaded.packPath,
        payloadBytes: offloaded.payloadBytes,
      });
    } catch (error) {
      result.failed.push({ sessionId: target.sessionId, error: formatError(error) });
    }
  }
  return result;
}

async function handleRestore(
  sessionId: string,
  packPath: string | undefined,
  context: SessionColdStorageCommandContext,
): Promise<SessionColdStorageRestoreResult> {
  const rootDir = getPiwinRoot(context.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const record = await getSessionRecord(indexPath, sessionId);
  const resolvedPackPath = packPath ?? record?.storage?.packPath;
  if (!resolvedPackPath) {
    throw new Error(`No pack path supplied for session ${sessionId}`);
  }
  const absolutePack = resolveAbsolutePath(resolvedPackPath, 'packPath');
  return context.storageCoordinator.withLock(sessionId, () =>
    context.withTranscriptMaintenance(sessionId, async () => {
      if (await context.isLiveSession(sessionId)) {
        throw new Error(`Session is live and cannot be restored: ${sessionId}`);
      }
      const paths = resolvePayloadPaths(rootDir, sessionId);
      const restored = await restoreSessionPayload({
        rootDir,
        indexPath,
        sessionId,
        packPath: absolutePack,
        transcriptPath: paths.transcriptPath,
        mediaDir: paths.mediaDir,
      });
      const latest = await getSessionRecord(indexPath, sessionId);
      return {
        sessionId: restored.sessionId,
        packId: restored.packId,
        packPath: restored.packPath,
        createdIndexRecord: restored.createdIndexRecord,
        storage: latest?.storage ?? { state: 'local' },
      };
    }),
  );
}

async function handleImport(
  packPath: string,
  context: SessionColdStorageCommandContext,
): Promise<SessionColdStorageRestoreResult> {
  const verified = await verifySessionPack({ packPath: resolveAbsolutePath(packPath, 'packPath') });
  return handleRestore(verified.sessionId, verified.packPath, context);
}

async function handleReconcile(context: SessionColdStorageCommandContext) {
  const rootDir = getPiwinRoot(context.piwinRoot);
  return reconcileSessionColdStorage({
    rootDir,
    indexPath: getPiwinSessionIndexPath(rootDir),
    resolvePaths: (sessionId) => resolvePayloadPaths(rootDir, sessionId),
  });
}

async function loadColdStorageConfig(rootDir: string): Promise<SessionColdStorageConfig> {
  const config = await loadPiwinConfig(rootDir);
  return config.session?.coldStorage ?? createDefaultSessionColdStorageConfig();
}

function resolvePayloadPaths(rootDir: string, sessionId: string) {
  return {
    transcriptPath: getPiwinSessionTranscriptDatabasePath(rootDir, sessionId),
    mediaDir: getPiwinSessionMediaDir(rootDir, sessionId),
  };
}

async function isValidPackOutputDir(
  outputDir: string | undefined,
  piwinRoot: string,
): Promise<boolean> {
  if (!outputDir) {
    return false;
  }
  try {
    await resolveExternalOutputDir(outputDir, piwinRoot);
    return true;
  } catch {
    return false;
  }
}

async function resolveExternalOutputDir(
  outputDir: string | undefined,
  piwinRoot: string,
): Promise<string> {
  if (!outputDir) {
    throw new Error('session.coldStorage.packOutputDir is required');
  }
  const resolvedOutput = resolveAbsolutePath(outputDir, 'packOutputDir');
  const resolvedRoot = resolve(piwinRoot);
  let outputReal = resolvedOutput;
  let rootReal = resolvedRoot;
  try {
    outputReal = await realpath(resolvedOutput);
  } catch {
    // Directory may not exist yet.
  }
  try {
    rootReal = await realpath(resolvedRoot);
  } catch {
    // Fresh fixture root.
  }
  if (outputReal === rootReal || outputReal.startsWith(`${rootReal}/`)) {
    throw new Error(
      `Pack outputDir must be outside the piwin root (${resolvedRoot}): ${resolvedOutput}`,
    );
  }
  return resolvedOutput;
}

function resolveAbsolutePath(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  if (!isAbsolute(value)) {
    throw new Error(`${label} must be an absolute Host filesystem path: ${value}`);
  }
  return resolve(value);
}

async function assertEnoughDisk(directory: string, estimatedPeakBytes: number): Promise<void> {
  const margin = 64 * 1024 * 1024;
  try {
    const stats = await statfs(directory);
    const free = Number(stats.bavail) * Number(stats.bsize);
    if (Number.isFinite(free) && free < estimatedPeakBytes + margin) {
      throw new Error(
        `Not enough free disk at ${directory}: need ${estimatedPeakBytes + margin} bytes`,
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Not enough free disk')) {
      throw error;
    }
    // Directory may not exist yet; check the parent.
    try {
      const stats = await statfs(resolve(directory, '..'));
      const free = Number(stats.bavail) * Number(stats.bsize);
      if (Number.isFinite(free) && free < estimatedPeakBytes + margin) {
        throw new Error(
          `Not enough free disk near ${directory}: need ${estimatedPeakBytes + margin} bytes`,
        );
      }
    } catch (nested) {
      if (nested instanceof Error && nested.message.startsWith('Not enough free disk')) {
        throw nested;
      }
    }
  }
}


