import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  HostToolRegistration,
  SubagentBatchRequest,
  SubagentResultSummary,
  SubagentReviewRecord,
  SubagentReviewRef,
  SubagentTaskResult,
  SubagentWorkspaceLease,
  ToolResult,
} from '@piwin/contracts';
import { emptySubagentResultReviewFields } from '@piwin/contracts';
import { createSessionRecord, upsertSessionRecord } from '@piwin/session';
import { RunRegistry } from './run-registry.js';
import { TurnScopedSchemeAdmissionGate } from './orchestration-scheme-admission.js';
import { createSubagentControlSeam } from './host-runtime-subagent-start.js';
import {
  buildShellContinuationTask,
  continueSubagentChild,
  prepareRetainedSubagentContinuation,
} from './host-runtime-subagent-tasks.js';
import { getPiwinSessionIndexPath } from './paths.js';
import { createSubagentResultService } from './subagent-result-service.js';
import {
  PIWIN_CONTINUE_FINDINGS_MARKER,
  SUBAGENT_CONTINUE_TOOL_NAME,
  createReviewedContinueGate,
} from './subagent-continue.js';
import { startReviewedContinuation } from './subagent-continue.js';
import { createSubagentContinueTool } from './subagent-continue-tool.js';
import { SubagentOrchestrator } from './subagent-orchestrator.js';

const SESSION_ID = 'parent-1';
const CHILD_ID = 'child-1';
const PARENT_RUN_ID = 'run-1';
const WORKTREE_LEASE: Extract<SubagentWorkspaceLease, { mode: 'worktree' }> = {
  mode: 'worktree',
  cwd: '/tmp/child-worktree',
  parentRepoPath: '/tmp/project',
  worktreePath: '/tmp/child-worktree',
  worktreeBranch: 'piwin/child-1',
  baseCommit: 'base',
};

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
    resultId: 'result-v1',
    revision: 1,
    parentSessionId: SESSION_ID,
    childSessionId: CHILD_ID,
    taskId: 'task-1',
    batchRunId: 'run-worker',
    sourceAttemptId: null,
    targetWorkspaceId: 'ws-1',
    deliveryIntent: 'candidate',
    legacyManual: false,
    candidateGroupId: null,
    ...emptySubagentResultReviewFields(),
    candidateLineageId: 'lineage-login',
    candidateGeneration: 1,
    latestReview: { reviewId: 'review-v1', revision: 1 },
    reviewStatus: 'changes-requested',
    executionStatus: 'completed',
    summaryStatus: 'merged',
    integrationStatus: 'retained',
    childChanges: { changeSetId: 'cs-v1', revision: 1 },
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
    reviewId: 'review-v1',
    revision: 1,
    parentSessionId: SESSION_ID,
    reviewerSessionId: 'reviewer-1',
    reviewerRunId: 'run-reviewer',
    targetResult: { resultId: 'result-v1', revision: 1 },
    targetChanges: { changeSetId: 'cs-v1', revision: 1 },
    decision: 'changes-requested',
    findings: [
      {
        id: 'f-1',
        severity: 'high',
        title: 'Missing auth check',
        detail: 'Login route skips the session guard.',
      },
    ],
    verification: [],
    createdAt: '2026-09-13T01:00:00.000Z',
    ...overrides,
  };
}

function continueArgs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    childSessionId: CHILD_ID,
    expectedResult: { resultId: 'result-v1', revision: 1 },
    review: { reviewId: 'review-v1', revision: 1 },
    task: 'Repair the login guard.',
    ...overrides,
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
    runId: PARENT_RUN_ID,
    toolName: tool.descriptor.name,
  });
}

