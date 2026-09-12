import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { emptySubagentResultReviewFields, type SubagentResultSummary, type ToolResult } from '@piwin/contracts';
import { createSubagentRunStore } from '@piwin/session';
import { createSubagentResultService } from './subagent-result-service.js';
import { createSubagentReviewService } from './subagent-review-service.js';
import {
  SUBAGENT_REVIEW_SUBMIT_TOOL_NAME,
  createSubagentReviewSubmitTool,
} from './subagent-review-submit-tool.js';

const dirs: string[] = [];
const SCOPE = {
  result: { resultId: 'result-1', revision: 1 },
  changes: { changeSetId: 'cs-child', revision: 1 },
};

function makeSummary(overrides: Partial<SubagentResultSummary> = {}): SubagentResultSummary {
  return {
    resultId: 'result-1',
    revision: 1,
    parentSessionId: 'parent-1',
    childSessionId: 'worker-child',
    taskId: 'worker-task',
    batchRunId: 'worker-run',
    sourceAttemptId: null,
    targetWorkspaceId: 'ws-1',
    deliveryIntent: 'candidate',
    legacyManual: false,
    candidateGroupId: null,
    ...emptySubagentResultReviewFields(),
    executionStatus: 'completed',
    summaryStatus: 'merged',
    integrationStatus: 'retained',
    childChanges: SCOPE.changes,
    appliedChanges: null,
    copyState: 'present',
    latestOperationId: null,
    availability: {
      view: { allowed: true },
      apply: { allowed: true },
      resolve: { allowed: true },
      cleanup: { allowed: true },
    },
    ...overrides,
  };
}

async function execute(
  tool: ReturnType<typeof createSubagentReviewSubmitTool>,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return tool.execute(args, new AbortController().signal, {
    sessionId: 'reviewer-child',
    runtimeGenerationId: 'gen-1',
    runId: 'reviewer-task-run',
    toolName: SUBAGENT_REVIEW_SUBMIT_TOOL_NAME,
  });
}

async function setupTool() {
  const dir = await mkdtemp(join(tmpdir(), 'piwin-review-submit-'));
  dirs.push(dir);
  const store = createSubagentRunStore({ runsDir: dir });
  const resultService = createSubagentResultService();
  resultService.register(makeSummary());
  await store.createManifest('worker-run', {
    parentSessionId: 'parent-1',
    tasks: [{ id: 'worker-task', parentSessionId: 'parent-1', task: 'implement' }],
  });
  await store.recordResult('worker-run', 'worker-task', {
    runId: 'worker-run',
    taskId: 'worker-task',
    childSessionId: 'worker-child',
    executionStatus: 'completed',
    summaryStatus: 'merged',
    integrationStatus: 'retained',
    resultRef: SCOPE.result,
    childChanges: SCOPE.changes,
  });
  await store.createManifest('reviewer-run', {
    parentSessionId: 'parent-1',
    tasks: [
      {
        id: 'reviewer-task',
        parentSessionId: 'parent-1',
        invocationId: 'reviewer-inv',
        task: 'review',
        role: 'reviewer',
        reviewTarget: { result: SCOPE.result, changes: SCOPE.changes },
      },
    ],
  });
  await store.recordInvocation('reviewer-run', {
    id: 'reviewer-inv',
    parentSessionId: 'parent-1',
    runId: 'reviewer-run',
    taskId: 'reviewer-task',
    task: 'review',
    childSessionId: 'reviewer-child',
    status: 'running',
    activity: { kind: 'thinking' },
    revision: 1,
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
  });
  const service = createSubagentReviewService({
    runStore: store,
    resultService,
    createId: () => 'review-1',
    now: () => new Date('2026-09-13T01:00:00.000Z'),
  });
  return createSubagentReviewSubmitTool({
    scope: SCOPE,
    reviewerSessionId: 'reviewer-child',
    invocationId: 'reviewer-inv',
    service,
  });
}

describe('piwin_subagent_review_submit', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('approved / changes-requested / blocked validation matrix', async () => {
    const tool = await setupTool();
    expect(
      await execute(tool, {
        target: SCOPE.result,
        decision: 'approved',
        findings: [
          {
            id: 'f1',
            severity: 'critical',
            title: 'Leak',
            detail: 'Secrets in the diff',
          },
        ],
        verification: [],
      }),
    ).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(
      await execute(tool, {
        target: SCOPE.result,
        decision: 'changes-requested',
        findings: [],
        verification: [],
      }),
    ).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(
      await execute(tool, {
        target: SCOPE.result,
        decision: 'blocked',
        findings: [{ id: 'f1', severity: 'low', title: 'Need env', detail: 'Missing secret' }],
        verification: [],
      }),
    ).toMatchObject({
      ok: true,
      details: { reviewRef: { reviewId: 'review-1', revision: 1 }, decision: 'blocked' },
    });
  });

  it('rejects an unscoped target and a second different decision', async () => {
    const tool = await setupTool();
    expect(
      await execute(tool, {
        target: { resultId: 'other', revision: 1 },
        decision: 'approved',
        findings: [],
        verification: [],
      }),
    ).toMatchObject({ ok: false, code: 'review-target-forbidden' });

    const first = await execute(tool, {
      target: SCOPE.result,
      decision: 'approved',
      findings: [],
      verification: [],
    });
    expect(first).toMatchObject({ ok: true, details: { reviewRef: { reviewId: 'review-1' } } });
    const retry = await execute(tool, {
      target: SCOPE.result,
      decision: 'approved',
      findings: [],
      verification: [],
    });
    expect(retry).toMatchObject({ ok: true, details: { reviewRef: { reviewId: 'review-1' } } });
    expect(
      await execute(tool, {
        target: SCOPE.result,
        decision: 'changes-requested',
        findings: [{ id: 'f1', severity: 'medium', title: 'Nit', detail: 'Rename' }],
        verification: [],
      }),
    ).toMatchObject({ ok: false, code: 'invalid-input' });
  });
});
