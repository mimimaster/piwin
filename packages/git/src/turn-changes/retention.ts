/**
 * Turn-change retention sweep.
 *
 * 1. Turns whose runs all ended more than `retentionMs` ago are expired: their
 *    references are dropped, their summaries and line counts stay. A turn
 *    undone or redone within the last 7 days waits, so 恢复改动 still works.
 * 2. Object files nothing references are deleted once older than `graceMs`.
 *    The grace covers bytes put a moment before their reference is recorded;
 *    reusing an existing object refreshes its age (object-store `put`), and
 *    the age is re-checked immediately before each delete.
 * 3. Leftover temp files older than the grace are removed.
 *
 * The result reports what is left on disk, which the storage budget uses as
 * its measured total (storage-budget.ts). Over budget, the sweep deletes
 * nothing extra: protected data (live turns, 7-day 恢复改动, applying or
 * needs-repair operations) is never traded for space; new turns are marked
 * `storage-full` instead.
 */
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import type { TurnChangeStore } from './store.js';

export const DEFAULT_TURN_CHANGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** A finished undo/redo keeps its turn (and 恢复改动) at least this long. */
export const DEFAULT_TURN_CHANGE_OPERATION_PROTECT_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_TURN_CHANGE_OBJECT_GRACE_MS = 24 * 60 * 60 * 1000;
const EXPIRE_BATCH = 500;

export type TurnChangeRetentionResult = {
  expiredChangeSets: number;
  deletedObjects: number;
  freedBytes: number;
  deletedTempFiles: number;
  /** Object bytes left on disk after the sweep. */
  storedBytes: number;
};

async function listDirectory(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return [];
    throw error;
  }
}

/** Delete `path` if it is still older than `cutoffMs`; returns the bytes freed. */
async function deleteIfStillOld(path: string, cutoffMs: number): Promise<number | null> {
  const info = await stat(path).catch(() => null);
  if (!info || !info.isFile() || info.mtimeMs >= cutoffMs) return null;
  await unlink(path);
  return info.size;
}

export async function sweepTurnChangeRetention(input: {
  store: TurnChangeStore;
  rootDir: string;
  now?: () => number;
  retentionMs?: number;
  graceMs?: number;
}): Promise<TurnChangeRetentionResult> {
  const now = (input.now ?? Date.now)();
  const retentionCutoff = new Date(now - (input.retentionMs ?? DEFAULT_TURN_CHANGE_RETENTION_MS));
  const operationCutoff = new Date(now - DEFAULT_TURN_CHANGE_OPERATION_PROTECT_MS);
  const graceCutoff = now - (input.graceMs ?? DEFAULT_TURN_CHANGE_OBJECT_GRACE_MS);

  let expiredChangeSets = 0;
  for (;;) {
    const batch = input.store.listExpirableChangeSets(
      retentionCutoff.toISOString(),
      EXPIRE_BATCH,
      operationCutoff.toISOString(),
    );
    for (const changeSetId of batch) {
      input.store.expireChangeSet(changeSetId);
    }
    expiredChangeSets += batch.length;
    if (batch.length < EXPIRE_BATCH) break;
  }

  const referenced = input.store.listReferencedObjectHashes();
  const objectsDir = join(input.rootDir, 'objects');
  let deletedObjects = 0;
  let freedBytes = 0;
  let storedBytes = 0;
  for (const prefix of await listDirectory(objectsDir)) {
    if (!/^[0-9a-f]{2}$/.test(prefix)) continue;
    for (const rest of await listDirectory(join(objectsDir, prefix))) {
      const sha256 = `${prefix}${rest}`;
      const path = join(objectsDir, prefix, rest);
      if (/^[0-9a-f]{64}$/.test(sha256) && !referenced.has(sha256)) {
        const freed = await deleteIfStillOld(path, graceCutoff);
        if (freed !== null) {
          input.store.deleteOrphanRefs(sha256);
          deletedObjects += 1;
          freedBytes += freed;
          continue;
        }
      }
      storedBytes += (await stat(path).catch(() => null))?.size ?? 0;
    }
  }

  let deletedTempFiles = 0;
  const tempDir = join(input.rootDir, 'temp');
  for (const name of await listDirectory(tempDir)) {
    if ((await deleteIfStillOld(join(tempDir, name), graceCutoff)) !== null) {
      deletedTempFiles += 1;
    }
  }

  return { expiredChangeSets, deletedObjects, freedBytes, deletedTempFiles, storedBytes };
}
