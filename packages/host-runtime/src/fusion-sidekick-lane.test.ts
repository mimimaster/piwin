import { describe, expect, it } from 'vitest';
import {
  FUSION_SCHEME_ID,
  PIWIN_FUSION_BRIEF_MARKER,
  resolveOrchestrationScheme,
  type SessionIndexRecord,
} from '@piwin/contracts';
import { resolveSubagentChildPrompt } from './subagent-lifecycle-service.js';
import {
  FUSION_SIDEKICK_CAPABILITIES,
  buildFusionSidekickSpawnFields,
  isFusionSidekickRole,
  resolveFusionStartTaskPatch,
  selectFusionSidekickLane,
} from './fusion-sidekick-lane.js';

function fusionScheme() {
  return resolveOrchestrationScheme(
    { maxConcurrency: 4, maxTasksPerRun: 8 },
    FUSION_SCHEME_ID,
    { knownProfileIds: ['implementer'] },
  );
}

function child(overrides: Partial<SessionIndexRecord>): SessionIndexRecord {
  return {
    id: 'child-1',
    projectPath: '/repo',
    createdAt: '2026-09-18T00:00:00.000Z',
    updatedAt: '2026-09-18T00:00:00.000Z',
    messageCount: 1,
    kind: 'subagent',
    parentSessionId: 'parent',
    subagentRole: 'sidekick',
    subagentStatus: 'done',
    subagentMode: 'worktree',
    subagentLifecycle: {
      executionStatus: 'completed',
      summaryStatus: 'merged',
      integrationStatus: 'retained',
    },
    worktreePath: '/tmp/wt',
    ...overrides,
  };
}

describe('fusion sidekick lane', () => {
  it('identifies fusion sidekick only', () => {
    const scheme = fusionScheme();
    expect(isFusionSidekickRole(scheme, 'sidekick')).toBe(true);
    expect(isFusionSidekickRole(scheme, 'scout')).toBe(false);
    expect(isFusionSidekickRole(undefined, 'sidekick')).toBe(false);
  });

  it('wraps the brief, holds the change as an explicit candidate, and strips delegate', () => {
    const fields = buildFusionSidekickSpawnFields('fix flaky test');
    expect(fields.task).toContain(PIWIN_FUSION_BRIEF_MARKER);
    expect(fields.task).toMatch(/cannot see the parent conversation/i);
    expect(fields.task).toContain('fix flaky test');
    // No retainWorktree: an applied candidate's copy is reclaimed like any other.
    expect(fields).not.toHaveProperty('retainWorktree');
    expect(fields.deliveryIntent).toBe('candidate');
    expect(fields.applyPolicy).toBe('explicit');
    expect(fields.capabilities).not.toContain('delegate');
    expect(FUSION_SIDEKICK_CAPABILITIES).not.toContain('delegate');
    expect(fields.capabilities).toContain('write');
  });

  it('selects the newest retained sidekick and skips running or other roles', () => {
    const selected = selectFusionSidekickLane([
      child({
        id: 'scout',
        subagentRole: 'scout',
        updatedAt: '2026-09-18T02:00:00.000Z',
      }),
      child({
        id: 'running',
        subagentStatus: 'running',
        updatedAt: '2026-09-18T03:00:00.000Z',
      }),
      child({
        id: 'lane',
        updatedAt: '2026-09-18T01:00:00.000Z',
      }),
      (() => {
        const record = child({
          id: 'no-tree',
          updatedAt: '2026-09-18T04:00:00.000Z',
        });
        delete record.worktreePath;
        return record;
      })(),
    ]);
    expect(selected?.id).toBe('lane');
  });

  it('does not continue a lane whose candidate was already applied, even if retained', () => {
    expect(
      selectFusionSidekickLane([
        child({
          subagentRetainWorktree: true,
          subagentLifecycle: {
            executionStatus: 'completed',
            summaryStatus: 'merged',
            integrationStatus: 'applied',
          },
        }),
      ]),
    ).toBeUndefined();
  });

  it('does not select a child without retain or retained integration', () => {
    expect(
      selectFusionSidekickLane([
        child({
          subagentRetainWorktree: false,
          subagentLifecycle: {
            executionStatus: 'completed',
            summaryStatus: 'merged',
            integrationStatus: 'applied',
          },
        }),
      ]),
    ).toBeUndefined();
  });

  it('continuation prompt is the new brief only (already enveloped by the patch)', async () => {
    const patch = await resolveFusionStartTaskPatch({
      scheme: fusionScheme(),
      role: 'sidekick',
      task: 'second brief',
      parentSessionId: 'parent',
      resolveLane: async () => ({
        child: child({ id: 'lane-child' }),
        parent: child({ id: 'parent', kind: 'main' }),
        runtime: { isolation: 'worktree', workingDirectory: '/tmp/wt' },
        mode: 'worktree',
        continuationWorkspaceLease: {
          mode: 'worktree',
          cwd: '/tmp/wt',
          parentRepoPath: '/repo',
          worktreePath: '/tmp/wt',
          worktreeBranch: 'piwin/subagent-lane',
          baseCommit: 'abc123',
        },
      }),
    });
    expect(patch?.continuationSessionId).toBe('lane-child');
    const continuationSessionId = patch?.continuationSessionId;
    if (!patch || !continuationSessionId) {
      throw new Error('expected fusion continuation patch');
    }
    expect(
      resolveSubagentChildPrompt({
        task: patch.task,
        continuationSessionId,
      }),
    ).toBe(patch.task);
    expect(patch!.task).toContain('second brief');
    expect(patch!.task).not.toMatch(/parent history|user said/i);
  });

  it('fresh fusion spawn still envelopes without a lane', async () => {
    const patch = await resolveFusionStartTaskPatch({
      scheme: fusionScheme(),
      role: 'sidekick',
      task: 'first brief',
      parentSessionId: 'parent',
    });
    expect(patch?.continuationSessionId).toBeUndefined();
    expect(
      resolveSubagentChildPrompt({
        task: patch!.task,
        isolationOverride: 'worktree',
        reportContract: 'done | blocked | escalate',
      }),
    ).toContain(PIWIN_FUSION_BRIEF_MARKER);
  });
});