function createHarness(options?: {
  summaries?: SubagentResultSummary[];
  reviews?: SubagentReviewRecord[];
  maxTasksPerRun?: number;
  maxConcurrency?: number;
  holdRunner?: boolean;
  persistFrozenResults?: boolean;
  abortDuringPrepare?: AbortController;
  closeAdmissionDuringPrepare?: boolean;
}) {
  const batches: SubagentBatchRequest[] = [];
  const acquireCalls: string[] = [];
  const resultService = createSubagentResultService();
  for (const summary of options?.summaries ?? [makeSummary()]) {
    resultService.register(summary);
  }
  const reviews = new Map<string, SubagentReviewRecord>();
  for (const review of options?.reviews ?? [makeReview()]) {
    reviews.set(`${review.reviewId}:${String(review.revision)}`, review);
  }
  const runnerHold = createDeferred<void>();
  const runRegistry = new RunRegistry({
    createId: (() => {
      let issuedParent = false;
      return () => {
        if (!issuedParent) {
          issuedParent = true;
          return PARENT_RUN_ID;
        }
        return randomUUID();
      };
    })(),
  });
  const parentRun = runRegistry.create({
    kind: 'session-turn',
    sessionId: SESSION_ID,
    runtimeGenerationId: 'generation-1',
  });
  runRegistry.start(parentRun.runId);
  const orchestrator = new SubagentOrchestrator({
    taskRunner: {
      capabilities: { processIsolation: true },
      async runTask() {
        if (options?.holdRunner) await runnerHold.promise;
        return {
          executionStatus: 'completed',
          summaryStatus: 'not-requested',
          integrationStatus: 'not-requested',
          childSessionId: CHILD_ID,
        };
      },
    },
    workspaceService: {
      async acquire(task) {
        return task.continuationWorkspaceLease ?? {
          mode: 'readonly',
          cwd: '/tmp/readonly',
          parentRepoPath: '/tmp/project',
        };
      },
      async release() {},
    },
    prepareTask: async (input) => ({
      runtimeSnapshot: {
        isolation: input.workspaceLease.mode,
        workingDirectory: input.workspaceLease.cwd,
        model: { providerId: 'test', modelId: 'worker' },
        profileId: 'implementer',
      },
      sessionBlueprint: {
        version: 1,
        sessionId: input.childSessionId,
        runtimeGenerationId: input.runtimeGenerationId,
        capabilitySnapshot: {
          version: 1,
          snapshotId: 'snap',
          inputs: {
            rulesRevision: 'r',
            settingsRevision: 's',
            projectRevision: 'p',
            mcpRevision: 'm',
            resourceCatalogRevision: 'c',
          },
          scope: { kind: 'general' },
          workingDirectory: input.workspaceLease.cwd,
          trust: { kind: 'general' },
          resources: {
            skills: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
            extensions: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
            prompts: { disabledIds: [], allowedSources: ['user'], allowlistedIds: null },
          },
          resourceManifest: { skills: [], extensions: [], prompts: [], diagnostics: [] },
          context: {
            allowPiNativeInstructions: true,
            allowProjectAgentsFiles: false,
            allowProjectSystemPrompts: false,
          },
          contextManifest: { agentsFiles: [] },
          tools: { hostTools: [], piBuiltinToolNames: [], enabledMcpServerIds: [], enabledFamilies: [] },
        },
      },
      preparedPrompt: { text: input.task.task, runId: input.taskRunId },
      providers: [],
    }),
    runRegistry,
    integrationCoordinator: {
      async integrate(result: SubagentTaskResult) {
        return { ...result, integrationStatus: 'applied' };
      },
      async retain() {},
      async isBaseClean() {
        return true;
      },
      async dispose() {},
    },
    freezeChildResult: async ({ result }) => {
      const resultRef = { resultId: `result-${result.taskId}`, revision: 1 };
      const childChanges = { changeSetId: `cs-${result.taskId}`, revision: 1 };
      if (options?.persistFrozenResults) {
        resultService.register(
          makeSummary({
            resultId: resultRef.resultId,
            revision: resultRef.revision,
            taskId: result.taskId,
            batchRunId: result.runId ?? 'run-repair',
            childSessionId: result.childSessionId ?? CHILD_ID,
            candidateLineageId: result.candidateLineageId ?? 'lineage-login',
            candidateGeneration: result.candidateGeneration ?? 2,
            predecessorResult: result.predecessorResult ?? {
              resultId: 'result-v1',
              revision: 1,
            },
            latestReview: { reviewId: `review-${resultRef.resultId}`, revision: 1 },
            reviewStatus: 'not-requested',
            childChanges,
          }),
        );
      }
      return { ...result, resultRef, childChanges };
    },
    push: () => {},
    getRuntimeGenerationId: () => 'generation-1',
  });
  const startBatch = orchestrator.startBatch.bind(orchestrator);
  orchestrator.startBatch = (request, parentRunId) => {
    batches.push(request);
    return startBatch(request, parentRunId);
  };
  const schemeAdmissionGate = new TurnScopedSchemeAdmissionGate();
  schemeAdmissionGate.bind(parentRun.runId, {
    maxConcurrency: options?.maxConcurrency ?? 8,
    maxTasksPerRun: options?.maxTasksPerRun ?? 8,
  });
  const acquire = schemeAdmissionGate.acquire.bind(schemeAdmissionGate);
  schemeAdmissionGate.acquire = async (parentRunId, signal) => {
    acquireCalls.push(parentRunId ?? '');
    return acquire(parentRunId, signal);
  };
  const controlDeps = {
    orchestrator,
    schemeAdmissionGate,
    runRegistry,
    getParentRunId: () => parentRun.runId,
    getDelegationMode: () => 'auto' as const,
    getActiveScheme: () => undefined,
    prepareBatch: async (request: SubagentBatchRequest) => request,
    whenReady: async () => {},
    taskResults: new Map(),
    merge: async () => ({}),
  };
  const continuePorts = {
    prepareContinuation: async () => {
      if (options?.abortDuringPrepare) {
        queueMicrotask(() => {
          options.abortDuringPrepare?.abort();
          if (options.closeAdmissionDuringPrepare) {
            runRegistry.requestCancel(parentRun.runId);
          }
        });
      }
      return {
        child: createSessionRecord({
          id: CHILD_ID,
          projectPath: '/tmp/project',
          parentSessionId: SESSION_ID,
          kind: 'subagent',
          name: 'login worker',
          subagentStatus: 'done',
          subagentMode: 'worktree',
          subagentApplyPolicy: 'auto',
          subagentRole: 'worker',
          worktreePath: WORKTREE_LEASE.worktreePath,
          subagentRuntime: {
            isolation: 'worktree',
            workingDirectory: WORKTREE_LEASE.cwd,
            profileId: 'implementer',
            model: { providerId: 'test', modelId: 'worker' },
          },
          subagentLifecycle: {
            executionStatus: 'completed',
            summaryStatus: 'merged',
            integrationStatus: 'retained',
          },
        }),
        parent: createSessionRecord({
          id: SESSION_ID,
          projectPath: '/tmp/project',
          kind: 'main',
        }),
        runtime: {
          isolation: 'worktree' as const,
          workingDirectory: WORKTREE_LEASE.cwd,
          profileId: 'implementer',
          model: { providerId: 'test', modelId: 'worker' },
        },
        mode: 'worktree' as const,
        continuationWorkspaceLease: WORKTREE_LEASE,
      };
    },
    getResult: (resultId: string) => resultService.get(resultId),
    listResults: (parentSessionId: string) => resultService.list({ parentSessionId }).items,
    loadReview: async (ref: SubagentReviewRef) =>
      reviews.get(`${ref.reviewId}:${String(ref.revision)}`),
    isAdmissionClosed: (runId: string) => runRegistry.isAdmissionClosed(runId),
    continueGate: createReviewedContinueGate(),
  };
  const baseSeam = createSubagentControlSeam(controlDeps, SESSION_ID);
  const seam = {
    ...baseSeam,
    continueReviewed: (input: {
      parentSessionId: string;
      invocationId: string;
      parentRunId: string;
      parentToolCallId?: string;
      childSessionId: string;
      expectedResult: { resultId: string; revision: number };
      review: SubagentReviewRef;
      task: string;
      signal?: AbortSignal;
    }) => startReviewedContinuation({ ...controlDeps, ...continuePorts }, SESSION_ID, input),
  };
  return {
    batches,
    acquireCalls,
    resultService,
    reviews,
    runnerHold,
    runRegistry,
    parentRunId: parentRun.runId,
    continueTool: createSubagentContinueTool({ sessionId: SESSION_ID, seam }),
    async continueAndJoin(args: Record<string, unknown> = {}) {
      const started = await executeTool(this.continueTool, continueArgs(args));
      if (!started.ok) return { started, result: undefined };
      const runId = String(started.details?.runId ?? '');
      const completion = await orchestrator.joinBatch(runId);
      return { started, result: completion.results[0] };
    },
  };
}

