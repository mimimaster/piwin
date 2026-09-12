import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  emptySubagentResultReviewFields,
  type HostToolRegistration,
  type SubagentResultSummary,
  type SubagentReviewRecord,
  type ToolResult,
} from '@piwin/contracts';
import { openTurnChangeStore } from '@piwin/git';
import { handleSubagentCommand, type SubagentCommandContext } from './commands/subagent-commands.js';
import { createSubagentIntegrationCoordinator } from './subagent-integration-coordinator.js';
import {
  applyStatusFromIntegration,
  subagentApplyIdempotencyKey,
  subagentApplyRequestHash,
} from './subagent-apply-reservation.js';
import {
  SUBAGENT_RESULT_APPLY_TOOL_NAME,
  applyReviewedSubagentResult,
  evaluateReviewedApplyInvariants,
} from './subagent-result-apply.js';
import { createSubagentResultApplyTool } from './subagent-result-apply-tool.js';
import { createSubagentResultService } from './subagent-result-service.js';
import type { SubagentRunSeam } from './subagent-run-tool.js';

const SESSION_ID = 'parent-1';
const APPROVED_BY = { reviewId: 'rev-v2', revision: 1 };
const RESULT_V1 = { resultId: 'result-v1', revision: 1 };
const RESULT_V2 = { resultId: 'result-v2', revision: 1 };
const CHANGES_V1 = { changeSetId: 'cs-v1', revision: 1 };
const CHANGES_V2 = { changeSetId: 'cs-v2', revision: 1 };

const dirs: string[] = [];

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(error: Error): void;
} {
  let resolvePromise: ((value: T | PromiseLike<T>) => void) | undefined;
  let rejectPromise: ((error: Error) => void) | undefined;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolvePromise = resolveValue;
    rejectPromise = rejectValue;
  });
  return {
    promise,
    resolve: (value: T | PromiseLike<T>) => {
      if (!resolvePromise) throw new Error('deferred promise was not initialized');
      resolvePromise(value);
    },
    reject: (error: Error) => {
      if (!rejectPromise) throw new Error('deferred promise was not initialized');
      rejectPromise(error);
    },
  };
}

