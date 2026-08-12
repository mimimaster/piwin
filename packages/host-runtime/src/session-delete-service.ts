import { randomUUID } from 'node:crypto';
import { cp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { SessionIndexRecord } from '@piwin/contracts';
import { deleteSessionRecord } from '@piwin/session';
import {
  assertSafePathSegment,
  getPiwinSessionDeleteTrashDir,
  getPiwinSessionDir,
  getPiwinSessionMediaDir,
} from './paths.js';

export type PermanentSessionDeleteResult = {
  removed: SessionIndexRecord;
  cleanupWarning?: string;
};

type MovedDirectory = {
  sourcePath: string;
  quarantinePath: string;
};

/**
 * Quarantine durable session files before removing their index record. An
 * index write failure restores every moved directory; a post-commit cleanup
 * failure leaves a manifest-backed copy under the product trash directory.
 */
export async function permanentlyDeleteSession(input: {
  rootDir: string;
  indexPath: string;
  sessionId: string;
}): Promise<PermanentSessionDeleteResult | undefined> {
  assertSafePathSegment(input.sessionId, 'sessionId');
  const transactionId = `${Date.now()}-${randomUUID()}`;
  const transactionPath = join(getPiwinSessionDeleteTrashDir(input.rootDir), transactionId);
  const movedDirectories: MovedDirectory[] = [];
  try {
    await mkdir(transactionPath, { recursive: true });
    await writeFile(
      join(transactionPath, 'manifest.json'),
      `${JSON.stringify(
        {
          version: 1,
          transactionId,
          sessionId: input.sessionId,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    await moveDirectoryIfPresent(
      getPiwinSessionDir(input.rootDir, input.sessionId),
      join(transactionPath, 'session'),
      movedDirectories,
    );
    await moveDirectoryIfPresent(
      getPiwinSessionMediaDir(input.rootDir, input.sessionId),
      join(transactionPath, 'media'),
      movedDirectories,
    );
    const removed = await deleteSessionRecord(input.indexPath, input.sessionId);
    if (!removed) {
      await restoreMovedDirectories(movedDirectories);
      await rm(transactionPath, { recursive: true, force: true });
      return undefined;
    }
    try {
      await rm(transactionPath, { recursive: true, force: true });
      return { removed };
    } catch (error) {
      return {
        removed,
        cleanupWarning: formatDeleteError(error),
      };
    }
  } catch (error) {
    try {
      await restoreMovedDirectories(movedDirectories);
      await rm(transactionPath, { recursive: true, force: true });
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        `Session delete failed and quarantine restore was incomplete: ${input.sessionId}`,
      );
    }
    throw error;
  }
}

async function moveDirectoryIfPresent(
  sourcePath: string,
  quarantinePath: string,
  movedDirectories: MovedDirectory[],
): Promise<void> {
  try {
    await mkdir(dirname(quarantinePath), { recursive: true });
    await rename(sourcePath, quarantinePath);
    movedDirectories.push({ sourcePath, quarantinePath });
  } catch (error) {
    if (isNotFound(error)) {
      return;
    }
    // rename() fails across devices (EXDEV). Fall back to recursive copy +
    // source removal so quarantine still works when trash and sessions are on
    // different mounts.
    if (isCrossDeviceLink(error)) {
      await cp(sourcePath, quarantinePath, { recursive: true, force: false, errorOnExist: true });
      await rm(sourcePath, { recursive: true, force: false });
      movedDirectories.push({ sourcePath, quarantinePath });
      return;
    }
    throw error;
  }
}

async function restoreMovedDirectories(movedDirectories: MovedDirectory[]): Promise<void> {
  for (const movedDirectory of [...movedDirectories].reverse()) {
    await mkdir(dirname(movedDirectory.sourcePath), { recursive: true });
    try {
      await rename(movedDirectory.quarantinePath, movedDirectory.sourcePath);
    } catch (error) {
      if (!isCrossDeviceLink(error)) {
        throw error;
      }
      await cp(movedDirectory.quarantinePath, movedDirectory.sourcePath, {
        recursive: true,
        force: false,
        errorOnExist: true,
      });
      await rm(movedDirectory.quarantinePath, { recursive: true, force: false });
    }
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}

function isCrossDeviceLink(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'EXDEV'
  );
}

function formatDeleteError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
