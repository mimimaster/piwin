import { access, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SubagentWorkspaceLease } from '@piwin/contracts';
import type { SubagentRunManifest } from '@piwin/session';
import { SUBAGENT_WORKTREE_GC_AUTO_MIN_AGE_MS } from '@piwin/contracts';
import { createWorktree, removeWorktree, runGitCommand } from '@piwin/git';
import { createSubagentWorktreeGcController } from './subagent-worktree-gc.js';

const temporaryRoots: string[] = [];

async function makeWorktree(storageRoot: string, name: string): Promise<string> {
  const worktreePath = join(storageRoot, 'repoaaaaaaaabbbb', name);
  await mkdir(worktreePath, { recursive: true });
  await writeFile(join(worktreePath, '.git'), 'gitdir: /tmp/fake.git\n');
  return worktreePath;
}

function worktreeLease(worktreePath: string, parentRepoPath: string): SubagentWorkspaceLease {
  return {
    mode: 'worktree',
    cwd: worktreePath,
    parentRepoPath,
    worktreePath,
    worktreeBranch: `piwin/subagent/${worktreePath.split('/').pop() ?? 'x'}`,
    baseCommit: 'abc123',
  };
}

function manifest(input: {
  runId: string;
  worktreePath: string;
  parentRepoPath: string;
  status?: SubagentRunManifest['status'];
  executionStatus?: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  integrationStatus?: 'not-requested' | 'pending' | 'conflict' | 'retained' | 'discarded';
  retainWorktree?: boolean;
  updatedAt?: string;
}): SubagentRunManifest {
  const taskId = 'task-1';
  return {
    runId: input.runId,
    parentSessionId: 'parent-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-01-01T00:00:00.000Z',
    tasks: [
      {
        id: taskId,
        task: 'implement',
        ...(input.retainWorktree === true ? { retainWorktree: true } : {}),
      },
    ],
    maxConcurrency: 1,
    failurePolicy: 'continue',
    snapshots: {},
    leases: { [taskId]: worktreeLease(input.worktreePath, input.parentRepoPath) },
    results: {
      [taskId]: {
        runId: input.runId,
        taskId,
        executionStatus: input.executionStatus ?? 'cancelled',
        summaryStatus: 'not-requested',
        integrationStatus: input.integrationStatus ?? 'not-requested',
        worktreePath: input.worktreePath,
      },
    },
    invocations: {},
    status: input.status ?? 'cancelled',
  };
}

