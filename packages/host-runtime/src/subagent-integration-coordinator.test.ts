import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SubagentTaskResult, SubagentWorkspaceLease } from '@piwin/contracts';
import { createWorkspaceWriteGate } from './turn-changes/workspace-write-gate.js';
import type {
  WorktreeIntegrationInput as GitWorktreeIntegrationInput,
  WorktreeIntegrationResult as GitWorktreeIntegrationResult,
} from '@piwin/git';
import { openTurnChangeStore } from '@piwin/git';
import {
  createGitWorktreeIntegrationAdapter,
  createSubagentIntegrationCoordinator,
  type WorktreeIntegrationFunction,
  type WorktreeIntegrationInput,
} from './subagent-integration-coordinator.js';

function createWorktreeLease(
  worktreePath: string,
  parentRepoPath = '/tmp/project',
): SubagentWorkspaceLease {
  return {
    mode: 'worktree',
    cwd: worktreePath,
    parentRepoPath,
    worktreePath,
    worktreeBranch: `piwin/subagent/${worktreePath.replaceAll('/', '-')}`,
    baseCommit: '0123456789abcdef',
  };
}

const FROZEN_RESULT_REF = { resultId: 'res-1', revision: 1 } as const;

function createTaskResult(
  taskId: string,
  allowedOutputPaths?: string[],
  resultRef: { resultId: string; revision: number } | undefined = undefined,
): SubagentTaskResult {
  return {
    runId: 'run-1',
    taskId,
    executionStatus: 'completed',
    summaryStatus: 'not-requested',
    integrationStatus: 'pending',
    ...(allowedOutputPaths !== undefined ? { allowedOutputPaths } : {}),
    ...(resultRef ? { resultRef } : {}),
  };
}

function createFrozenTaskResult(
  taskId: string,
  allowedOutputPaths?: string[],
): SubagentTaskResult {
  return createTaskResult(taskId, allowedOutputPaths, FROZEN_RESULT_REF);
}

function createDeferred(): {
  promise: Promise<void>;
  resolve(): void;
} {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolveValue) => {
    resolvePromise = resolveValue;
  });

  return {
    promise,
    resolve: () => {
      if (!resolvePromise) {
        throw new Error('deferred promise was not initialized');
      }
      resolvePromise();
    },
  };
}

function createSuccessIntegration(changedFiles: string[]): WorktreeIntegrationFunction {
  return async (input) => ({
    success: true,
    changedFiles,
    allowedOutputPaths: input.allowedOutputPaths ? [...input.allowedOutputPaths] : [],
  });
}