function makeSummary(overrides: Partial<SubagentResultSummary> = {}): SubagentResultSummary {
  return {
    resultId: 'result-v2',
    revision: 1,
    parentSessionId: SESSION_ID,
    childSessionId: 'child-1',
    taskId: 'task-1',
    batchRunId: 'run-1',
    sourceAttemptId: null,
    targetWorkspaceId: 'ws-1',
    deliveryIntent: 'candidate',
    legacyManual: false,
    candidateGroupId: null,
    ...emptySubagentResultReviewFields(),
    candidateLineageId: 'lineage-login',
    candidateGeneration: 2,
    predecessorResult: RESULT_V1,
    latestReview: APPROVED_BY,
    reviewStatus: 'approved',
    executionStatus: 'completed',
    summaryStatus: 'merged',
    integrationStatus: 'retained',
    childChanges: CHANGES_V2,
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

function makeReview(overrides: Partial<SubagentReviewRecord> = {}): SubagentReviewRecord {
  return {
    reviewId: APPROVED_BY.reviewId,
    revision: 1,
    parentSessionId: SESSION_ID,
    reviewerSessionId: 'reviewer-1',
    reviewerRunId: 'run-reviewer',
    targetResult: RESULT_V2,
    targetChanges: CHANGES_V2,
    decision: 'approved',
    findings: [],
    verification: [],
    createdAt: '2026-09-13T02:00:00.000Z',
    ...overrides,
  };
}

function dummySeam(
  applyReviewed: NonNullable<SubagentRunSeam['applyReviewed']>,
): SubagentRunSeam {
  return {
    spawn: async () => {
      throw new Error('unused');
    },
    merge: async () => ({}),
    applyReviewed,
  };
}

async function executeTool(
  tool: HostToolRegistration,
  args: Record<string, unknown>,
  signal = new AbortController().signal,
): Promise<ToolResult> {
  return tool.execute(args, signal, {
    sessionId: SESSION_ID,
    runtimeGenerationId: 'generation-1',
    runId: 'parent-run',
    toolName: tool.descriptor.name,
    toolCallId: 'tool-call-1',
  });
}

function createHarness(options?: {
  summaries?: SubagentResultSummary[];
  reviews?: SubagentReviewRecord[];
  applyStatus?: 'succeeded' | 'rejected' | 'needs-repair';
  probeWrite?: () => Promise<
    { ok: true } | { ok: false; code: 'permission-denied' | 'workspace-busy' | 'aborted' }
  >;
  applyResult?: (input: {
    resultId: string;
    expectedRevision: number;
    operationId: string;
  }) => Promise<{
    operationId: string;
    status?: 'succeeded' | 'rejected' | 'needs-repair';
  }>;
}) {
  const writes: string[] = [];
  const resultService = createSubagentResultService();
  for (const summary of options?.summaries ?? [makeSummary()]) {
    resultService.register(summary);
  }
  const reviews = new Map<string, SubagentReviewRecord>();
  for (const review of options?.reviews ?? [makeReview()]) {
    reviews.set(`${review.reviewId}:${String(review.revision)}`, review);
  }
  const applyReviewed: NonNullable<SubagentRunSeam['applyReviewed']> = async (input) =>
    applyReviewedSubagentResult(
      {
        resultService,
        loadReview: async (ref) => reviews.get(`${ref.reviewId}:${String(ref.revision)}`),
        applyResult:
          options?.applyResult ??
          (async (applyInput) => {
            writes.push(applyInput.resultId);
            return {
              operationId: applyInput.operationId,
              status: options?.applyStatus ?? 'succeeded',
            };
          }),
        ...(options?.probeWrite ? { probeWrite: options.probeWrite } : {}),
      },
      {
        parentSessionId: input.parentSessionId,
        result: input.result,
        approvedBy: input.approvedBy,
        idempotencyKey: subagentApplyIdempotencyKey(input.result.resultId),
        requestHash: subagentApplyRequestHash(input.result.resultId, input.result.revision),
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
  const tool = createSubagentResultApplyTool({
    sessionId: SESSION_ID,
    seam: dummySeam(applyReviewed),
    workspacePath: '/tmp/project',
  });
  return { resultService, reviews, writes, tool, applyReviewed };
}

const WORKTREE_LEASE = {
  mode: 'worktree' as const,
  cwd: '/tmp/project/.piwin-worktrees/one',
  parentRepoPath: '/tmp/project',
  worktreePath: '/tmp/project/.piwin-worktrees/one',
  worktreeBranch: 'piwin/subagent/one',
  baseCommit: '0123456789abcdef',
};

async function createHostPairHarness(options?: {
  summaries?: SubagentResultSummary[];
  reviews?: SubagentReviewRecord[];
  integrateWorktree?: () => Promise<{
    success: boolean;
    conflict?: boolean;
    conflictFiles?: string[];
    changedFiles?: string[];
    allowedOutputPaths: string[];
  }>;
}) {
  const dir = await mkdtemp(join(tmpdir(), 'piwin-apply-host-pair-'));
  dirs.push(dir);
  const store = openTurnChangeStore({ rootDir: dir });
  const resultService = createSubagentResultService({ operationStore: store });
  for (const summary of options?.summaries ?? [makeSummary()]) {
    resultService.register(summary);
  }
  const reviews = new Map<string, SubagentReviewRecord>();
  for (const review of options?.reviews ?? [makeReview()]) {
    reviews.set(`${review.reviewId}:${String(review.revision)}`, review);
  }
  let integrateCalls = 0;
  let integrateSettled = createDeferred();
  const coordinator = createSubagentIntegrationCoordinator({
    integrateWorktree: async () => {
      integrateCalls += 1;
      return (
        options?.integrateWorktree?.() ?? {
          success: true,
          changedFiles: ['src/a.ts'],
          allowedOutputPaths: [],
        }
      );
    },
    isBaseClean: async () => true,
    removeWorktree: async () => {},
    applyReservation: store,
  });
  const applyReviewed: NonNullable<SubagentRunSeam['applyReviewed']> = async (input) =>
    applyReviewedSubagentResult(
      {
        resultService,
        loadReview: async (ref) => reviews.get(`${ref.reviewId}:${String(ref.revision)}`),
        applyResult: async (applyInput) => {
          integrateSettled = createDeferred();
          try {
            const integrated = await coordinator.integrate(
              {
                runId: 'run-1',
                taskId: 'task-1',
                executionStatus: 'completed',
                summaryStatus: 'not-requested',
                integrationStatus: 'pending',
                resultRef: { resultId: applyInput.resultId, revision: applyInput.expectedRevision },
                childChanges: CHANGES_V2,
              },
              WORKTREE_LEASE,
              applyInput.signal ? { signal: applyInput.signal } : {},
            );
            return {
              operationId: applyInput.operationId,
              status: applyStatusFromIntegration({
                integrationStatus: integrated.integrationStatus,
              }),
              integrationStatus: integrated.integrationStatus,
            };
          } finally {
            integrateSettled.resolve();
          }
        },
      },
      {
        parentSessionId: input.parentSessionId,
        result: input.result,
        approvedBy: input.approvedBy,
        idempotencyKey: subagentApplyIdempotencyKey(input.result.resultId),
        requestHash: subagentApplyRequestHash(input.result.resultId, input.result.revision),
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );
  const tool = createSubagentResultApplyTool({
    sessionId: SESSION_ID,
    seam: dummySeam(applyReviewed),
    workspacePath: '/tmp/project',
  });
  return {
    tool,
    store,
    resultService,
    applyReviewed,
    get integrateCalls() {
      return integrateCalls;
    },
    get integrateSettled() {
      return integrateSettled.promise;
    },
  };
}

function orchestrationContext(
  resultService: ReturnType<typeof createSubagentResultService>,
  applyResult: SubagentCommandContext['applyResult'],
): SubagentCommandContext {
  return {
    prepareBatch: async (input) => input,
    startBatch: () => ({ runId: 'run-1' }),
    getBatchProjection: async () => ({ runId: 'run-1', status: 'running', results: [] }),
    cancelBatch: async () => {},
    continueChild: async () => ({ runId: 'continuation-run' }),
    actOnWorktree: async () => ({ integrationStatus: 'retained', applyStatus: 'succeeded' }),
    resultService,
    ...(applyResult ? { applyResult } : {}),
  };
}

describe('piwin_subagent_result_apply', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('is a write-capable progress tool', () => {
    const { tool } = createHarness();
    expect(tool.descriptor.name).toBe(SUBAGENT_RESULT_APPLY_TOOL_NAME);
    expect(tool.permissionSpec.action).toBe('file-write');
    expect(tool.permissionSpec.readOnly).not.toBe(true);
    expect(tool.fileEffect).toEqual({ kind: 'uncontained' });
    expect(tool.permissionSpec.subjectBuilder?.({}, {
      sessionId: SESSION_ID,
      runtimeGenerationId: 'g',
      runId: 'r',
      toolName: SUBAGENT_RESULT_APPLY_TOOL_NAME,
    })).toEqual({ kind: 'file-write', path: '/tmp/project' });
  });

  it('1. approved current head applies once', async () => {
    const { tool, writes, resultService } = createHarness();
    const first = await executeTool(tool, { result: RESULT_V2, approvedBy: APPROVED_BY });
    const second = await executeTool(tool, { result: RESULT_V2, approvedBy: APPROVED_BY });
    expect(first).toMatchObject({
      ok: true,
      details: {
        operationId: expect.any(String),
        result: RESULT_V2,
        appliedChanges: CHANGES_V2,
        integrationStatus: 'applied',
      },
    });
    expect(second).toMatchObject({ ok: false, code: 'already-applied' });
    expect(writes).toEqual(['result-v2']);
    expect(resultService.get('result-v2')?.appliedChanges).toEqual(CHANGES_V2);
  });

  it('approved current head applies once through the real reservation + coordinator hash', async () => {
    const harness = await createHostPairHarness();
    const first = await executeTool(harness.tool, { result: RESULT_V2, approvedBy: APPROVED_BY });
    const second = await executeTool(harness.tool, { result: RESULT_V2, approvedBy: APPROVED_BY });
    expect(first).toMatchObject({
      ok: true,
      details: {
        operationId: expect.any(String),
        result: RESULT_V2,
        appliedChanges: CHANGES_V2,
        integrationStatus: 'applied',
      },
    });
    expect(second).toMatchObject({
      ok: true,
      details: {
        result: RESULT_V2,
        appliedChanges: CHANGES_V2,
        integrationStatus: 'applied',
      },
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.details.operationId).toBe(first.details.operationId);
    }
    expect(harness.integrateCalls).toBe(1);
    expect(harness.store.getSubagentApplyReservation({ resultId: 'result-v2' })?.status).toBe(
      'succeeded',
    );
    expect(harness.resultService.get('result-v2')?.appliedChanges).toEqual(CHANGES_V2);
    harness.store.close();
  });

  it('2. v1 approval cannot apply v2; v1 cannot apply after v2 exists', async () => {
    const v1Approved = { reviewId: 'rev-v1', revision: 1 };
    const { tool, writes } = createHarness({
      summaries: [
        makeSummary({
          resultId: 'result-v1',
          candidateGeneration: 1,
          predecessorResult: null,
          latestReview: v1Approved,
          reviewStatus: 'stale',
          childChanges: CHANGES_V1,
        }),
        makeSummary(),
      ],
      reviews: [
        makeReview({
          reviewId: v1Approved.reviewId,
          targetResult: RESULT_V1,
          targetChanges: CHANGES_V1,
        }),
        makeReview(),
      ],
    });
    expect(
      await executeTool(tool, { result: RESULT_V2, approvedBy: v1Approved }),
    ).toMatchObject({ ok: false, code: 'stale-review' });
    expect(
      await executeTool(tool, { result: RESULT_V1, approvedBy: v1Approved }),
    ).toMatchObject({ ok: false, code: 'candidate-superseded' });
    expect(writes).toEqual([]);
  });

  it('3. missing / blocked / changes-requested review cannot apply', async () => {
    const blocked = { reviewId: 'rev-block', revision: 1 };
    const requested = { reviewId: 'rev-cr', revision: 1 };
    const missingHarness = createHarness({
      summaries: [makeSummary({ latestReview: null, reviewStatus: 'not-requested' })],
      reviews: [],
    });
    expect(
      await executeTool(missingHarness.tool, { result: RESULT_V2, approvedBy: APPROVED_BY }),
    ).toMatchObject({ ok: false, code: 'review-missing' });

    const blockedHarness = createHarness({
      summaries: [makeSummary({ latestReview: blocked, reviewStatus: 'blocked' })],
      reviews: [makeReview({ reviewId: blocked.reviewId, decision: 'blocked' })],
    });
    expect(
      await executeTool(blockedHarness.tool, { result: RESULT_V2, approvedBy: blocked }),
    ).toMatchObject({ ok: false, code: 'result-not-approved' });

    const crHarness = createHarness({
      summaries: [makeSummary({ latestReview: requested, reviewStatus: 'changes-requested' })],
      reviews: [
        makeReview({
          reviewId: requested.reviewId,
          decision: 'changes-requested',
          findings: [{ id: 'f1', severity: 'high', title: 'Fix', detail: 'Repair this' }],
        }),
      ],
    });
    expect(
      await executeTool(crHarness.tool, { result: RESULT_V2, approvedBy: requested }),
    ).toMatchObject({ ok: false, code: 'result-not-approved' });
    expect(missingHarness.writes).toEqual([]);
    expect(blockedHarness.writes).toEqual([]);
    expect(crHarness.writes).toEqual([]);
  });

  it('4. permission denial and workspace busy perform zero writes', async () => {
    const denied = createHarness({
      probeWrite: async () => ({ ok: false, code: 'permission-denied' }),
    });
    const busy = createHarness({
      probeWrite: async () => ({ ok: false, code: 'workspace-busy' }),
    });
    expect(
      await executeTool(denied.tool, { result: RESULT_V2, approvedBy: APPROVED_BY }),
    ).toMatchObject({ ok: false, code: 'permission-denied' });
    expect(
      await executeTool(busy.tool, { result: RESULT_V2, approvedBy: APPROVED_BY }),
    ).toMatchObject({ ok: false, code: 'workspace-busy' });
    expect(denied.writes).toEqual([]);
    expect(busy.writes).toEqual([]);
    expect(denied.resultService.get('result-v2')?.integrationStatus).toBe('retained');
    expect(busy.resultService.get('result-v2')?.integrationStatus).toBe('retained');
  });

  it('5. conflict retains candidate and produces needs-integration', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-apply-conflict-'));
    dirs.push(dir);
    const store = openTurnChangeStore({ rootDir: dir });
    const resultService = createSubagentResultService({ operationStore: store });
    resultService.register(makeSummary());
    const coordinator = createSubagentIntegrationCoordinator({
      integrateWorktree: async () => ({
        success: false,
        conflict: true,
        conflictFiles: ['src/a.ts'],
        allowedOutputPaths: [],
      }),
      isBaseClean: async () => true,
      removeWorktree: async () => {},
      applyReservation: store,
    });
    const applied = await applyReviewedSubagentResult(
      {
        resultService,
        loadReview: async () => makeReview(),
        applyResult: async (input) => {
          const integrated = await coordinator.integrate(
            {
              runId: 'run-1',
              taskId: 'task-1',
              executionStatus: 'completed',
              summaryStatus: 'not-requested',
              integrationStatus: 'pending',
              resultRef: { resultId: input.resultId, revision: input.expectedRevision },
            },
            {
              mode: 'worktree',
              cwd: '/tmp/project/.piwin-worktrees/one',
              parentRepoPath: '/tmp/project',
              worktreePath: '/tmp/project/.piwin-worktrees/one',
              worktreeBranch: 'piwin/subagent/one',
              baseCommit: '0123456789abcdef',
            },
          );
          return {
            operationId: input.operationId,
            status: applyStatusFromIntegration({
              integrationStatus: integrated.integrationStatus,
            }),
            integrationStatus: integrated.integrationStatus,
          };
        },
      },
      {
        parentSessionId: SESSION_ID,
        result: RESULT_V2,
        approvedBy: APPROVED_BY,
      },
    );
    expect(applied).toMatchObject({ ok: false, code: 'subagent-needs-integration' });
    expect(resultService.get('result-v2')?.integrationStatus).not.toBe('applied');
    expect(store.getSubagentApplyReservation({ resultId: 'result-v2' })?.status).toBe('needs-repair');
    store.close();
  });

  it('6. timeout/retry reconciles one durable operation', async () => {
    const writeStarted = createDeferred();
    const finishWrite = createDeferred();
    const harness = await createHostPairHarness({
      integrateWorktree: async () => {
        writeStarted.resolve();
        await finishWrite.promise;
        return { success: true, changedFiles: ['src/a.ts'], allowedOutputPaths: [] };
      },
    });
    const controller = new AbortController();
    const first = executeTool(
      harness.tool,
      { result: RESULT_V2, approvedBy: APPROVED_BY },
      controller.signal,
    );
    await writeStarted.promise;
    controller.abort();
    expect(await first).toMatchObject({ ok: false, code: 'apply-outcome-unknown' });
    expect(harness.store.getSubagentApplyReservation({ resultId: 'result-v2' })?.status).toBe(
      'applying',
    );
    finishWrite.resolve();
    await harness.integrateSettled;
    expect(harness.store.hasSubagentApplyWriteCompleted(
      harness.store.getSubagentApplyReservation({ resultId: 'result-v2' })?.operationId ?? '',
    )).toBe(true);
    const retry = await executeTool(harness.tool, { result: RESULT_V2, approvedBy: APPROVED_BY });
    expect(retry).toMatchObject({
      ok: true,
      details: {
        result: RESULT_V2,
        appliedChanges: CHANGES_V2,
        integrationStatus: 'applied',
      },
    });
    expect(harness.integrateCalls).toBe(1);
    expect(harness.store.getSubagentApplyReservation({ resultId: 'result-v2' })?.status).toBe(
      'succeeded',
    );
    harness.store.close();
  });

  it('childSessionId-only apply is refused', async () => {
    const resultService = createSubagentResultService();
    resultService.register(makeSummary());
    const writes: string[] = [];
    const response = await handleSubagentCommand(
      { type: 'subagent/worktree-action', childSessionId: 'child-1', action: 'apply' },
      'child-only-apply',
      orchestrationContext(resultService, async (input) => {
        writes.push(input.resultId);
        return { operationId: input.operationId };
      }),
    );
    expect(response).toMatchObject({
      success: false,
      command: 'subagent/worktree-action',
      error: 'upgrade-required',
      problem: { code: 'upgrade-required' },
    });
    expect(writes).toEqual([]);
  });

  it('7. UI apply and model apply share the same service-level invariant checks', async () => {
    const resultService = createSubagentResultService();
    resultService.register(makeSummary({ latestReview: null, reviewStatus: 'not-requested' }));
    const writes: string[] = [];
    const applyResult = async (input: { resultId: string; expectedRevision: number; operationId: string }) => {
      writes.push(input.resultId);
      return { operationId: input.operationId };
    };
    const ui = await handleSubagentCommand(
      {
        type: 'subagent/worktree-action',
        action: 'apply',
        resultId: 'result-v2',
        expectedRevision: 1,
      },
      'ui-apply',
      orchestrationContext(resultService, applyResult),
    );
    const model = await applyReviewedSubagentResult(
      {
        resultService,
        loadReview: async () => makeReview(),
        applyResult,
      },
      { parentSessionId: SESSION_ID, result: RESULT_V2, approvedBy: APPROVED_BY },
    );
    const shared = evaluateReviewedApplyInvariants({
      summary: resultService.get('result-v2'),
      expectedRevision: 1,
      parentSessionId: SESSION_ID,
    });
    expect(shared).toMatchObject({ ok: false, code: 'review-missing' });
    expect(ui).toMatchObject({
      success: false,
      command: 'subagent/worktree-action',
      problem: { code: 'review-missing' },
    });
    expect(model).toMatchObject({ ok: false, code: 'review-missing' });
    expect(writes).toEqual([]);

    resultService.register(makeSummary());
    const approvedShared = evaluateReviewedApplyInvariants({
      summary: resultService.get('result-v2'),
      expectedRevision: 1,
      parentSessionId: SESSION_ID,
      approvedBy: APPROVED_BY,
      review: makeReview(),
    });
    expect(approvedShared.ok).toBe(true);
    const uiOk = await handleSubagentCommand(
      {
        type: 'subagent/worktree-action',
        action: 'apply',
        resultId: 'result-v2',
        expectedRevision: 1,
      },
      'ui-apply-ok',
      orchestrationContext(resultService, applyResult),
    );
    expect(uiOk).toMatchObject({ success: true, data: { action: 'apply', resultId: 'result-v2' } });
    expect(writes).toEqual(['result-v2']);
  });
});
