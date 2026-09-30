/**
 * Everything an undo/redo must pass before its first write. Shared by the
 * runner and `turn-changes/check`, so 重新检查 answers what undo would do.
 *
 * A `skippable` file (undo of a file only commands created) that changed or
 * vanished since the turn does not refuse the operation: it is reported and
 * left out of it. Every other file must still match.
 *
 * Order of reasons (first match wins): a file moved since the turn
 * (`files-changed`, the one users can act on), a path the Host cannot read or
 * write (`permission-denied`), staged/unmerged Git entries (`staged-paths`),
 * then undo data the object store cannot serve (`backup-failed`).
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { findIndexBlockedPaths } from './git-safety.js';
import type { TurnChangeObjectStore } from './object-store.js';
import type { PlannedFileOp } from './operation-plan.js';
import { assertWritableTurnChangeFile } from './path-policy.js';

export type TurnChangePrecheckReason =
  | 'files-changed'
  | 'permission-denied'
  | 'staged-paths'
  | 'backup-failed';

export type TurnChangePrecheckResult =
  | {
      ok: true;
      /** `skippable` files that changed since the turn: the operation leaves them alone. */
      skipped?: string[];
      /** `skippable` files that are already gone: there is nothing to undo for them. */
      gone?: string[];
    }
  | { ok: false; reason: TurnChangePrecheckReason; affectedPaths: string[] };

type PathState = 'matches' | 'changed' | 'gone' | 'no-access';

export async function precheckTurnChangeOperation(input: {
  workspaceRoot: string;
  files: readonly PlannedFileOp[];
  /** Omitted by callers that only need the file-state checks. */
  objectStore?: TurnChangeObjectStore;
}): Promise<TurnChangePrecheckResult> {
  const changed: string[] = [];
  const noAccess: string[] = [];
  const skipped: string[] = [];
  const gone: string[] = [];
  for (const file of input.files) {
    const state = await readPathState(input.workspaceRoot, file);
    if (state === 'matches') continue;
    if (state === 'no-access') {
      noAccess.push(file.relativePath);
    } else if (file.skippable === true) {
      (state === 'gone' ? gone : skipped).push(file.relativePath);
    } else {
      changed.push(file.relativePath);
    }
  }
  if (changed.length > 0) return { ok: false, reason: 'files-changed', affectedPaths: changed };
  if (noAccess.length > 0) return { ok: false, reason: 'permission-denied', affectedPaths: noAccess };

  // What is left of the plan once the files the operation leaves alone are out.
  const left = new Set([...skipped, ...gone]);
  const active = input.files.filter((file) => !left.has(file.relativePath));
  const staged = await findIndexBlockedPaths(
    input.workspaceRoot,
    active.map((file) => file.relativePath),
  );
  if (staged.length > 0) return { ok: false, reason: 'staged-paths', affectedPaths: staged };

  if (input.objectStore) {
    const missing = await findMissingObjects(input.objectStore, active);
    if (missing.length > 0) return { ok: false, reason: 'backup-failed', affectedPaths: missing };
  }
  return {
    ok: true,
    ...(skipped.length > 0 ? { skipped } : {}),
    ...(gone.length > 0 ? { gone } : {}),
  };
}

/**
 * Paths whose current bytes are not what the plan expects to start from.
 * Kept for callers that only compare content (a read failure counts as moved).
 */
export async function collectMismatchedPaths(
  workspaceRoot: string,
  files: readonly PlannedFileOp[],
): Promise<string[]> {
  const affectedPaths: string[] = [];
  for (const file of files) {
    if ((await readPathState(workspaceRoot, file)) !== 'matches') {
      affectedPaths.push(file.relativePath);
    }
  }
  return affectedPaths;
}

async function readPathState(workspaceRoot: string, file: PlannedFileOp): Promise<PathState> {
  try {
    const resolved = await assertWritableTurnChangeFile({
      workspaceRoot,
      relativePath: file.relativePath,
    });
    if (resolved.kind === 'missing') {
      return file.fromExists || file.fromSha !== null ? 'gone' : 'matches';
    }
    if (!file.fromExists || file.fromSha === null) return 'changed';
    const bytes = new Uint8Array(await readFile(resolved.absolutePath));
    return sha256Hex(bytes) === file.fromSha ? 'matches' : 'changed';
  } catch (error) {
    // Unreadable is its own answer; anything else (symlink out of the
    // workspace, now a directory) means the path is no longer what the turn left.
    return isAccessError(error) ? 'no-access' : 'changed';
  }
}

/**
 * The runner writes `toSha` and keeps `fromSha` as the per-file backup; both
 * must be in the store before the first write, or a failure halfway would
 * have nothing to write or roll back from.
 */
async function findMissingObjects(
  objectStore: TurnChangeObjectStore,
  files: readonly PlannedFileOp[],
): Promise<string[]> {
  const missing: string[] = [];
  for (const file of files) {
    const needed = [file.toExists ? file.toSha : null, file.fromExists ? file.fromSha : null];
    for (const sha of needed) {
      if (sha === null) continue;
      const present = await objectStore.stat(sha).catch(() => undefined);
      if (present === undefined) {
        missing.push(file.relativePath);
        break;
      }
    }
  }
  return missing;
}

function isAccessError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'EACCES' || code === 'EPERM';
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