describe('SubagentIntegrationCoordinator', () => {
  it('does not overlap integrations for the same normalized parent repository', async () => {
    const firstIntegrationStarted = createDeferred();
    const releaseFirstIntegration = createDeferred();
    const integrationOrder: string[] = [];
    let activeIntegrations = 0;
    let maximumActiveIntegrations = 0;
    let isFirstIntegration = true;

    const integrateWorktree: WorktreeIntegrationFunction = vi.fn(async (input) => {
      integrationOrder.push(input.worktreePath);
      activeIntegrations += 1;
      maximumActiveIntegrations = Math.max(maximumActiveIntegrations, activeIntegrations);

      if (isFirstIntegration) {
        isFirstIntegration = false;
        firstIntegrationStarted.resolve();
        await releaseFirstIntegration.promise;
      }

      activeIntegrations -= 1;
      return {
        success: true as const,
        changedFiles: [],
        allowedOutputPaths: input.allowedOutputPaths ? [...input.allowedOutputPaths] : [],
      };
    });

    const coordinator = createSubagentIntegrationCoordinator({
      integrateWorktree,
      isBaseClean: vi.fn().mockResolvedValue(true),
      removeWorktree: vi.fn().mockResolvedValue(undefined),
    });

    const firstResult = coordinator.integrate(
      createTaskResult('task-1'),
      createWorktreeLease('/tmp/project/.piwin-worktrees/one'),
    );
    await firstIntegrationStarted.promise;

    const secondResult = coordinator.integrate(
      createTaskResult('task-2'),
      createWorktreeLease('/tmp/project/.piwin-worktrees/two', '/tmp/project/../project'),
    );
    await new Promise<void>((resolveValue) => setImmediate(resolveValue));

    expect(integrationOrder).toEqual(['/tmp/project/.piwin-worktrees/one']);
    expect(maximumActiveIntegrations).toBe(1);

    releaseFirstIntegration.resolve();
    await Promise.all([firstResult, secondResult]);

    expect(integrationOrder).toEqual([
      '/tmp/project/.piwin-worktrees/one',
      '/tmp/project/.piwin-worktrees/two',
    ]);
    expect(maximumActiveIntegrations).toBe(1);
  });

  it('removes a cancelled waiter before it can call the parent mutator', async () => {
    const firstIntegrationStarted = createDeferred();
    const releaseFirstIntegration = createDeferred();
    const integrationInputs: WorktreeIntegrationInput[] = [];

    const integrateWorktree: WorktreeIntegrationFunction = vi.fn(async (input) => {
      integrationInputs.push(input);
      if (integrationInputs.length === 1) {
        firstIntegrationStarted.resolve();
        await releaseFirstIntegration.promise;
      }
      return {
        success: true as const,
        changedFiles: [],
        allowedOutputPaths: input.allowedOutputPaths ? [...input.allowedOutputPaths] : [],
      };
    });
    const removeWorktree = vi.fn().mockResolvedValue(undefined);
    const coordinator = createSubagentIntegrationCoordinator({
      integrateWorktree,
      isBaseClean: vi.fn().mockResolvedValue(true),
      removeWorktree,
    });

    const firstIntegration = coordinator.integrate(
      createTaskResult('task-1'),
      createWorktreeLease('/tmp/project/.piwin-worktrees/one'),
    );
    await firstIntegrationStarted.promise;

    const cancellationController = new AbortController();
    const cancelledIntegration = coordinator.integrate(
      createTaskResult('task-2'),
      createWorktreeLease('/tmp/project/.piwin-worktrees/two'),
      { signal: cancellationController.signal },
    );
    cancellationController.abort();

    const cancelledResult = await cancelledIntegration;
    expect(cancelledResult.integrationStatus).toBe('retained');
    expect(cancelledResult.error).toContain('cancelled before parent mutation');
    expect(integrationInputs).toHaveLength(1);
    expect(removeWorktree).not.toHaveBeenCalledWith(
      '/tmp/project/.piwin-worktrees/two',
      expect.anything(),
      expect.anything(),
    );

    releaseFirstIntegration.resolve();
    await firstIntegration;

    expect(integrationInputs).toHaveLength(1);
  });

  it('finishes integration when cancellation arrives after the commit point', async () => {
    const cancellationController = new AbortController();
    const commitPointReached = vi.fn(() => cancellationController.abort());
    const integrateWorktree = vi.fn(createSuccessIntegration(['src/applied.ts']));
    const removeWorktree = vi.fn().mockResolvedValue(undefined);
    const coordinator = createSubagentIntegrationCoordinator({
      integrateWorktree,
      isBaseClean: vi.fn().mockResolvedValue(true),
      removeWorktree,
    });

    const result = await coordinator.integrate(
      createFrozenTaskResult('task-1'),
      createWorktreeLease('/tmp/project/.piwin-worktrees/one'),
      {
        signal: cancellationController.signal,
        onCommitPoint: commitPointReached,
      },
    );

    expect(commitPointReached).toHaveBeenCalledTimes(1);
    expect(cancellationController.signal.aborted).toBe(true);
    expect(integrateWorktree).toHaveBeenCalledTimes(1);
    expect(result.integrationStatus).toBe('applied');
    expect(result.changedFiles).toEqual(['src/applied.ts']);
    expect(removeWorktree).toHaveBeenCalledTimes(1);
  });

  it('treats an explicit empty allowlist as deny-all', async () => {
    const integrateWorktree: WorktreeIntegrationFunction = vi.fn(
      createSuccessIntegration(['src/anything.ts']),
    );
    const removeWorktree = vi.fn().mockResolvedValue(undefined);
    const coordinator = createSubagentIntegrationCoordinator({
      integrateWorktree,
      isBaseClean: vi.fn().mockResolvedValue(true),
      removeWorktree,
    });

    const result = await coordinator.integrate(
      createTaskResult('task-1', []),
      createWorktreeLease('/tmp/project/.piwin-worktrees/one'),
    );

    expect(result.integrationStatus).toBe('failed');
    expect(result.error).toContain('src/anything.ts');
    expect(removeWorktree).not.toHaveBeenCalled();
  });

  it('passes allowed output paths and rejects a result that escapes them', async () => {
    const integrateWorktree: WorktreeIntegrationFunction = vi.fn(
      createSuccessIntegration(['src/allowed.ts', 'src/escape.ts']),
    );
    const removeWorktree = vi.fn().mockResolvedValue(undefined);
    const coordinator = createSubagentIntegrationCoordinator({
      integrateWorktree,
      isBaseClean: vi.fn().mockResolvedValue(true),
      removeWorktree,
    });

    const result = await coordinator.integrate(
      createTaskResult('task-1', ['./src/allowed.ts']),
      createWorktreeLease('/tmp/project/.piwin-worktrees/one'),
    );

    expect(integrateWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedOutputPaths: ['./src/allowed.ts'],
      }),
    );
    expect(result.integrationStatus).toBe('failed');
    expect(result.error).toContain('src/escape.ts');

    await coordinator.dispose();
    expect(removeWorktree).not.toHaveBeenCalled();
  });

  it('removes frozen applied worktrees after integrate and retains conflicts during dispose', async () => {
    let integrationCount = 0;
    const integrateWorktree: WorktreeIntegrationFunction = vi.fn(async (input) => {
      integrationCount += 1;
      if (integrationCount === 1) {
        return {
          success: true as const,
          changedFiles: [],
          allowedOutputPaths: input.allowedOutputPaths ? [...input.allowedOutputPaths] : [],
        };
      }

      return {
        success: false as const,
        conflict: true as const,
        conflictFiles: ['src/conflict.ts'],
        allowedOutputPaths: input.allowedOutputPaths ? [...input.allowedOutputPaths] : [],
      };
    });
    const removeWorktree = vi.fn().mockResolvedValue(undefined);
    const coordinator = createSubagentIntegrationCoordinator({
      integrateWorktree,
      isBaseClean: vi.fn().mockResolvedValue(true),
      removeWorktree,
    });

    const appliedWorktree = '/tmp/project/.piwin-worktrees/applied';
    const conflictedWorktree = '/tmp/project/.piwin-worktrees/conflicted';
    const appliedResult = await coordinator.integrate(
      createFrozenTaskResult('task-1'),
      createWorktreeLease(appliedWorktree),
    );
    const conflictedResult = await coordinator.integrate(
      createTaskResult('task-2'),
      createWorktreeLease(conflictedWorktree),
    );

    expect(appliedResult.integrationStatus).toBe('applied');
    expect(conflictedResult.integrationStatus).toBe('conflict');

    expect(removeWorktree).toHaveBeenCalledTimes(1);
    expect(removeWorktree).toHaveBeenCalledWith(
      appliedWorktree,
      '/tmp/project',
      expect.stringContaining('piwin/subagent/'),
    );

    await coordinator.dispose();
    expect(removeWorktree).not.toHaveBeenCalledWith(conflictedWorktree, '/tmp/project');
  });

  it('removes the copy once after a successful integrate with resultRef', async () => {
    const removeWorktree = vi.fn().mockResolvedValue(undefined);
    const coordinator = createSubagentIntegrationCoordinator({
      integrateWorktree: createSuccessIntegration(['src/a.ts']),
      isBaseClean: vi.fn().mockResolvedValue(true),
      removeWorktree,
    });

    const result = await coordinator.integrate(
      createFrozenTaskResult('task-1'),
      createWorktreeLease('/tmp/project/.piwin-worktrees/frozen'),
    );

    expect(result.integrationStatus).toBe('applied');
    expect(removeWorktree).toHaveBeenCalledTimes(1);
    await coordinator.dispose();
    expect(removeWorktree).toHaveBeenCalledTimes(1);
  });

  it('keeps the worktree after a successful integrate without resultRef', async () => {
    const removeWorktree = vi.fn().mockResolvedValue(undefined);
    const coordinator = createSubagentIntegrationCoordinator({
      integrateWorktree: createSuccessIntegration(['src/a.ts']),
      isBaseClean: vi.fn().mockResolvedValue(true),
      removeWorktree,
    });

    const worktreePath = '/tmp/project/.piwin-worktrees/unfrozen';
    const result = await coordinator.integrate(
      createTaskResult('task-1'),
      createWorktreeLease(worktreePath),
    );

    expect(result.integrationStatus).toBe('applied');
    expect(result.error).toBeUndefined();
    expect(removeWorktree).not.toHaveBeenCalled();
    await coordinator.dispose();
    expect(removeWorktree).not.toHaveBeenCalled();
  });

  it('keeps the copy when retainWorktree is set even after a freeze', async () => {
    const removeWorktree = vi.fn().mockResolvedValue(undefined);
    const coordinator = createSubagentIntegrationCoordinator({
      integrateWorktree: createSuccessIntegration(['src/a.ts']),
      isBaseClean: vi.fn().mockResolvedValue(true),
      removeWorktree,
    });

    const result = await coordinator.integrate(
      createFrozenTaskResult('task-1'),
      createWorktreeLease('/tmp/project/.piwin-worktrees/retained'),
      { retainWorktree: true },
    );

    expect(result.integrationStatus).toBe('applied');
    expect(removeWorktree).not.toHaveBeenCalled();
    await coordinator.dispose();
    expect(removeWorktree).not.toHaveBeenCalled();
  });

  it('keeps integration applied when only post-apply cleanup fails', async () => {
    const removeWorktree = vi.fn().mockRejectedValue(new Error('cleanup refused'));
    const coordinator = createSubagentIntegrationCoordinator({
      integrateWorktree: createSuccessIntegration(['game.js']),
      isBaseClean: vi.fn().mockResolvedValue(true),
      removeWorktree,
    });

    const result = await coordinator.integrate(
      createFrozenTaskResult('task-1'),
      createWorktreeLease('/tmp/project/.piwin-worktrees/applied'),
    );

    expect(result.integrationStatus).toBe('applied');
    expect(result.changedFiles).toEqual(['game.js']);
    expect(result.error).toContain('copy cleanup pending');
    expect(removeWorktree).toHaveBeenCalledTimes(1);
    await coordinator.dispose();
    expect(removeWorktree).toHaveBeenCalledTimes(1);
  });

  it('adapts the Git integration result without dropping allowed paths', async () => {
    const gitIntegrateWorktree = vi.fn(
      async (input: GitWorktreeIntegrationInput): Promise<GitWorktreeIntegrationResult> => {
        return {
          status: 'applied' as const,
          integratedFiles: [input.worktreePath],
          conflictedFiles: [],
          rejectedFiles: [],
        };
      },
    );
    const adapter = createGitWorktreeIntegrationAdapter(gitIntegrateWorktree);
    const input: WorktreeIntegrationInput = {
      parentRepoPath: '/tmp/project',
      worktreePath: '/tmp/project/.piwin-worktrees/one',
      worktreeBranch: 'piwin/subagent/one',
      baseCommit: '0123456789abcdef',
      allowedOutputPaths: ['src/allowed.ts'],
    };

    const result = await adapter(input);

    expect(gitIntegrateWorktree).toHaveBeenCalledWith({
      projectPath: '/tmp/project',
      worktreePath: '/tmp/project/.piwin-worktrees/one',
      worktreeBranch: 'piwin/subagent/one',
      baseCommit: '0123456789abcdef',
      allowedOutputPaths: ['src/allowed.ts'],
    });
    expect(result).toEqual({
      success: true,
      changedFiles: ['/tmp/project/.piwin-worktrees/one'],
      allowedOutputPaths: ['src/allowed.ts'],
    });
  });

  it('preserves Git conflict diagnostics through the adapter', async () => {
    const adapter = createGitWorktreeIntegrationAdapter(
      vi.fn(async (): Promise<GitWorktreeIntegrationResult> => ({
        status: 'conflict',
        integratedFiles: [],
        conflictedFiles: ['game.js'],
        rejectedFiles: [],
        error: 'patch does not apply: game.js',
      })),
    );

    const result = await adapter({
      parentRepoPath: '/tmp/project',
      worktreePath: '/tmp/worktree',
      worktreeBranch: 'piwin/subagent/one',
      baseCommit: '0123456789abcdef',
      allowedOutputPaths: [],
    });

    expect(result).toMatchObject({
      success: false,
      conflict: true,
      conflictFiles: ['game.js'],
      error: 'patch does not apply: game.js',
    });
  });

  it('waits for the workspace lease before integrating parent files', async () => {
    const parentRepoPath = await mkdtemp(join(tmpdir(), 'piwin-int-busy-'));
    const gate = createWorkspaceWriteGate();
    const held = await gate.tryAcquire({
      workspaceId: 'ws-parent',
      rootPath: parentRepoPath,
      kind: 'tool',
      mode: 'exclusive',
      wait: true,
    });
    expect(held.ok).toBe(true);
    const integrateWorktree = vi.fn(createSuccessIntegration(['game.js']));
    const coordinator = createSubagentIntegrationCoordinator({
      integrateWorktree,
      isBaseClean: vi.fn().mockResolvedValue(true),
      removeWorktree: vi.fn().mockResolvedValue(undefined),
      workspaceWriteGate: gate,
    });

    let finished = false;
    const pending = coordinator.integrate(
      createTaskResult('task-busy'),
      createWorktreeLease(join(parentRepoPath, 'worktree'), parentRepoPath),
    ).then((result) => {
      finished = true;
      return result;
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    expect(finished).toBe(false);
    expect(integrateWorktree).not.toHaveBeenCalled();
    if (held.ok) {
      held.lease.release();
    }

    const afterRelease = await pending;
    expect(afterRelease.integrationStatus).toBe('applied');
    expect(integrateWorktree).toHaveBeenCalledTimes(1);
    await rm(parentRepoPath, { recursive: true, force: true });
  });

  it('holds the workspace gate during parent apply so overlapping kinds are busy', async () => {
    const parentRepoPath = await mkdtemp(join(tmpdir(), 'piwin-int-hold-'));
    const gate = createWorkspaceWriteGate();
    const started = createDeferred();
    const releaseApply = createDeferred();
    const integrateWorktree: WorktreeIntegrationFunction = async (input) => {
      started.resolve();
      await releaseApply.promise;
      return {
        success: true,
        changedFiles: [],
        allowedOutputPaths: input.allowedOutputPaths ? [...input.allowedOutputPaths] : [],
      };
    };
    const coordinator = createSubagentIntegrationCoordinator({
      integrateWorktree,
      isBaseClean: vi.fn().mockResolvedValue(true),
      removeWorktree: vi.fn().mockResolvedValue(undefined),
      workspaceWriteGate: gate,
    });

    const integration = coordinator.integrate(
      createTaskResult('task-hold'),
      createWorktreeLease(join(parentRepoPath, 'worktree'), parentRepoPath),
    );
    await started.promise;
    const overlapping = await gate.tryAcquire({
      workspaceId: 'ws-parent',
      rootPath: parentRepoPath,
      kind: 'git',
      mode: 'exclusive',
      wait: false,
    });
    expect(overlapping).toEqual({ ok: false, reason: 'workspace-busy' });
    releaseApply.resolve();
    await integration;
    await rm(parentRepoPath, { recursive: true, force: true });
  });

  it('persists a reservation before the first workspace write', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-int-reserve-'));
    const store = openTurnChangeStore({ rootDir });
    const integrateWorktree = vi.fn(async () => {
      expect(store.getSubagentApplyReservation({ resultId: 'res-1' })?.status).toBe('applying');
      return {
        success: true as const,
        changedFiles: ['src/a.ts'],
        allowedOutputPaths: [],
      };
    });
    const coordinator = createSubagentIntegrationCoordinator({
      integrateWorktree,
      isBaseClean: vi.fn().mockResolvedValue(true),
      removeWorktree: vi.fn().mockResolvedValue(undefined),
      applyReservation: store,
    });

    const result = await coordinator.integrate(
      createFrozenTaskResult('task-1'),
      createWorktreeLease('/tmp/project/.piwin-worktrees/one'),
    );
    expect(result.integrationStatus).toBe('applied');
    expect(store.getSubagentApplyReservation({ resultId: 'res-1' })?.status).toBe('succeeded');
    store.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  it('concurrent same-result and same-group applies produce one writer', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-int-one-writer-'));
    const store = openTurnChangeStore({ rootDir });
    const started = createDeferred();
    const releaseFirst = createDeferred();
    const writes: string[] = [];
    const integrateWorktree: WorktreeIntegrationFunction = async (input) => {
      writes.push(input.worktreePath);
      if (writes.length === 1) {
        started.resolve();
        await releaseFirst.promise;
      }
      return {
        success: true as const,
        changedFiles: [],
        allowedOutputPaths: [],
      };
    };
    const coordinator = createSubagentIntegrationCoordinator({
      integrateWorktree,
      isBaseClean: vi.fn().mockResolvedValue(true),
      removeWorktree: vi.fn().mockResolvedValue(undefined),
      applyReservation: store,
    });

    const first = coordinator.integrate(
      { ...createFrozenTaskResult('task-1'), candidateGroupId: 'group-1' },
      createWorktreeLease('/tmp/project/.piwin-worktrees/one'),
    );
    await started.promise;
    const sameGroup = coordinator.integrate(
      {
        ...createTaskResult('task-2', undefined, { resultId: 'res-2', revision: 1 }),
        candidateGroupId: 'group-1',
      },
      createWorktreeLease('/tmp/project/.piwin-worktrees/two'),
    );
    releaseFirst.resolve();
    const [firstResult, groupResult] = await Promise.all([first, sameGroup]);

    expect(firstResult.integrationStatus).toBe('applied');
    expect(groupResult.integrationStatus).toBe('failed');
    expect(groupResult.error).toBe('candidate-group-selected');
    expect(writes).toHaveLength(1);
    store.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  it('failed pre-write validation releases reservation; needs-repair does not', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-int-release-'));
    const store = openTurnChangeStore({ rootDir });
    const controller = new AbortController();
    const coordinator = createSubagentIntegrationCoordinator({
      integrateWorktree: vi.fn(),
      isBaseClean: vi.fn().mockResolvedValue(true),
      removeWorktree: vi.fn().mockResolvedValue(undefined),
      applyReservation: {
        reserveSubagentApply: (input) => {
          const reserved = store.reserveSubagentApply(input);
          controller.abort();
          return reserved;
        },
        releaseSubagentApplyReservation: (operationId) =>
          store.releaseSubagentApplyReservation(operationId),
        updateOperationStatus: (operationId, status) =>
          store.updateOperationStatus(operationId, status),
        getOperation: (operationId) => store.getOperation(operationId),
      },
    });

    const cancelled = await coordinator.integrate(
      { ...createFrozenTaskResult('task-1'), candidateGroupId: 'group-1' },
      createWorktreeLease('/tmp/project/.piwin-worktrees/one'),
      { signal: controller.signal },
    );
    expect(cancelled.integrationStatus).toBe('retained');
    expect(store.getSubagentApplyReservation({ resultId: 'res-1' })?.status).toBe('applying');

    const throwing = createSubagentIntegrationCoordinator({
      integrateWorktree: async () => {
        throw new Error('disk exploded');
      },
      isBaseClean: vi.fn().mockResolvedValue(true),
      removeWorktree: vi.fn().mockResolvedValue(undefined),
      applyReservation: store,
    });
    const repaired = await throwing.integrate(
      { ...createFrozenTaskResult('task-1'), candidateGroupId: 'group-1' },
      createWorktreeLease('/tmp/project/.piwin-worktrees/one'),
    );
    expect(repaired.error).toBe('needs-repair');
    expect(store.getSubagentApplyReservation({ resultId: 'res-1' })?.status).toBe('needs-repair');
    store.releaseSubagentApplyReservation(
      store.getSubagentApplyReservation({ resultId: 'res-1' })?.operationId ?? '',
    );
    const blocked = await throwing.integrate(
      {
        ...createTaskResult('task-2', undefined, { resultId: 'res-2', revision: 1 }),
        candidateGroupId: 'group-1',
      },
      createWorktreeLease('/tmp/project/.piwin-worktrees/two'),
    );
    expect(blocked.error).toBe('needs-repair');
    store.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  it('post-write conflict keeps the reservation as needs-repair', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-int-conflict-lock-'));
    const store = openTurnChangeStore({ rootDir });
    const coordinator = createSubagentIntegrationCoordinator({
      integrateWorktree: async () => ({
        success: false as const,
        conflict: true as const,
        conflictFiles: ['src/a.ts'],
        allowedOutputPaths: [],
      }),
      isBaseClean: vi.fn().mockResolvedValue(true),
      removeWorktree: vi.fn().mockResolvedValue(undefined),
      applyReservation: store,
    });

    const result = await coordinator.integrate(
      createFrozenTaskResult('task-1'),
      createWorktreeLease('/tmp/project/.piwin-worktrees/one'),
    );

    expect(result.integrationStatus).toBe('conflict');
    expect(store.getSubagentApplyReservation({ resultId: 'res-1' })?.status).toBe('needs-repair');
    expect(store.listOperationFiles(store.getSubagentApplyReservation({ resultId: 'res-1' })?.operationId ?? '')).toEqual(
      [],
    );
    store.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  it('records write-completed on success without operation_file rows', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-int-write-completed-'));
    const store = openTurnChangeStore({ rootDir });
    const coordinator = createSubagentIntegrationCoordinator({
      integrateWorktree: createSuccessIntegration(['src/a.ts']),
      isBaseClean: vi.fn().mockResolvedValue(true),
      removeWorktree: vi.fn().mockResolvedValue(undefined),
      applyReservation: store,
    });

    const result = await coordinator.integrate(
      createFrozenTaskResult('task-1'),
      createWorktreeLease('/tmp/project/.piwin-worktrees/one'),
    );
    const reservation = store.getSubagentApplyReservation({ resultId: 'res-1' });
    expect(result.integrationStatus).toBe('applied');
    expect(reservation?.status).toBe('succeeded');
    expect(reservation && store.hasSubagentApplyWriteCompleted(reservation.operationId)).toBe(true);
    expect(reservation ? store.listOperationFiles(reservation.operationId) : ['missing']).toEqual([]);
    store.close();
    await rm(rootDir, { recursive: true, force: true });
  });
});