describe('piwin_subagent_continue', () => {
  it('continues the same child/worktree on changes-requested and freezes v2', async () => {
    const harness = createHarness();
    const { started, result } = await harness.continueAndJoin();
    expect(started.ok).toBe(true);
    expect(started.ok && started.details).toMatchObject({
      status: 'accepted',
      childSessionId: CHILD_ID,
      predecessorResult: { resultId: 'result-v1', revision: 1 },
      reviewRef: { reviewId: 'review-v1', revision: 1 },
    });
    expect(started.ok && started.details?.runId).not.toBe(PARENT_RUN_ID);
    const task = harness.batches[0]?.tasks[0];
    expect(task?.continuationSessionId).toBe(CHILD_ID);
    expect(task?.continuationWorkspaceLease).toEqual(WORKTREE_LEASE);
    expect(task?.model).toEqual({ providerId: 'test', modelId: 'worker' });
    expect(task?.profileId).toBe('implementer');
    expect(task?.task).toContain(PIWIN_CONTINUE_FINDINGS_MARKER);
    expect(task?.task).toContain('Missing auth check');
    expect(task?.task).toContain('Repair the login guard.');
    expect(task?.predecessorResult).toEqual({ resultId: 'result-v1', revision: 1 });
    expect(task?.candidateLineageId).toBe('lineage-login');
    expect(task?.candidateGeneration).toBe(2);
    expect(task?.applyPolicy).toBe('explicit');
    expect(result?.childSessionId).toBe(CHILD_ID);
    expect(result?.candidateGeneration).toBe(2);
    expect(result?.predecessorResult).toEqual({ resultId: 'result-v1', revision: 1 });
    expect(result?.resultRef?.resultId).not.toBe('result-v1');
  });

  it('rejects approved, blocked, and missing reviews', async () => {
    const approved = createHarness({
      summaries: [makeSummary({ reviewStatus: 'approved', latestReview: { reviewId: 'rev-ok', revision: 1 } })],
      reviews: [makeReview({ reviewId: 'rev-ok', decision: 'approved', findings: [] })],
    });
    expect(
      await executeTool(
        approved.continueTool,
        continueArgs({ review: { reviewId: 'rev-ok', revision: 1 } }),
      ),
    ).toMatchObject({ ok: false, code: 'stale-review' });
    expect(approved.acquireCalls).toEqual([]);

    const blocked = createHarness({
      summaries: [makeSummary({ reviewStatus: 'blocked', latestReview: { reviewId: 'rev-block', revision: 1 } })],
      reviews: [makeReview({ reviewId: 'rev-block', decision: 'blocked' })],
    });
    expect(
      await executeTool(
        blocked.continueTool,
        continueArgs({ review: { reviewId: 'rev-block', revision: 1 } }),
      ),
    ).toMatchObject({ ok: false, code: 'stale-review' });

    const missing = createHarness({ reviews: [] });
    expect(await executeTool(missing.continueTool, continueArgs())).toMatchObject({
      ok: false,
      code: 'review-missing',
    });
    expect(missing.acquireCalls).toEqual([]);
  });

  it('rejects an older changes-requested review after latestReview is approved or blocked', async () => {
    const approved = createHarness({
      summaries: [
        makeSummary({
          reviewStatus: 'approved',
          latestReview: { reviewId: 'rev-ok', revision: 1 },
        }),
      ],
      reviews: [
        makeReview(),
        makeReview({ reviewId: 'rev-ok', decision: 'approved', findings: [] }),
      ],
    });
    expect(await executeTool(approved.continueTool, continueArgs())).toMatchObject({
      ok: false,
      code: 'stale-review',
    });
    expect(approved.acquireCalls).toEqual([]);
    expect(approved.batches).toEqual([]);

    const blocked = createHarness({
      summaries: [
        makeSummary({
          reviewStatus: 'blocked',
          latestReview: { reviewId: 'rev-block', revision: 1 },
        }),
      ],
      reviews: [
        makeReview(),
        makeReview({ reviewId: 'rev-block', decision: 'blocked' }),
      ],
    });
    expect(await executeTool(blocked.continueTool, continueArgs())).toMatchObject({
      ok: false,
      code: 'stale-review',
    });
    expect(blocked.acquireCalls).toEqual([]);
    expect(blocked.batches).toEqual([]);
  });

  it('rejects a stale v1 request after v2 before batch admission', async () => {
    const harness = createHarness({
      summaries: [
        makeSummary(),
        makeSummary({
          resultId: 'result-v2',
          taskId: 'task-2',
          batchRunId: 'run-repair-1',
          candidateGeneration: 2,
          predecessorResult: { resultId: 'result-v1', revision: 1 },
          latestReview: { reviewId: 'review-v2', revision: 1 },
          childChanges: { changeSetId: 'cs-v2', revision: 1 },
        }),
      ],
    });
    expect(harness.resultService.get('result-v1')?.reviewStatus).toBe('stale');
    expect(await executeTool(harness.continueTool, continueArgs())).toMatchObject({
      ok: false,
      code: 'candidate-superseded',
    });
    expect(harness.acquireCalls).toEqual([]);
    expect(harness.batches).toEqual([]);
  });

  it('allows two repairs and returns repair-limit-reached on the third', async () => {
    const harness = createHarness();
    const first = await harness.continueAndJoin();
    expect(first.started.ok).toBe(true);
    expect(first.result?.candidateGeneration).toBe(2);
    const v2Ref = first.result?.resultRef;
    if (!v2Ref) throw new Error('expected v2 result');
    harness.resultService.register(
      makeSummary({
        resultId: v2Ref.resultId,
        revision: v2Ref.revision,
        taskId: first.result?.taskId ?? 'task-2',
        batchRunId: first.result?.runId ?? 'run-2',
        candidateGeneration: 2,
        predecessorResult: { resultId: 'result-v1', revision: 1 },
        latestReview: { reviewId: 'review-v2', revision: 1 },
        childChanges: first.result?.childChanges ?? { changeSetId: 'cs-v2', revision: 1 },
      }),
    );
    harness.reviews.set('review-v2:1', makeReview({
      reviewId: 'review-v2',
      targetResult: v2Ref,
      targetChanges: first.result?.childChanges ?? { changeSetId: 'cs-v2', revision: 1 },
    }));

    const second = await harness.continueAndJoin({
      expectedResult: v2Ref,
      review: { reviewId: 'review-v2', revision: 1 },
    });
    expect(second.started.ok).toBe(true);
    expect(second.result?.candidateGeneration).toBe(3);
    const v3Ref = second.result?.resultRef;
    if (!v3Ref) throw new Error('expected v3 result');
    harness.resultService.register(
      makeSummary({
        resultId: v3Ref.resultId,
        revision: v3Ref.revision,
        taskId: second.result?.taskId ?? 'task-3',
        batchRunId: second.result?.runId ?? 'run-3',
        candidateGeneration: 3,
        predecessorResult: v2Ref,
        latestReview: { reviewId: 'review-v3', revision: 1 },
        childChanges: second.result?.childChanges ?? { changeSetId: 'cs-v3', revision: 1 },
      }),
    );
    harness.reviews.set('review-v3:1', makeReview({
      reviewId: 'review-v3',
      targetResult: v3Ref,
      targetChanges: second.result?.childChanges ?? { changeSetId: 'cs-v3', revision: 1 },
    }));

    expect(
      await executeTool(
        harness.continueTool,
        continueArgs({
          expectedResult: v3Ref,
          review: { reviewId: 'review-v3', revision: 1 },
        }),
      ),
    ).toMatchObject({ ok: false, code: 'repair-limit-reached' });
  });

  it('counts continuations against scheme task and concurrency caps', async () => {
    const tasks = createHarness({ maxTasksPerRun: 1 });
    const first = await tasks.continueAndJoin();
    expect(first.started.ok).toBe(true);
    expect(await executeTool(tasks.continueTool, continueArgs())).toMatchObject({
      ok: false,
      code: 'subagent-failed',
    });
    expect(tasks.acquireCalls).toHaveLength(2);

    const concurrency = createHarness({ maxConcurrency: 1, maxTasksPerRun: 2, holdRunner: true });
    const held = executeTool(concurrency.continueTool, continueArgs());
    await flushUntil(() => concurrency.acquireCalls.length === 1, 'first continuation admitted');
    const waiting = executeTool(concurrency.continueTool, continueArgs());
    await flushUntil(() => concurrency.batches.length === 1, 'second continuation not started');
    expect(concurrency.batches).toHaveLength(1);
    concurrency.runnerHold.resolve();
    expect((await held).ok).toBe(true);
    expect((await waiting).ok).toBe(true);
    expect(concurrency.batches).toHaveLength(2);
  });

  it('does not let two overlapping same-v1 continues both accept as generation 2', async () => {
    const harness = createHarness({
      maxConcurrency: 1,
      maxTasksPerRun: 2,
      holdRunner: true,
      persistFrozenResults: true,
    });
    const first = executeTool(harness.continueTool, continueArgs());
    await flushUntil(() => harness.batches.length === 1, 'first continuation started');
    const firstStarted = await first;
    expect(firstStarted.ok).toBe(true);
    expect(harness.batches[0]?.tasks[0]?.candidateGeneration).toBe(2);

    const second = executeTool(harness.continueTool, continueArgs());
    await flushUntil(() => harness.acquireCalls.length === 2, 'second waiting for admission');
    expect(harness.batches).toHaveLength(1);

    harness.runnerHold.resolve();
    expect(await second).toMatchObject({ ok: false, code: 'candidate-superseded' });
    expect(harness.batches).toHaveLength(1);
  });

  it('rejects a second overlapping same-v1 continue when maxConcurrency is 2', async () => {
    const harness = createHarness({
      maxConcurrency: 2,
      maxTasksPerRun: 2,
      holdRunner: true,
    });
    const first = executeTool(harness.continueTool, continueArgs());
    const second = executeTool(harness.continueTool, continueArgs());
    const settled = await Promise.all([first, second]);
    const accepted = settled.filter((result) => result.ok);
    const rejected = settled.filter((result) => !result.ok);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ ok: false, code: 'candidate-superseded' });
    expect(harness.batches).toHaveLength(1);
    expect(harness.batches[0]?.tasks[0]?.candidateGeneration).toBe(2);
    harness.runnerHold.resolve();
  });

  it('starts no continuation when the parent stops after validation', async () => {
    const abort = new AbortController();
    const harness = createHarness({
      abortDuringPrepare: abort,
      closeAdmissionDuringPrepare: true,
    });
    expect(await executeTool(harness.continueTool, continueArgs(), abort.signal)).toMatchObject({
      ok: false,
      code: 'aborted',
      cancelled: true,
    });
    expect(harness.acquireCalls).toEqual([]);
    expect(harness.batches).toEqual([]);
  });
});

