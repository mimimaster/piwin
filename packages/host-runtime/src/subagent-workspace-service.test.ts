import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSubagentWorkspaceService } from './subagent-workspace-service.js';
import type { SubagentTaskSpec } from '@piwin/contracts';
import { checkoutWorktreeTree, createWorktree, isWorktreeBaseClean, runGitCommand } from '@piwin/git';
import type { WriterSlotPool } from './subagent-writer-slots.js';

vi.mock('@piwin/git', () => ({
  createWorktree: vi.fn(),
  isWorktreeBaseClean: vi.fn(),
  runGitCommand: vi.fn(),
  checkoutWorktreeTree: vi.fn(),
}));

/** Slot pool stand-in: the real pool owns git and file I/O, not the service. */
function createFakeSlotPool(): WriterSlotPool & {
  acquire: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  recordDependencyFingerprint: ReturnType<typeof vi.fn>;
} {
  // The real pool replays the fingerprint of the install it kept, but only
  // from the second acquire on: the first acquire created the slot.
  let acquisitions = 0;
  return {
    acquire: vi.fn(async (input: { baseCommit: string }) => {
      acquisitions += 1;
      return {
        slotId: 'slot-0',
        worktreePath: '/tmp/slots/repo-key/slot-0',
        worktreeBranch: 'piwin/subagent/slot-0',
        baseCommit: input.baseCommit,
        rebuilt: acquisitions === 1,
        ...(acquisitions > 1 ? { previousDependencyFingerprint: 'fp-1' } : {}),
      };
    }),
    release: vi.fn(async () => undefined),
    recordDependencyFingerprint: vi.fn(async () => undefined),
    read: vi.fn(async () => undefined),
  } as unknown as WriterSlotPool & {
    acquire: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
    recordDependencyFingerprint: ReturnType<typeof vi.fn>;
  };
}

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

  it('queues a second worktree acquire for the same project until the first lease is released', async () => {
    vi.mocked(isWorktreeBaseClean).mockResolvedValue(true);
    vi.mocked(runGitCommand).mockResolvedValue({ stdout: 'abc123\n', stderr: '', exitCode: 0 });
    vi.mocked(createWorktree).mockImplementation(async (input) => ({
      worktreePath: `/tmp/worktrees/${String(input.name)}`,
      branch: `piwin/subagent/${String(input.name)}`,
    }));
    const service = createSubagentWorkspaceService({
      projectPath: '/tmp/project',
      dirtyBasePolicy: 'bypass',
      parallelWritePolicy: 'worktree-only',
    });

    const first = await service.acquire(makeTask({ id: 'w1', isolationOverride: 'worktree' }));
    expect(createWorktree).toHaveBeenCalledTimes(1);

    let secondResolved = false;
    const secondPromise = service
      .acquire(makeTask({ id: 'w2', isolationOverride: 'worktree' }))
      .then((lease) => {
        secondResolved = true;
        return lease;
      });
    await Promise.resolve();
    await Promise.resolve();
    expect(secondResolved).toBe(false);
    expect(createWorktree).toHaveBeenCalledTimes(1);

    await service.release(first);
    const second = await secondPromise;
    expect(second.mode).toBe('worktree');
    expect(createWorktree).toHaveBeenCalledTimes(2);
    await service.release(second);
  });

  it('allows concurrent worktree acquires for different projects', async () => {
    vi.mocked(isWorktreeBaseClean).mockResolvedValue(true);
    vi.mocked(runGitCommand).mockResolvedValue({ stdout: 'abc123\n', stderr: '', exitCode: 0 });
    vi.mocked(createWorktree).mockImplementation(async (input) => ({
      worktreePath: `/tmp/worktrees/${String(input.projectPath)}`,
      branch: 'piwin/subagent/x',
    }));
    const service = createSubagentWorkspaceService({
      projectPath: '/tmp/default',
      resolveProjectPath: async (task) => (task.id === 'a' ? '/tmp/repo-a' : '/tmp/repo-b'),
      dirtyBasePolicy: 'bypass',
      parallelWritePolicy: 'worktree-only',
    });

    const [leaseA, leaseB] = await Promise.all([
      service.acquire(makeTask({ id: 'a', isolationOverride: 'worktree' })),
      service.acquire(makeTask({ id: 'b', isolationOverride: 'worktree' })),
    ]);
    expect(createWorktree).toHaveBeenCalledTimes(2);
    await service.release(leaseA);
    await service.release(leaseB);
  });

  it('rejects a queued worktree acquire when the wait is aborted', async () => {
    vi.mocked(isWorktreeBaseClean).mockResolvedValue(true);
    vi.mocked(runGitCommand).mockResolvedValue({ stdout: 'abc123\n', stderr: '', exitCode: 0 });
    vi.mocked(createWorktree).mockResolvedValue({
      worktreePath: '/tmp/worktrees/task-1',
      branch: 'piwin/subagent/task-1',
    });
    const service = createSubagentWorkspaceService({
      projectPath: '/tmp/project',
      dirtyBasePolicy: 'bypass',
      parallelWritePolicy: 'worktree-only',
    });
    const first = await service.acquire(makeTask({ id: 'w1', isolationOverride: 'worktree' }));
    const controller = new AbortController();
    const queued = service.acquire(makeTask({ id: 'w2', isolationOverride: 'worktree' }), {
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();
    await expect(queued).rejects.toThrow('aborted');
    await service.release(first);
  });

  it('unlocks the project after a failed worktree create so the next acquire can proceed', async () => {
    vi.mocked(isWorktreeBaseClean).mockResolvedValue(true);
    vi.mocked(runGitCommand).mockResolvedValue({ stdout: 'abc123\n', stderr: '', exitCode: 0 });
    vi.mocked(createWorktree)
      .mockRejectedValueOnce(new Error('create failed'))
      .mockResolvedValueOnce({
        worktreePath: '/tmp/worktrees/task-2',
        branch: 'piwin/subagent/task-2',
      });
    const service = createSubagentWorkspaceService({
      projectPath: '/tmp/project',
      dirtyBasePolicy: 'bypass',
      parallelWritePolicy: 'worktree-only',
    });
    await expect(
      service.acquire(makeTask({ id: 'w1', isolationOverride: 'worktree' })),
    ).rejects.toThrow('create failed');
    const second = await service.acquire(makeTask({ id: 'w2', isolationOverride: 'worktree' }));
    expect(second.worktreePath).toBe('/tmp/worktrees/task-2');
    await service.release(second);
  });

});

