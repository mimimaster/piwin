import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SubagentTaskResult } from '@piwin/contracts';
import {
  createSessionRecord,
  createSubagentRunStore,
  upsertSessionRecord,
} from '@piwin/session';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { persistSubagentTaskResult } from './host-runtime-subagent.js';
import { getPiwinSessionIndexPath } from './paths.js';
import {
  applyLineageHeadProjection,
  enrichSubagentTaskResult,
  projectSubagentResultSummary,
} from './subagent-result-projection.js';
import { createSubagentResultService } from './subagent-result-service.js';

const dirs: string[] = [];

function firstCandidateResult(overrides: Partial<SubagentTaskResult> = {}): SubagentTaskResult {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    childSessionId: 'child-1',
    executionStatus: 'completed',
    summaryStatus: 'merged',
    integrationStatus: 'retained',
    resultRef: { resultId: 'result-v1', revision: 1 },
    ...overrides,
  };
}

describe('projectSubagentResultSummary', () => {
  it('bootstraps first-candidate lineage when persist left it unset', () => {
    const result = firstCandidateResult();
    const summary = projectSubagentResultSummary({
      parentSessionId: 'parent-1',
      result,
      task: { id: 'task-1', task: 'implement login', deliveryIntent: 'candidate' },
    });
    expect(summary).toMatchObject({
      resultId: 'result-v1',
      candidateLineageId: 'result-v1',
      candidateGeneration: 1,
      legacyManual: false,
    });
    expect(enrichSubagentTaskResult(result, summary!).candidateLineageId).toBe('result-v1');
    expect(enrichSubagentTaskResult(result, summary!).candidateGeneration).toBe(1);
  });

  it('keeps an explicit lineage and leaves legacy or report results unset', () => {
    const continued = projectSubagentResultSummary({
      parentSessionId: 'parent-1',
      result: firstCandidateResult({
        resultRef: { resultId: 'result-v2', revision: 1 },
        candidateLineageId: 'result-v1',
        candidateGeneration: 2,
      }),
      task: { id: 'task-1', task: 'repair login', deliveryIntent: 'candidate' },
    });
    expect(continued).toMatchObject({
      candidateLineageId: 'result-v1',
      candidateGeneration: 2,
    });

    expect(
      projectSubagentResultSummary({
        parentSessionId: 'parent-1',
        result: firstCandidateResult(),
        task: { id: 'task-1', task: 'old worktree task' },
      }),
    ).toMatchObject({
      legacyManual: true,
      candidateLineageId: null,
      candidateGeneration: null,
    });

    expect(
      projectSubagentResultSummary({
        parentSessionId: 'parent-1',
        result: firstCandidateResult(),
        task: { id: 'task-1', task: 'review login', deliveryIntent: 'report' },
      }),
    ).toMatchObject({
      candidateLineageId: null,
      candidateGeneration: null,
    });
  });

  it('closes apply on bootstrapped v1 once v2 shares the lineage', () => {
    const v1 = projectSubagentResultSummary({
      parentSessionId: 'parent-1',
      result: firstCandidateResult(),
      task: { id: 'task-1', task: 'implement login', deliveryIntent: 'candidate' },
    });
    const v2 = projectSubagentResultSummary({
      parentSessionId: 'parent-1',
      result: firstCandidateResult({
        taskId: 'task-2',
        resultRef: { resultId: 'result-v2', revision: 1 },
        candidateLineageId: 'result-v1',
        candidateGeneration: 2,
      }),
      task: {
        id: 'task-2',
        task: 'repair login',
        deliveryIntent: 'candidate',
        candidateLineageId: 'result-v1',
        candidateGeneration: 2,
      },
    });
    if (!v1 || !v2) throw new Error('expected projected candidates');
    const [headV1] = applyLineageHeadProjection([v1, v2]);
    expect(headV1?.reviewStatus).toBe('stale');
    expect(headV1?.availability.apply).toEqual({ allowed: false, reason: 'candidate-superseded' });
  });

  it('does not inherit a task verification onto a different result', () => {
    const summary = projectSubagentResultSummary({
      parentSessionId: 'parent-1',
      result: firstCandidateResult({
        resultRef: { resultId: 'result-v2', revision: 1 },
        integrationStatus: 'retained',
      }),
      task: {
        id: 'task-1',
        task: 'implement login',
        deliveryIntent: 'candidate',
        latestVerification: { verificationId: 'verify-old', revision: 1 },
        deliveryVerification: {
          verificationId: 'verify-old',
          revision: 1,
          parentSessionId: 'parent-1',
          parentRunId: 'parent-run',
          result: { resultId: 'result-v1', revision: 1 },
          approvedBy: { reviewId: 'review-1', revision: 1 },
          applyOperationId: 'op-old',
          appliedChanges: { changeSetId: 'cs-old', revision: 1 },
          status: 'passed',
          checks: [{ label: 'typecheck', status: 'passed', evidence: 'ok' }],
          createdAt: '2026-09-13T00:00:00.000Z',
        },
      },
    });
    expect(summary).toMatchObject({
      resultId: 'result-v2',
      latestVerification: null,
      appliedChanges: null,
      latestOperationId: null,
    });
  });

  it('keeps a matching task verification on the applied result', () => {
    const summary = projectSubagentResultSummary({
      parentSessionId: 'parent-1',
      result: firstCandidateResult({
        integrationStatus: 'applied',
      }),
      task: {
        id: 'task-1',
        task: 'implement login',
        deliveryIntent: 'candidate',
        deliveryVerification: {
          verificationId: 'verify-1',
          revision: 1,
          parentSessionId: 'parent-1',
          parentRunId: 'parent-run',
          result: { resultId: 'result-v1', revision: 1 },
          approvedBy: { reviewId: 'review-1', revision: 1 },
          applyOperationId: 'op-1',
          appliedChanges: { changeSetId: 'cs-1', revision: 1 },
          status: 'passed',
          checks: [{ label: 'typecheck', status: 'passed', evidence: 'ok' }],
          createdAt: '2026-09-13T00:00:00.000Z',
        },
      },
    });
    expect(summary).toMatchObject({
      latestVerification: { verificationId: 'verify-1', revision: 1 },
      appliedChanges: { changeSetId: 'cs-1', revision: 1 },
      latestOperationId: 'op-1',
    });
  });
});

