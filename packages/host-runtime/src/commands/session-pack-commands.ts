/**
 * Non-destructive session pack commands (Cold Storage R1 PR1).
 *
 * Handles:
 *   - session/pack-create
 *   - session/pack-verify
 *   - session/pack-list
 *
 * Never mutates session payload. Create closes the transcript store under a
 * maintenance lease, checkpoints WAL, packs, publishes externally, and verifies.
 */
import { realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type {
  HostCommand,
  HostResponse,
  SessionPackCreateResultData,
  SessionPackListData,
  SessionPackVerifyResultData,
} from '@piwin/contracts';
import {
  assertSafeSessionPackId,
  formatError,
} from '@piwin/contracts';
import {
  createSessionPack,
  getSessionRecord,
  listSessionPacks,
  verifySessionPack,
} from '@piwin/session';
import { fail, ok } from '../response-helpers.js';
import {
  getPiwinPackStagingDir,
  getPiwinRoot,
  getPiwinSessionIndexPath,
  getPiwinSessionMediaDir,
  getPiwinSessionTranscriptDatabasePath,
} from '../paths.js';

export type SessionPackCommandContext = {
  piwinRoot?: string;
  /**
   * Run an exclusive transcript-store maintenance operation for one session:
   * block new leases, wait for existing leases, close the store, then run.
   */
  withTranscriptMaintenance: <T>(sessionId: string, operation: () => Promise<T>) => Promise<T>;
  /** Whether the session currently has a live generation / resident runtime. */
  isLiveSession?: (sessionId: string) => boolean | Promise<boolean>;
};

const PACK_COMMAND_TYPES = new Set<HostCommand['type']>([
  'session/pack-create',
  'session/pack-verify',
  'session/pack-list',
]);

export function isSessionPackCommand(command: HostCommand): boolean {
  return PACK_COMMAND_TYPES.has(command.type);
}

export async function handleSessionPackCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: SessionPackCommandContext,
): Promise<HostResponse | null> {
  if (!isSessionPackCommand(command)) {
    return null;
  }
  try {
    switch (command.type) {
      case 'session/pack-create':
        return ok(requestId, command.type, await handlePackCreate(command, context));
      case 'session/pack-verify':
        return ok(requestId, command.type, await handlePackVerify(command));
      case 'session/pack-list':
        return ok(requestId, command.type, await handlePackList(command));
      default:
        return null;
    }
  } catch (error) {
    return fail(requestId, command.type, formatError(error));
  }
}

async function handlePackCreate(
  command: Extract<HostCommand, { type: 'session/pack-create' }>,
  context: SessionPackCommandContext,
): Promise<SessionPackCreateResultData> {
  const rootDir = getPiwinRoot(context.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const record = await getSessionRecord(indexPath, command.sessionId);
  if (!record) {
    throw new Error(`Unknown session: ${command.sessionId}`);
  }
  if (context.isLiveSession) {
    const live = await context.isLiveSession(command.sessionId);
    if (live) {
      throw new Error(`Session is live and cannot be packed: ${command.sessionId}`);
    }
  }

  const outputDir = await resolveExternalOutputDir(command.outputDir, rootDir);
  if (command.packId !== undefined) {
    assertSafeSessionPackId(command.packId);
  }

  return context.withTranscriptMaintenance(command.sessionId, async () => {
    return createSessionPack({
      record,
      outputDir,
      ...(command.packId ? { packId: command.packId } : {}),
      paths: {
        transcriptPath: getPiwinSessionTranscriptDatabasePath(rootDir, command.sessionId),
        mediaDir: getPiwinSessionMediaDir(rootDir, command.sessionId),
        stagingDir: getPiwinPackStagingDir(rootDir),
      },
    });
  });
}

async function handlePackVerify(
  command: Extract<HostCommand, { type: 'session/pack-verify' }>,
): Promise<SessionPackVerifyResultData> {
  const packPath = resolveAbsolutePath(command.packPath, 'packPath');
  return verifySessionPack({ packPath });
}

async function handlePackList(
  command: Extract<HostCommand, { type: 'session/pack-list' }>,
): Promise<SessionPackListData> {
  const directory = resolveAbsolutePath(command.directory, 'directory');
  return listSessionPacks({ directory });
}

async function resolveExternalOutputDir(outputDir: string, piwinRoot: string): Promise<string> {
  const resolvedOutput = resolveAbsolutePath(outputDir, 'outputDir');
  const resolvedRoot = resolve(piwinRoot);
  let outputReal = resolvedOutput;
  let rootReal = resolvedRoot;
  try {
    outputReal = await realpath(resolvedOutput);
  } catch {
    // Directory may not exist yet; createSessionPack will mkdir.
  }
  try {
    rootReal = await realpath(resolvedRoot);
  } catch {
    // Root may be a fresh temp fixture.
  }
  if (outputReal === rootReal || outputReal.startsWith(`${rootReal}/`)) {
    throw new Error(
      `Pack outputDir must be outside the piwin root (${resolvedRoot}): ${resolvedOutput}`,
    );
  }
  // Also reject packing into the sessions/media trees even if piwinRoot is a symlink alias.
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

