/**
 * Shared per-project writer slot.
 *
 * Writes are already serialized per project (`SubagentWorkspaceService` holds
 * one write lock), but each task used to get a fresh `git worktree add` plus a
 * fresh dependency install. On this machine that cost ~120 MB of checkout and
 * an install per task, and the installs were failing outright — so the counts
 * grew without buying isolation that the write lock was not already providing.
 *
 * One slot per project removes both costs:
 *  - the checkout is created once and reset in place between tasks;
 *  - dependency directories survive the reset, so an unchanged lockfile means
 *    the install is reused instead of redone.
 *
 * The slot is *shared*, never task-private, so nothing may treat its path as
 * belonging to one result. A result's durable identity is its frozen Git
 * snapshot (`refs/piwin/results/<resultId>`), which is what lets the slot be
 * reset for the next task immediately after a task freezes.
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import {
  commitResultSnapshot,
  createWorktree,
  isWorktreeUsable,
  removeWorktree,
  resetWorktreeToBase,
  runGitCommand,
  worktreeRepositoryKey,
  writeWorktreeResultTree,
} from '@piwin/git';
import {
  DEFAULT_WRITER_SLOT_ID,
  WRITER_SLOT_BRANCH_PREFIX,
  isWriterSlotBranch,
  isWriterSlotName,
  isWriterSlotWorktreePath,
} from '@piwin/contracts';

// Slot identity is shared with the Desktop, which must not offer to open a
// shared slot as a task's own working tree. Re-exported here so Host callers
// keep one import site.
export {
  DEFAULT_WRITER_SLOT_ID,
  isWriterSlotBranch,
  isWriterSlotName,
  isWriterSlotWorktreePath,
};

const SLOT_RECORD_VERSION = 1;

export type WriterSlotState =
  /** Free for the next task. */
  | 'idle'
  /** Held by a task. */
  | 'leased'
  /** Reset failed or the checkout is unusable; rebuild before reuse. */
  | 'dirty';

export type WriterSlotRecord = {
  version: typeof SLOT_RECORD_VERSION;
  slotId: string;
  parentRepoPath: string;
  worktreePath: string;
  worktreeBranch: string;
  state: WriterSlotState;
  /** Base commit currently checked out, when known. */
  baseCommit?: string;
  /** Dependency fingerprint of the install that is in the slot. */
  dependencyFingerprint?: string;
  updatedAt: string;
};

export type WriterSlotAcquireResult = {
  slotId: string;
  worktreePath: string;
  worktreeBranch: string;
  baseCommit: string;
  /** Dependency fingerprint left by the previous task, for reuse decisions. */
  previousDependencyFingerprint?: string;
  /** The checkout had to be created or rebuilt rather than reset. */
  rebuilt: boolean;
};

/** Git operations the pool needs. Injected so the pool stays unit-testable. */
export type WriterSlotGitPort = {
  createWorktree: typeof createWorktree;
  removeWorktree: typeof removeWorktree;
  resetWorktreeToBase: typeof resetWorktreeToBase;
  isWorktreeUsable: typeof isWorktreeUsable;
  worktreeRepositoryKey: typeof worktreeRepositoryKey;
  writeWorktreeResultTree: typeof writeWorktreeResultTree;
  commitResultSnapshot: typeof commitResultSnapshot;
  /** Tree OID of a commit, to tell a stale slot with work from a clean one. */
  treeOfCommit: (repoPath: string, commit: string) => Promise<string>;
};

const defaultGitPort: WriterSlotGitPort = {
  createWorktree,
  removeWorktree,
  resetWorktreeToBase,
  isWorktreeUsable,
  worktreeRepositoryKey,
  writeWorktreeResultTree,
  commitResultSnapshot,
  treeOfCommit: async (repoPath, commit) =>
    (await runGitCommand({ cwd: repoPath, args: ['rev-parse', `${commit}^{tree}`] })).stdout.trim(),
};