describe('subagent worktree GC controller', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it('reclaims a stale cancelled copy and keeps pending, retained, paused, and foreign paths', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'piwin-wt-gc-'));
    temporaryRoots.push(storageRoot);
    const parentRepoPath = join(storageRoot, 'main');
    const stale = await makeWorktree(storageRoot, 'stale');
    const pending = await makeWorktree(storageRoot, 'pending');
    const retained = await makeWorktree(storageRoot, 'retained');
    const paused = await makeWorktree(storageRoot, 'paused');
    const orphan = await makeWorktree(storageRoot, 'orphan');
    const old = new Date(Date.now() - SUBAGENT_WORKTREE_GC_AUTO_MIN_AGE_MS - 60_000);
    for (const path of [stale, pending, retained, paused, orphan]) {
      await utimes(path, old, old);
    }

    const removed: string[] = [];
    const controller = createSubagentWorktreeGcController({
      storageRoot,
      listManifests: async () => [
        manifest({
          runId: 'run-stale',
          worktreePath: stale,
          parentRepoPath,
        }),
        manifest({
          runId: 'run-pending',
          worktreePath: pending,
          parentRepoPath,
          integrationStatus: 'pending',
        }),
        manifest({
          runId: 'run-retained',
          worktreePath: retained,
          parentRepoPath,
          retainWorktree: true,
        }),
        manifest({
          runId: 'run-paused',
          worktreePath: paused,
          parentRepoPath,
        }),
      ],
      isRunActive: () => false,
      listPausedBatchRunIds: async () => new Set(['run-paused']),
      now: () => Date.now(),
      measureBytes: async () => 1024,
      lookupGit: async (input) => ({
        isPrimary: false,
        locked: false,
        branch: `piwin/subagent/${input.worktreePath.split('/').pop() ?? 'x'}`,
        parentRepoPath,
      }),
      removeWorktree: async (input) => {
        removed.push(input.worktreePath);
      },
    });

    const preview = await controller.preview();
    expect(preview.reclaimableCount).toBe(2);
    expect(preview.entries.filter((entry) => entry.reclaimable).map((entry) => entry.worktreePath).sort()).toEqual(
      [orphan, stale].sort(),
    );
    expect(preview.entries.find((entry) => entry.worktreePath === pending)?.keepReasons).toContain(
      'pending-integration',
    );
    expect(preview.entries.find((entry) => entry.worktreePath === retained)?.keepReasons).toContain(
      'user-retained',
    );
    expect(preview.entries.find((entry) => entry.worktreePath === paused)?.keepReasons).toContain(
      'pause-checkpoint',
    );

    const auto = await controller.reclaim({ mode: 'auto' });
    expect(auto.removedCount).toBe(2);
    expect(removed.sort()).toEqual([orphan, stale].sort());
  });

  it('reclaims a stale failed copy kept for inspection but keeps a candidate awaiting a decision', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'piwin-wt-gc-retained-'));
    temporaryRoots.push(storageRoot);
    const parentRepoPath = join(storageRoot, 'main');
    const failed = await makeWorktree(storageRoot, 'failed');
    const candidate = await makeWorktree(storageRoot, 'candidate');
    const old = new Date(Date.now() - SUBAGENT_WORKTREE_GC_AUTO_MIN_AGE_MS - 60_000);
    for (const path of [failed, candidate]) {
      await utimes(path, old, old);
    }
    const controller = createSubagentWorktreeGcController({
      storageRoot,
      listManifests: async () => [
        manifest({
          runId: 'run-failed',
          worktreePath: failed,
          parentRepoPath,
          executionStatus: 'failed',
          integrationStatus: 'retained',
        }),
        manifest({
          runId: 'run-candidate',
          worktreePath: candidate,
          parentRepoPath,
          executionStatus: 'completed',
          integrationStatus: 'retained',
        }),
      ],
      isRunActive: () => false,
      listPausedBatchRunIds: async () => new Set(),
      now: () => Date.now(),
      measureBytes: async () => 1024,
      lookupGit: async (input) => ({
        isPrimary: false,
        locked: false,
        branch: `piwin/subagent/${input.worktreePath.split('/').pop() ?? 'x'}`,
        parentRepoPath,
      }),
      removeWorktree: async () => undefined,
    });

    const preview = await controller.preview();
    expect(preview.entries.find((entry) => entry.worktreePath === failed)?.reclaimable).toBe(true);
    expect(preview.entries.find((entry) => entry.worktreePath === candidate)?.keepReasons).toContain(
      'pending-integration',
    );
  });

  it('does not treat a path outside the storage root as reclaimable', async () => {
    const storageRoot = await mkdtemp(join(tmpdir(), 'piwin-wt-gc-'));
    const outsideRoot = await mkdtemp(join(tmpdir(), 'piwin-wt-out-'));
    temporaryRoots.push(storageRoot, outsideRoot);
    const outside = join(outsideRoot, 'not-ours');
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, '.git'), 'gitdir: /tmp/fake.git\n');

    const controller = createSubagentWorktreeGcController({
      storageRoot,
      listManifests: async () => [
        manifest({
          runId: 'run-out',
          worktreePath: outside,
          parentRepoPath: outsideRoot,
          updatedAt: '2020-01-01T00:00:00.000Z',
        }),
      ],
      isRunActive: () => false,
      listPausedBatchRunIds: async () => new Set(),
      now: () => Date.now(),
      measureBytes: async () => 1,
      lookupGit: async () => ({
        isPrimary: false,
        locked: false,
        branch: 'piwin/subagent/not-ours',
        parentRepoPath: outsideRoot,
      }),
      removeWorktree: async () => {
        throw new Error('should not remove');
      },
    });

    const preview = await controller.preview();
    expect(preview.reclaimableCount).toBe(0);
    expect(preview.entries[0]?.keepReasons).toContain('unsafe-path');
    await expect(controller.reclaim({ mode: 'manual' })).resolves.toMatchObject({
      removedCount: 0,
    });
  });

  it('removes a real stale orphan worktree and its piwin/subagent branch', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'piwin-wt-gc-repo-'));
    const storageRoot = await mkdtemp(join(tmpdir(), 'piwin-wt-gc-store-'));
    temporaryRoots.push(projectPath, storageRoot);
    await runGitCommand({ cwd: projectPath, args: ['init', '-b', 'main'] });
    await runGitCommand({
      cwd: projectPath,
      args: ['config', 'user.email', 'piwin-test@example.com'],
    });
    await runGitCommand({ cwd: projectPath, args: ['config', 'user.name', 'piwin test'] });
    await writeFile(join(projectPath, 'README.md'), 'base\n');
    await runGitCommand({ cwd: projectPath, args: ['add', '--all'] });
    await runGitCommand({ cwd: projectPath, args: ['commit', '-m', 'base'] });

    const created = await createWorktree({
      projectPath,
      name: 'smoke-reclaim',
      storageRoot,
    });
    const old = new Date(Date.now() - SUBAGENT_WORKTREE_GC_AUTO_MIN_AGE_MS - 60_000);
    await utimes(created.worktreePath, old, old);

    const controller = createSubagentWorktreeGcController({
      storageRoot,
      listManifests: async () => [],
      isRunActive: () => false,
      listPausedBatchRunIds: async () => new Set(),
      now: () => Date.now(),
      removeWorktree: async (input) => {
        await removeWorktree({
          projectPath: input.parentRepoPath,
          worktreePath: input.worktreePath,
          force: true,
          ...(input.worktreeBranch ? { worktreeBranch: input.worktreeBranch } : {}),
        });
      },
    });

    const preview = await controller.preview();
    expect(preview.reclaimableCount).toBe(1);
    expect(preview.entries[0]?.worktreeBranch).toBe(created.branch);

    await expect(controller.reclaim({ mode: 'auto' })).resolves.toMatchObject({
      removedCount: 1,
      failed: [],
    });
    await expect(access(created.worktreePath)).rejects.toThrow();
    const branch = await runGitCommand({
      cwd: projectPath,
      args: ['rev-parse', '--verify', created.branch],
      allowFailure: true,
    });
    expect(branch.exitCode).not.toBe(0);
  });
});