describe('shell subagent/continue compatibility', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('reuses child identity without review, admission, or lineage', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-shell-continue-'));
    dirs.push(rootDir);
    await mkdir(join(rootDir, 'sessions-index'), { recursive: true });
    const indexPath = getPiwinSessionIndexPath(rootDir);
    await upsertSessionRecord(
      indexPath,
      createSessionRecord({
        id: SESSION_ID,
        projectPath: '/tmp/project',
        kind: 'main',
      }),
    );
    const child = createSessionRecord({
      id: CHILD_ID,
      projectPath: '/tmp/project',
      parentSessionId: SESSION_ID,
      kind: 'subagent',
      name: 'login worker',
      subagentStatus: 'done',
      subagentMode: 'worktree',
      worktreePath: WORKTREE_LEASE.worktreePath,
      subagentRuntime: {
        isolation: 'worktree',
        workingDirectory: WORKTREE_LEASE.cwd,
        profileId: 'implementer',
        model: { providerId: 'test', modelId: 'worker' },
      },
      subagentLifecycle: {
        executionStatus: 'completed',
        summaryStatus: 'merged',
        integrationStatus: 'retained',
      },
    });
    await upsertSessionRecord(indexPath, child);
    const prepared = await prepareRetainedSubagentContinuation(
      {
        options: { piwinRoot: rootDir },
        resolveRetainedSubagentWorktreeLease: async () => WORKTREE_LEASE,
      },
      CHILD_ID,
    );
    const task = buildShellContinuationTask(prepared, 'Check the tests');
    expect(task.continuationSessionId).toBe(CHILD_ID);
    expect(task.continuationWorkspaceLease).toEqual(WORKTREE_LEASE);
    expect(task.task).toBe('Check the tests');
    expect(task.task).not.toContain(PIWIN_CONTINUE_FINDINGS_MARKER);
    expect(task.applyPolicy).toBe('none');
    expect(task.predecessorResult).toBeUndefined();
    expect(task.candidateGeneration).toBeUndefined();
    expect(task.reviewRef).toBeUndefined();

    const batches: SubagentBatchRequest[] = [];
    await continueSubagentChild(
      {
        options: { piwinRoot: rootDir },
        resolveRetainedSubagentWorktreeLease: async () => WORKTREE_LEASE,
        push: () => {},
      },
      {
        startBatch: (request: SubagentBatchRequest) => {
          batches.push(request);
          return {
            runId: 'shell-run',
            accepted: Promise.resolve(),
            hasAccepted: () => true,
            completion: Promise.resolve({
              runId: 'shell-run',
              status: 'completed' as const,
              results: [],
            }),
          };
        },
      },
      CHILD_ID,
      'Check the tests',
    );
    expect(batches[0]?.tasks[0]).toMatchObject({
      continuationSessionId: CHILD_ID,
      task: 'Check the tests',
      applyPolicy: 'none',
    });
    expect(batches[0]?.tasks[0]?.predecessorResult).toBeUndefined();
  });
});

describe('continue tool descriptor', () => {
  it('registers the parent-only continue name', () => {
    const tool = createSubagentContinueTool({
      sessionId: SESSION_ID,
      seam: {
        spawn: async () => {
          throw new Error('unused');
        },
        merge: async () => ({}),
      },
    });
    expect(tool.descriptor.name).toBe(SUBAGENT_CONTINUE_TOOL_NAME);
    expect(tool.family).toBe('delegate');
  });
});

async function flushUntil(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error(`timed out waiting for ${label}`);
}