describe('shared writer slot', () => {
  const baseCommit = 'abc123abc123abc123abc123abc123abc123abcd';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runGitCommand).mockResolvedValue({
      stdout: `${baseCommit}\n`,
      stderr: '',
      exitCode: 0,
    });
    vi.mocked(isWorktreeBaseClean).mockResolvedValue(true);
    vi.mocked(checkoutWorktreeTree).mockResolvedValue(undefined);
  });

  it('reuses one slot across consecutive write tasks and reuses the install', async () => {
    const slotPool = createFakeSlotPool();
    const prepareWorktreeDependencies = vi.fn(async () => ({
      status: 'reused' as const,
      manager: 'pnpm' as const,
      fingerprint: 'fp-1',
    }));
    const service = createSubagentWorkspaceService({
      projectPath: '/tmp/project',
      worktreeStorageRoot: '/tmp/slots',
      writerSlotPool: slotPool,
      dirtyBasePolicy: 'bypass',
      parallelWritePolicy: 'worktree-only',
      prepareWorktreeDependencies,
    });

    const first = await service.acquire(makeTask({ id: 'task-1', isolationOverride: 'worktree' }));
    await service.release(first);
    const second = await service.acquire(makeTask({ id: 'task-2', isolationOverride: 'worktree' }));

    expect(first.mode).toBe('worktree');
    expect(second.mode).toBe('worktree');
    if (first.mode !== 'worktree' || second.mode !== 'worktree') throw new Error('expected worktree');
    // One checkout for both tasks: that is the whole point of the slot.
    expect(second.worktreePath).toBe(first.worktreePath);
    expect(second.slotId).toBe('slot-0');
    expect(vi.mocked(createWorktree)).not.toHaveBeenCalled();
    expect(slotPool.acquire).toHaveBeenCalledTimes(2);
    // The second task sees the install the first task recorded.
    expect(prepareWorktreeDependencies).toHaveBeenLastCalledWith(
      expect.objectContaining({ worktreePath: '/tmp/slots/repo-key/slot-0', previousFingerprint: 'fp-1' }),
    );
    expect(slotPool.recordDependencyFingerprint).toHaveBeenLastCalledWith(
      expect.objectContaining({ slotId: 'slot-0', fingerprint: 'fp-1' }),
    );
  });

  it('still allocates one worktree per task when no slot pool is configured', async () => {
    vi.mocked(createWorktree).mockImplementation(async (input) => ({
      worktreePath: `/tmp/worktrees/${input.name}`,
      branch: `piwin/subagent/${input.name}`,
    }));
    const service = createSubagentWorkspaceService({
      projectPath: '/tmp/project',
      worktreeStorageRoot: '/tmp/slots',
      dirtyBasePolicy: 'bypass',
      parallelWritePolicy: 'worktree-only',
    });

    const first = await service.acquire(makeTask({ id: 'task-1', isolationOverride: 'worktree' }));
    await service.release(first);
    const second = await service.acquire(makeTask({ id: 'task-2', isolationOverride: 'worktree' }));

    if (first.mode !== 'worktree' || second.mode !== 'worktree') throw new Error('expected worktree');
    expect(second.worktreePath).not.toBe(first.worktreePath);
    expect(first.slotId).toBeUndefined();
    expect(vi.mocked(createWorktree)).toHaveBeenCalledTimes(2);
  });

  it('returns the slot to the pool on release', async () => {
    const slotPool = createFakeSlotPool();
    const service = createSubagentWorkspaceService({
      projectPath: '/tmp/project',
      worktreeStorageRoot: '/tmp/slots',
      writerSlotPool: slotPool,
      dirtyBasePolicy: 'bypass',
      parallelWritePolicy: 'worktree-only',
    });

    const lease = await service.acquire(makeTask({ isolationOverride: 'worktree' }));
    await service.release(lease);
    expect(slotPool.release).toHaveBeenCalledWith({
      projectPath: '/tmp/project',
      storageRoot: '/tmp/slots',
      slotId: 'slot-0',
    });
  });

  it('restores the child\'s frozen tree into the slot for a continuation', async () => {
    const slotPool = createFakeSlotPool();
    // The predecessor's own base, not the parent's current HEAD.
    const predecessorBase = '9999999999999999999999999999999999999999';
    const service = createSubagentWorkspaceService({
      projectPath: '/tmp/project',
      worktreeStorageRoot: '/tmp/slots',
      writerSlotPool: slotPool,
      dirtyBasePolicy: 'bypass',
      parallelWritePolicy: 'worktree-only',
    });

    const lease = await service.acquire(
      makeTask({
        continuationSessionId: 'child-1',
        isolationOverride: 'worktree',
        continuationWorkspaceLease: {
          mode: 'worktree',
          cwd: '/tmp/slots/repo-key/slot-0',
          parentRepoPath: '/tmp/project',
          worktreePath: '/tmp/slots/repo-key/slot-0',
          worktreeBranch: 'piwin/subagent/slot-0',
          baseCommit: predecessorBase,
          slotId: 'slot-0',
        },
        continuationRestore: { baseCommit: predecessorBase, tree: 'treeoid123' },
      }),
    );

    if (lease.mode !== 'worktree') throw new Error('expected worktree');
    expect(slotPool.acquire).toHaveBeenCalledWith(
      expect.objectContaining({ baseCommit: predecessorBase }),
    );
    expect(checkoutWorktreeTree).toHaveBeenCalledWith({
      worktreePath: '/tmp/slots/repo-key/slot-0',
      tree: 'treeoid123',
    });
    expect(lease.baseCommit).toBe(predecessorBase);
    expect(lease.slotId).toBe('slot-0');
  });

  function slotContinuationTask(overrides: Partial<SubagentTaskSpec> = {}): SubagentTaskSpec {
    const base = '9999999999999999999999999999999999999999';
    return makeTask({
      id: 'continue-1',
      continuationSessionId: 'child-1',
      isolationOverride: 'worktree',
      continuationWorkspaceLease: {
        mode: 'worktree',
        cwd: '/tmp/slots/repo-key/slot-0',
        parentRepoPath: '/tmp/project',
        worktreePath: '/tmp/slots/repo-key/slot-0',
        worktreeBranch: 'piwin/subagent/slot-0',
        baseCommit: base,
        slotId: 'slot-0',
      },
      continuationRestore: { baseCommit: base, tree: 'treeoid123' },
      ...overrides,
    });
  }

  it('waits for the running writer before resetting the slot for a continuation', async () => {
    const slotPool = createFakeSlotPool();
    const service = createSubagentWorkspaceService({
      projectPath: '/tmp/project',
      worktreeStorageRoot: '/tmp/slots',
      writerSlotPool: slotPool,
      dirtyBasePolicy: 'bypass',
      parallelWritePolicy: 'worktree-only',
    });

    const running = await service.acquire(makeTask({ id: 'writer', isolationOverride: 'worktree' }));
    const continuation = service.acquire(slotContinuationTask());
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The writer still holds the project lock: the slot must not be reset under it.
    expect(slotPool.acquire).toHaveBeenCalledTimes(1);

    await service.release(running);
    const lease = await continuation;
    expect(slotPool.acquire).toHaveBeenCalledTimes(2);
    if (lease.mode !== 'worktree') throw new Error('expected worktree');
    expect(lease.slotId).toBe('slot-0');
  });

  it('refuses a slot continuation that has no frozen tree to restore', async () => {
    const slotPool = createFakeSlotPool();
    const service = createSubagentWorkspaceService({
      projectPath: '/tmp/project',
      worktreeStorageRoot: '/tmp/slots',
      writerSlotPool: slotPool,
      dirtyBasePolicy: 'bypass',
      parallelWritePolicy: 'worktree-only',
    });
    const task = slotContinuationTask();
    delete task.continuationRestore;

    await expect(service.acquire(task)).rejects.toThrow(/snapshot is unavailable/);
    expect(slotPool.acquire).not.toHaveBeenCalled();
    // The failed continuation must not leave the project locked.
    const next = await service.acquire(makeTask({ id: 'after', isolationOverride: 'worktree' }));
    expect(next.mode).toBe('worktree');
  });
});
