import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SubagentTaskResult } from '@piwin/contracts';
import {
  createSessionRecord,
  createSubagentRunStore,
  getSessionRecord,
  upsertSessionRecord,
} from '@piwin/session';

import { discardSubagentResult } from './host-runtime-subagent-worktree-results.js';
import { getPiwinSessionIndexPath } from './paths.js';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** One retained candidate whose copy and snapshot are both gone, as on old runs. */
async function setupZombie() {
  const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-stale-discard-'));
  roots.push(piwinRoot);
  const runStore = createSubagentRunStore({ runsDir: join(piwinRoot, 'subagent-runs') });
  await runStore.createManifest('run-1', {
    parentSessionId: 'parent',
    tasks: [{ id: 't1', parentSessionId: 'parent', task: 'implement', isolationOverride: 'worktree' }],
  });
  await runStore.recordLease('run-1', 't1', {
    mode: 'worktree',
    cwd: '/gone/wt',
    parentRepoPath: '/gone/repo',
    worktreePath: '/gone/wt',
    worktreeBranch: 'piwin/subagent/old',
    baseCommit: 'abc',
  });
  const retained: SubagentTaskResult = {
    runId: 'run-1',
    taskId: 't1',
    childSessionId: 'child-1',
    executionStatus: 'completed',
    summaryStatus: 'not-requested',
    integrationStatus: 'retained',
    worktreePath: '/gone/wt',
  };
  await runStore.recordResult('run-1', 't1', retained);
  await runStore.setStatus('run-1', 'needs-integration');
  const indexPath = getPiwinSessionIndexPath(piwinRoot);
  await upsertSessionRecord(
    indexPath,
    createSessionRecord({
      id: 'child-1',
      projectPath: '/gone/repo',
      parentSessionId: 'parent',
      kind: 'subagent',
      task: 'implement',
      subagentStatus: 'done',
    }),
  );

  const pushed: unknown[] = [];
  const persistSubagentTaskResult = vi.fn(async () => undefined);
  const deps = {
    options: { piwinRoot },
    // No frozen snapshot and no live checkout: the lease cannot be resolved.
    resolveRetainedSubagentWorktreeLease: vi.fn(async () => {
      throw new Error('subagent worktree is invalid; start a new isolated task to continue');
    }),
    persistSubagentTaskResult,
    push: (message: unknown) => pushed.push(message),
    turnChangeRuntime: undefined,
  } as unknown as HostRuntimeKernel;
  return { piwinRoot, runStore, deps, pushed, persistSubagentTaskResult, indexPath };
}

describe('discardSubagentResult', () => {
  it('settles a result that has no copy and no snapshot left, instead of failing on every launch', async () => {
    const { runStore, deps, pushed, persistSubagentTaskResult, indexPath } = await setupZombie();

    const outcome = await discardSubagentResult(deps, {
      childSessionId: 'child-1',
      runId: 'run-1',
      taskId: 't1',
    });

    expect(outcome.integrationStatus).toBe('discarded');
    const manifest = await runStore.loadManifest('run-1');
    expect(manifest?.results.t1?.integrationStatus).toBe('discarded');
    expect(manifest?.results.t1?.worktreePath).toBeUndefined();
    // The batch no longer waits on integration.
    expect(manifest?.status).toBe('completed');
    expect(persistSubagentTaskResult).toHaveBeenCalledWith(
      'parent',
      expect.objectContaining({ integrationStatus: 'discarded' }),
    );
    const child = await getSessionRecord(indexPath, 'child-1');
    expect(child?.subagentLifecycle?.integrationStatus).toBe('discarded');
    expect(pushed).toContainEqual(
      expect.objectContaining({ type: 'subagent/batch-updated', runId: 'run-1' }),
    );
  });

  it('is safe to run again once settled', async () => {
    const { deps } = await setupZombie();
    const entry = { childSessionId: 'child-1', runId: 'run-1', taskId: 't1' };

    await discardSubagentResult(deps, entry);

    await expect(discardSubagentResult(deps, entry)).resolves.toMatchObject({
      integrationStatus: 'discarded',
    });
  });

  it('reports a result that is no longer on record', async () => {
    const { deps } = await setupZombie();

    await expect(
      discardSubagentResult(deps, { childSessionId: 'child-1', runId: 'nope', taskId: 't1' }),
    ).rejects.toThrow(/no longer on record/);
  });
});