export type WriterSlotPool = {
  acquire(input: {
    projectPath: string;
    storageRoot: string;
    baseCommit: string;
    /** Fingerprint recorded before a reset that preserved the install. */
    previousDependencyFingerprint?: string | undefined;
    slotId?: string;
  }): Promise<WriterSlotAcquireResult>;
  /** Record the fingerprint of the deps now in the slot. */
  recordDependencyFingerprint(input: {
    projectPath: string;
    storageRoot: string;
    slotId: string;
    fingerprint: string | undefined;
    baseCommit: string;
  }): Promise<void>;
  /** Release the slot after a task froze its result. */
  release(input: {
    projectPath: string;
    storageRoot: string;
    slotId: string;
    /** Reset failed or the copy is unusable; rebuild on next acquire. */
    dirty?: boolean;
  }): Promise<void>;
  read(input: { projectPath: string; storageRoot: string; slotId?: string }): Promise<
    WriterSlotRecord | undefined
  >;
};

export function createWriterSlotPool(
  options: {
    now?: () => Date;
    git?: Partial<WriterSlotGitPort>;
    /** Diagnostics for recoveries the pool performs on its own. */
    onWarning?: (message: string) => void;
  } = {},
): WriterSlotPool {
  const git = { ...defaultGitPort, ...options.git };
  const now = options.now ?? (() => new Date());
  const warn = options.onWarning ?? ((message: string) => console.warn(`[writer-slot] ${message}`));

  /**
   * A slot still `leased` when the next acquire arrives was held by a task
   * that never finished (the project write lock is in-process, so a live
   * holder is impossible here): the Host died mid-run. Its copy may hold the
   * only version of unfrozen work, so freeze it under a recovery ref before
   * the reset wipes it. Best effort: a failure is reported, not fatal, since
   * refusing would block every later write task on this project.
   */
  async function preserveStaleLease(input: {
    projectPath: string;
    worktreePath: string;
    slotId: string;
    record: WriterSlotRecord;
  }): Promise<void> {
    const staleBase = input.record.baseCommit;
    if (staleBase === undefined) return;
    try {
      const { tree } = await git.writeWorktreeResultTree({
        worktreePath: input.worktreePath,
        baseCommit: staleBase,
      });
      if (tree === (await git.treeOfCommit(input.projectPath, staleBase))) return;
      const resultId = `recovered-${input.slotId}-${now().toISOString().replace(/[:.]/g, '-')}`;
      const snapshot = await git.commitResultSnapshot({
        repoPath: input.projectPath,
        tree,
        baseCommit: staleBase,
        resultId,
      });
      warn(`slot ${input.slotId} was left leased; unfrozen work kept at ${snapshot.ref}`);
    } catch (error) {
      warn(
        `slot ${input.slotId} was left leased and could not be preserved before reset: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * `git worktree remove` cannot drop a directory that is no longer a
   * registered checkout (lost `.git` file, half-created copy), and a leftover
   * directory makes `createWorktree` fail on every later task. The slot path is
   * product-owned storage, so remove it outright.
   */
  async function clearSlotDirectory(worktreePath: string): Promise<void> {
    const exists = await stat(worktreePath).then(
      () => true,
      () => false,
    );
    if (exists) await rm(worktreePath, { recursive: true, force: true });
  }

  function slotPaths(input: {
    projectPath: string;
    storageRoot: string;
    slotId: string;
  }): { worktreePath: string; recordPath: string; worktreeBranch: string } {
    const repositoryKey = git.worktreeRepositoryKey(input.projectPath);
    const root = join(resolve(input.storageRoot), repositoryKey);
    return {
      worktreePath: join(root, input.slotId),
      recordPath: join(root, `${input.slotId}.json`),
      worktreeBranch: `${WRITER_SLOT_BRANCH_PREFIX}${input.slotId}`,
    };
  }

  async function readRecord(recordPath: string): Promise<WriterSlotRecord | undefined> {
    try {
      const parsed = JSON.parse(await readFile(recordPath, 'utf8')) as WriterSlotRecord;
      if (parsed.version !== SLOT_RECORD_VERSION || typeof parsed.slotId !== 'string') {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
    }
  }

  async function writeRecord(recordPath: string, record: WriterSlotRecord): Promise<void> {
    await mkdir(dirname(recordPath), { recursive: true });
    // Write-then-rename: a crash must not leave a half-written record that
    // claims a slot is ready when it is not.
    const temporaryPath = `${recordPath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, recordPath);
  }

  async function acquire(
    input: Parameters<WriterSlotPool['acquire']>[0],
  ): Promise<WriterSlotAcquireResult> {
    const slotId = input.slotId ?? DEFAULT_WRITER_SLOT_ID;
    const paths = slotPaths({ ...input, slotId });
    const record = await readRecord(paths.recordPath);
    const usable =
      record !== undefined &&
      record.state !== 'dirty' &&
      (await git.isWorktreeUsable(paths.worktreePath));

    if (!usable) {
      // Drop whatever is there (stale registration, dirty copy) and recreate.
      // A rebuild is the only path that may fail the task: never open a second
      // copy, because two writer copies per project is what this replaces.
      await git
        .removeWorktree({
          projectPath: input.projectPath,
          worktreePath: paths.worktreePath,
          force: true,
          worktreeBranch: paths.worktreeBranch,
        })
        .catch((error: unknown) => {
          warn(
            `slot ${slotId} removal failed; clearing its directory: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      await clearSlotDirectory(paths.worktreePath);
      const created = await git.createWorktree({
        projectPath: input.projectPath,
        name: slotId,
        baseRef: input.baseCommit,
        storageRoot: input.storageRoot,
      });
      await git.resetWorktreeToBase({
        worktreePath: created.worktreePath,
        baseCommit: input.baseCommit,
        worktreeBranch: created.branch,
      });
      await writeRecord(paths.recordPath, {
        version: SLOT_RECORD_VERSION,
        slotId,
        parentRepoPath: input.projectPath,
        worktreePath: created.worktreePath,
        worktreeBranch: created.branch,
        state: 'leased',
        baseCommit: input.baseCommit,
        updatedAt: now().toISOString(),
      });
      return {
        slotId,
        worktreePath: created.worktreePath,
        worktreeBranch: created.branch,
        baseCommit: input.baseCommit,
        rebuilt: true,
      };
    }

    if (record.state === 'leased') {
      await preserveStaleLease({
        projectPath: input.projectPath,
        worktreePath: paths.worktreePath,
        slotId,
        record,
      });
    }
    await git.resetWorktreeToBase({
      worktreePath: paths.worktreePath,
      baseCommit: input.baseCommit,
      worktreeBranch: paths.worktreeBranch,
    });
    await writeRecord(paths.recordPath, {
      ...record,
      state: 'leased',
      baseCommit: input.baseCommit,
      updatedAt: now().toISOString(),
    });
    return {
      slotId,
      worktreePath: paths.worktreePath,
      worktreeBranch: paths.worktreeBranch,
      baseCommit: input.baseCommit,
      ...(record.dependencyFingerprint !== undefined
        ? { previousDependencyFingerprint: record.dependencyFingerprint }
        : {}),
      rebuilt: false,
    };
  }

  async function recordDependencyFingerprint(
    input: Parameters<WriterSlotPool['recordDependencyFingerprint']>[0],
  ): Promise<void> {
    const paths = slotPaths(input);
    const record = await readRecord(paths.recordPath);
    if (!record) return;
    const next: WriterSlotRecord = {
      ...record,
      state: 'leased',
      baseCommit: input.baseCommit,
      updatedAt: now().toISOString(),
    };
    if (input.fingerprint !== undefined) {
      next.dependencyFingerprint = input.fingerprint;
    } else {
      delete next.dependencyFingerprint;
    }
    await writeRecord(paths.recordPath, next);
  }

  async function release(input: Parameters<WriterSlotPool['release']>[0]): Promise<void> {
    const paths = slotPaths(input);
    const record = await readRecord(paths.recordPath);
    if (!record) return;
    await writeRecord(paths.recordPath, {
      ...record,
      state: input.dirty === true ? 'dirty' : 'idle',
      updatedAt: now().toISOString(),
    });
  }

  return {
    acquire,
    recordDependencyFingerprint,
    release,
    async read(input) {
      const slotId = input.slotId ?? DEFAULT_WRITER_SLOT_ID;
      return readRecord(slotPaths({ ...input, slotId }).recordPath);
    },
  };
}
