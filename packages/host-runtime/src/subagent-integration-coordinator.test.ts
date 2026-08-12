import { describe, expect, it, vi } from 'vitest';
import type { SubagentTaskResult, SubagentWorkspaceLease } from '@piwin/contracts';
import type {
  WorktreeIntegrationInput as GitWorktreeIntegrationInput,
  WorktreeIntegrationResult as GitWorktreeIntegrationResult,
} from '@piwin/git';
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

function createTaskResult(taskId: string, allowedOutputPaths?: string[]): SubagentTaskResult {
  return {
    runId: 'run-1',
    taskId,
    executionStatus: 'completed',
    summaryStatus: 'not-requested',
    integrationStatus: 'pending',
    ...(allowedOutputPaths !== undefined ? { allowedOutputPaths } : {}),
  };
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
      createTaskResult('task-1'),
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

  it('removes applied worktrees immediately but retains conflicts during dispose', async () => {
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
      createTaskResult('task-1'),
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

  it('keeps integration applied when only post-apply cleanup fails', async () => {
    const coordinator = createSubagentIntegrationCoordinator({
      integrateWorktree: createSuccessIntegration(['game.js']),
      isBaseClean: vi.fn().mockResolvedValue(true),
      removeWorktree: vi.fn().mockRejectedValue(new Error('cleanup refused')),
    });

    const result = await coordinator.integrate(
      createTaskResult('task-1'),
      createWorktreeLease('/tmp/project/.piwin-worktrees/applied'),
    );

    expect(result.integrationStatus).toBe('applied');
    expect(result.changedFiles).toEqual(['game.js']);
    expect(result.error).toContain('retained worktree cleanup failed');
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
});
