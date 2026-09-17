import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSubagentWorkspaceService } from './subagent-workspace-service.js';
import type { SubagentTaskSpec } from '@piwin/contracts';
import { createWorktree, isWorktreeBaseClean, runGitCommand } from '@piwin/git';

vi.mock('@piwin/git', () => ({
  createWorktree: vi.fn(),
  isWorktreeBaseClean: vi.fn(),
  runGitCommand: vi.fn(),
}));

function makeTask(overrides: Partial<SubagentTaskSpec> = {}): SubagentTaskSpec {
  return {
    id: 'task-1',
    parentSessionId: 'parent-1',
    task: 'do something',
    ...overrides,
  };
}

describe('SubagentWorkspaceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('acquires readonly lease using project path', async () => {
    const service = createSubagentWorkspaceService({
      projectPath: '/tmp/project',
      dirtyBasePolicy: 'ask',
      parallelWritePolicy: 'worktree-only',
    });
    const lease = await service.acquire(makeTask({ isolationOverride: 'readonly' }));
    expect(lease.mode).toBe('readonly');
    expect(lease.cwd).toBe('/tmp/project');
    expect(lease.parentRepoPath).toBe('/tmp/project');
  });

  it('releases readonly lease without error', async () => {
    const service = createSubagentWorkspaceService({
      projectPath: '/tmp/project',
      dirtyBasePolicy: 'ask',
      parallelWritePolicy: 'worktree-only',
    });
    const lease = await service.acquire(makeTask({ isolationOverride: 'readonly' }));
    await expect(service.release(lease)).resolves.toBeUndefined();
  });

  it('rejects worktree when parallelWritePolicy is disabled', async () => {
    const service = createSubagentWorkspaceService({
      projectPath: '/tmp/project',
      dirtyBasePolicy: 'ask',
      parallelWritePolicy: 'disabled',
    });
    await expect(service.acquire(makeTask({ isolationOverride: 'worktree' }))).rejects.toThrow(
      'parallel writes are disabled',
    );
  });

  it('rejects a dirty parent before creating a worktree', async () => {
    vi.mocked(isWorktreeBaseClean).mockResolvedValue(false);

    const service = createSubagentWorkspaceService({
      projectPath: '/tmp/project',
      dirtyBasePolicy: 'ask',
      requestDirtyBasePermission: async () => 'deny',
      parallelWritePolicy: 'worktree-only',
    });

    await expect(service.acquire(makeTask({ isolationOverride: 'worktree' }))).rejects.toThrow(
      'dirty-base-denied',
    );
    expect(isWorktreeBaseClean).toHaveBeenCalledWith('/tmp/project');
    expect(runGitCommand).not.toHaveBeenCalled();
    expect(createWorktree).not.toHaveBeenCalled();
  });

  it('installs worktree dependencies with the batch signal and records the outcome on the lease', async () => {
    vi.mocked(isWorktreeBaseClean).mockResolvedValue(true);
    vi.mocked(runGitCommand).mockResolvedValue({ stdout: 'abc123\n', stderr: '', exitCode: 0 });
    vi.mocked(createWorktree).mockResolvedValue({
      worktreePath: '/tmp/worktrees/task-1',
      branch: 'piwin/subagent/task-1',
    });
    const prepareWorktreeDependencies = vi.fn(async () => ({
      status: 'installed' as const,
      manager: 'pnpm' as const,
    }));
    const controller = new AbortController();
    const service = createSubagentWorkspaceService({
      projectPath: '/tmp/project',
      dirtyBasePolicy: 'ask',
      parallelWritePolicy: 'worktree-only',
      prepareWorktreeDependencies,
    });

    const lease = await service.acquire(makeTask({ isolationOverride: 'worktree' }), {
      signal: controller.signal,
    });

    expect(prepareWorktreeDependencies).toHaveBeenCalledWith({
      worktreePath: '/tmp/worktrees/task-1',
      parentRepoPath: '/tmp/project',
      signal: controller.signal,
    });
    expect(lease).toMatchObject({
      mode: 'worktree',
      dependencySetup: { status: 'installed', manager: 'pnpm' },
    });
  });

  it('captures the exact parent HEAD and passes it as the worktree base', async () => {
    vi.mocked(isWorktreeBaseClean).mockResolvedValue(true);
    vi.mocked(runGitCommand).mockResolvedValue({
      stdout: '0123456789abcdef\n',
      stderr: '',
      exitCode: 0,
    });
    vi.mocked(createWorktree).mockResolvedValue({
      worktreePath: '/tmp/project/.piwin-worktrees/task-1',
      branch: 'piwin/subagent/task-1',
    });

    const service = createSubagentWorkspaceService({
      projectPath: '/tmp/project',
      worktreeStorageRoot: '/tmp/piwin/worktrees',
      dirtyBasePolicy: 'ask',
      parallelWritePolicy: 'worktree-only',
    });

    const lease = await service.acquire(makeTask({ isolationOverride: 'worktree' }));

    expect(runGitCommand).toHaveBeenCalledWith({
      cwd: '/tmp/project',
      args: ['rev-parse', 'HEAD'],
    });
    expect(createWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: '/tmp/project',
        baseRef: '0123456789abcdef',
        storageRoot: '/tmp/piwin/worktrees',
      }),
    );
    expect(lease).toEqual({
      mode: 'worktree',
      cwd: '/tmp/project/.piwin-worktrees/task-1',
      parentRepoPath: '/tmp/project',
      worktreePath: '/tmp/project/.piwin-worktrees/task-1',
      worktreeBranch: 'piwin/subagent/task-1',
      baseCommit: '0123456789abcdef',
    });
  });
});
