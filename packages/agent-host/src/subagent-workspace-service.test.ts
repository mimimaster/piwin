import { describe, expect, it } from 'vitest';
import { createSubagentWorkspaceService } from './subagent-workspace-service.js';
import type { SubagentTaskSpec } from '@piwin/contracts';

function makeTask(overrides: Partial<SubagentTaskSpec> = {}): SubagentTaskSpec {
  return {
    id: 'task-1',
    parentSessionId: 'parent-1',
    task: 'do something',
    ...overrides,
  };
}

describe('SubagentWorkspaceService', () => {
  it('acquires readonly lease using project path', async () => {
    const service = createSubagentWorkspaceService({
      projectPath: '/tmp/project',
      requireCleanBaseForParallelWrites: false,
      parallelWritePolicy: 'worktree-only',
    });
    const lease = await service.acquire(makeTask({ isolationOverride: 'readonly' }));
    expect(lease.mode).toBe('readonly');
    expect(lease.cwd).toBe('/tmp/project');
    expect(lease.worktreePath).toBeUndefined();
  });

  it('releases readonly lease without error', async () => {
    const service = createSubagentWorkspaceService({
      projectPath: '/tmp/project',
      requireCleanBaseForParallelWrites: false,
      parallelWritePolicy: 'worktree-only',
    });
    const lease = await service.acquire(makeTask({ isolationOverride: 'readonly' }));
    await expect(service.release(lease)).resolves.toBeUndefined();
  });

  it('rejects worktree when parallelWritePolicy is disabled', async () => {
    const service = createSubagentWorkspaceService({
      projectPath: '/tmp/project',
      requireCleanBaseForParallelWrites: false,
      parallelWritePolicy: 'disabled',
    });
    await expect(
      service.acquire(makeTask({ isolationOverride: 'worktree' })),
    ).rejects.toThrow('parallel writes are disabled');
  });
});