describe('persistSubagentTaskResult', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('writes first-candidate lineage on the real persist path', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-persist-lineage-'));
    dirs.push(piwinRoot);
    await upsertSessionRecord(
      getPiwinSessionIndexPath(piwinRoot),
      createSessionRecord({
        id: 'child-1',
        projectPath: '/tmp/project',
        parentSessionId: 'parent-1',
        kind: 'subagent',
        name: 'child',
      }),
    );
    const runStore = createSubagentRunStore({ runsDir: join(piwinRoot, 'subagent-runs') });
    await runStore.createManifest('run-1', {
      parentSessionId: 'parent-1',
      tasks: [
        {
          id: 'task-1',
          task: 'implement login',
          deliveryIntent: 'candidate',
          parentSessionId: 'parent-1',
        },
      ],
    });
    const resultService = createSubagentResultService();
    const result = firstCandidateResult();
    await persistSubagentTaskResult(
      {
        options: { mode: 'sdk', piwinRoot },
        subagentResultService: resultService,
        subagentRunStore: runStore,
        push() {},
      },
      'parent-1',
      result,
    );

    expect(resultService.get('result-v1')).toMatchObject({
      candidateLineageId: 'result-v1',
      candidateGeneration: 1,
    });
    expect((await runStore.loadManifest('run-1'))?.results['task-1']).toMatchObject({
      candidateLineageId: 'result-v1',
      candidateGeneration: 1,
    });
  });
});
