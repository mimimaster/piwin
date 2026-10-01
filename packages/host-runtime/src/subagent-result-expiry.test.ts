import { describe, expect, it, vi } from 'vitest';
import type { SubagentRunManifest } from '@piwin/session';

import {
  SUBAGENT_RESULT_EXPIRY_MS,
  expireStaleSubagentResults,
  selectExpiredSubagentResults,
} from './subagent-result-expiry.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-10T00:00:00Z');

type ResultOverrides = Record<string, unknown>;

/** One-task manifest; defaults describe an undecided candidate from a slot copy. */
function manifest(
  runId: string,
  overrides: {
    status?: SubagentRunManifest['status'];
    result?: ResultOverrides;
    lease?: Record<string, unknown>;
    retainWorktree?: boolean;
    createdAt?: string;
  } = {},
): SubagentRunManifest {
  return {
    runId,
    parentSessionId: 'parent',
    createdAt: overrides.createdAt ?? '2026-09-01T00:00:00Z',
    updatedAt: '2026-10-09T23:59:00Z',
    status: overrides.status ?? 'needs-integration',
    tasks: [{ id: 't1', task: 'x', ...(overrides.retainWorktree ? { retainWorktree: true } : {}) }],
    leases: {
      t1: {
        mode: 'worktree',
        cwd: '/slot',
        parentRepoPath: '/repo',
        worktreePath: '/slot',
        worktreeBranch: 'piwin/subagent/slot-0',
        baseCommit: 'base',
        slotId: 'slot-0',
        ...overrides.lease,
      },
    },
    results: {
      t1: {
        runId,
        taskId: 't1',
        childSessionId: `child-${runId}`,
        executionStatus: 'completed',
        summaryStatus: 'not-requested',
        integrationStatus: 'retained',
        gitSnapshot: { tree: 'tree', commit: `commit-${runId}`, ref: `refs/piwin/results/${runId}` },
        ...overrides.result,
      },
    },
    invocations: {},
  } as unknown as SubagentRunManifest;
}

function select(
  manifests: SubagentRunManifest[],
  frozenAgeDays: number,
  isRunActive: (runId: string) => boolean = () => false,
) {
  return selectExpiredSubagentResults({
    manifests,
    nowMs: NOW,
    ttlMs: SUBAGENT_RESULT_EXPIRY_MS,
    isRunActive,
    frozenAtMs: () => NOW - frozenAgeDays * DAY,
  });
}

describe('selectExpiredSubagentResults', () => {
  it('selects an undecided result once it is older than the horizon', () => {
    expect(select([manifest('run-1')], 8)).toEqual([
      expect.objectContaining({ runId: 'run-1', taskId: 't1', childSessionId: 'child-run-1' }),
    ]);
    expect(select([manifest('run-1')], 6)).toEqual([]);
  });

  it('never touches a result that is decided, failed or kept on purpose', () => {
    const settled = [
      manifest('applied', { result: { integrationStatus: 'applied' } }),
      manifest('discarded', { result: { integrationStatus: 'discarded' } }),
      manifest('conflict', { result: { integrationStatus: 'conflict' } }),
      manifest('failed-run', { result: { executionStatus: 'failed' } }),
      manifest('kept', { retainWorktree: true }),
      manifest('no-child', { result: { childSessionId: undefined } }),
      manifest('readonly', { lease: { mode: 'readonly' } }),
    ];
    expect(select(settled, 30)).toEqual([]);
  });

  it('leaves a run that is still running or active alone', () => {
    expect(select([manifest('running', { status: 'running' })], 30)).toEqual([]);
    expect(select([manifest('active')], 30, (runId) => runId === 'active')).toEqual([]);
  });
});

describe('expireStaleSubagentResults', () => {
  function ports(overrides: Partial<Parameters<typeof expireStaleSubagentResults>[0]> = {}) {
    return {
      listManifests: async () => [manifest('old'), manifest('fresh')],
      isRunActive: () => false,
      readSnapshotTimeMs: vi.fn(async (_repo: string, commit: string) =>
        commit === 'commit-old' ? NOW - 20 * DAY : NOW - 1 * DAY,
      ),
      discard: vi.fn(async () => undefined),
      warn: vi.fn(),
      now: () => NOW,
      ...overrides,
    };
  }

  it('discards only the old result, addressed by run and task', async () => {
    const p = ports();

    const outcome = await expireStaleSubagentResults(p);

    expect(outcome).toEqual({ discarded: 1, failed: 0 });
    expect(p.discard).toHaveBeenCalledTimes(1);
    expect(p.discard).toHaveBeenCalledWith(
      expect.objectContaining({ childSessionId: 'child-old', runId: 'old', taskId: 't1' }),
    );
  });

  it('ages a result by its snapshot, not by the manifest that startup keeps rewriting', async () => {
    // updatedAt is "a minute ago" in every manifest above; only the snapshot says old.
    const p = ports({ listManifests: async () => [manifest('old')] });

    await expireStaleSubagentResults(p);

    expect(p.discard).toHaveBeenCalledTimes(1);
  });

  it('falls back to run creation time when the snapshot is gone', async () => {
    const p = ports({
      listManifests: async () => [manifest('old', { createdAt: '2026-09-01T00:00:00Z' })],
      readSnapshotTimeMs: vi.fn(async () => undefined),
    });

    expect((await expireStaleSubagentResults(p)).discarded).toBe(1);
  });

  it('reports a failed discard and keeps going', async () => {
    const p = ports({
      listManifests: async () => [manifest('old'), manifest('older')],
      readSnapshotTimeMs: vi.fn(async () => NOW - 30 * DAY),
      discard: vi.fn(async (entry: { runId: string }) => {
        if (entry.runId === 'old') throw new Error('worktree is gone');
      }),
    });

    const outcome = await expireStaleSubagentResults(p);

    expect(outcome).toEqual({ discarded: 1, failed: 1 });
    expect(p.warn).toHaveBeenCalledWith(expect.stringContaining('worktree is gone'));
  });
});
