import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  emptySubagentResultReviewFields,
  type HostPush,
  type SubagentReviewFinding,
  type SubagentResultSummary,
} from '@piwin/contracts';
import { createSubagentRunStore } from '@piwin/session';
import { hydrateSubagentResultService } from './subagent-result-projection.js';
import { createSubagentResultService } from './subagent-result-service.js';
import {
  createSubagentReviewService,
  loadPersistedReviewObservation,
  reviewAuthorizesApply,
} from './subagent-review-service.js';

const dirs: string[] = [];
const TARGET = { resultId: 'result-1', revision: 1 };
const CHANGES = { changeSetId: 'cs-child', revision: 1 };
const SCOPE = { result: TARGET, changes: CHANGES };

function finding(overrides: Partial<SubagentReviewFinding> = {}): SubagentReviewFinding {
  return {
    id: 'f1',
    severity: 'medium',
    title: 'Scope',
    detail: 'Change stays in the declared files',
    ...overrides,
  };
}

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
    candidateLineageId: 'lineage-1',
    candidateGeneration: 1,
    executionStatus: 'completed',
    summaryStatus: 'merged',
    integrationStatus: 'retained',
    childChanges: CHANGES,
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

async function setupReviewer(options?: {
  createId?: () => string;
  summary?: Partial<SubagentResultSummary>;
}) {
  const dir = await mkdtemp(join(tmpdir(), 'piwin-review-service-'));
  dirs.push(dir);
  const store = createSubagentRunStore({ runsDir: dir });
  const resultService = createSubagentResultService();
  resultService.register(makeSummary(options?.summary));
  await store.createManifest('worker-run', {
    parentSessionId: 'parent-1',
    tasks: [
      {
        id: 'worker-task',
        parentSessionId: 'parent-1',
        task: 'implement login',
        deliveryIntent: 'candidate',
        applyPolicy: 'explicit',
        candidateLineageId: 'lineage-1',
        candidateGeneration: 1,
      },
    ],
  });
  await store.recordResult('worker-run', 'worker-task', {
    runId: 'worker-run',
    taskId: 'worker-task',
    childSessionId: 'worker-child',
    executionStatus: 'completed',
    summaryStatus: 'merged',
    integrationStatus: 'retained',
    resultRef: TARGET,
    childChanges: CHANGES,
    deliveryIntent: 'candidate',
    applyPolicy: 'explicit',
    candidateLineageId: 'lineage-1',
    candidateGeneration: 1,
  });
  await store.createManifest('reviewer-run', {
    parentSessionId: 'parent-1',
    tasks: [
      {
        id: 'reviewer-task',
        parentSessionId: 'parent-1',
        invocationId: 'reviewer-inv',
        task: 'review the candidate',
        role: 'reviewer',
        reviewTarget: { result: TARGET, changes: CHANGES },
      },
    ],
  });
  await store.recordInvocation('reviewer-run', {
    id: 'reviewer-inv',
    parentSessionId: 'parent-1',
    runId: 'reviewer-run',
    taskId: 'reviewer-task',
    task: 'review the candidate',
    role: 'reviewer',
    childSessionId: 'reviewer-child',
    status: 'running',
    activity: { kind: 'thinking' },
    reviewTarget: { result: TARGET, changes: CHANGES },
    revision: 1,
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
  });
  const pushes: HostPush[] = [];
  let ids = 0;
  const service = createSubagentReviewService({
    runStore: store,
    resultService,
    publish: (message) => {
      pushes.push(message);
    },
    now: () => new Date('2026-09-13T01:00:00.000Z'),
    createId: options?.createId ?? (() => `review-${String((ids += 1))}`),
  });
  return { dir, store, resultService, service, pushes };
}

describe('subagent review service', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('approved / changes-requested / blocked validation matrix', async () => {
    const { service } = await setupReviewer();
    const approvedHigh = await service.submit({
      reviewerSessionId: 'reviewer-child',
      invocationId: 'reviewer-inv',
      scope: SCOPE,
      target: TARGET,
      decision: 'approved',
      findings: [finding({ severity: 'high' })],
      verification: [],
    });
    expect(approvedHigh).toMatchObject({ ok: false, code: 'invalid-input' });

    const changesEmpty = await service.submit({
      reviewerSessionId: 'reviewer-child',
      invocationId: 'reviewer-inv',
      scope: SCOPE,
      target: TARGET,
      decision: 'changes-requested',
      findings: [],
      verification: [],
    });
    expect(changesEmpty).toMatchObject({ ok: false, code: 'invalid-input' });

    const blockedEmpty = await service.submit({
      reviewerSessionId: 'reviewer-child',
      invocationId: 'reviewer-inv',
      scope: SCOPE,
      target: TARGET,
      decision: 'blocked',
      findings: [],
      verification: [],
    });
    expect(blockedEmpty).toMatchObject({ ok: false, code: 'invalid-input' });

    const blocked = await service.submit({
      reviewerSessionId: 'reviewer-child',
      invocationId: 'reviewer-inv',
      scope: SCOPE,
      target: TARGET,
      decision: 'blocked',
      findings: [finding({ title: 'Blocked', detail: 'Missing tests' })],
      verification: [{ label: 'tests', status: 'not-run' }],
    });
    expect(blocked).toMatchObject({ ok: true, duplicate: false });
    if (!blocked.ok) throw new Error('expected blocked review');
    expect(blocked.record.decision).toBe('blocked');
  });

  it('successful submit survives restart and wait returns the same review ref', async () => {
    const { dir, service, resultService, pushes } = await setupReviewer();
    const submitted = await service.submit({
      reviewerSessionId: 'reviewer-child',
      invocationId: 'reviewer-inv',
      scope: SCOPE,
      target: TARGET,
      decision: 'approved',
      findings: [],
      verification: [{ label: 'typecheck', status: 'passed' }],
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) throw new Error('expected submit');
    expect(resultService.get('result-1')?.latestReview).toEqual({
      reviewId: submitted.record.reviewId,
      revision: 1,
    });
    expect(resultService.get('result-1')?.reviewStatus).toBe('approved');
    expect(pushes.some((push) => push.type === 'subagent/result-updated')).toBe(true);
    expect(pushes.some((push) => push.type === 'subagent/invocation-updated')).toBe(true);

    const restartedStore = createSubagentRunStore({ runsDir: dir });
    const restartedResults = createSubagentResultService();
    hydrateSubagentResultService(restartedResults, await restartedStore.listManifests());
    const observed = await loadPersistedReviewObservation(restartedStore, 'reviewer-run');
    expect(observed).toEqual({
      reviewRef: { reviewId: submitted.record.reviewId, revision: 1 },
      reviewDecision: 'approved',
    });
    expect(restartedResults.get('result-1')?.latestReview).toEqual(observed?.reviewRef);
    expect(restartedResults.get('result-1')?.reviewStatus).toBe('approved');
  });

  it('reviewer completion without submit cannot authorize apply', async () => {
    const { store, resultService } = await setupReviewer();
    await store.recordResult('reviewer-run', 'reviewer-task', {
      runId: 'reviewer-run',
      taskId: 'reviewer-task',
      childSessionId: 'reviewer-child',
      executionStatus: 'completed',
      summaryStatus: 'merged',
      integrationStatus: 'not-requested',
    });
    await store.setStatus('reviewer-run', 'completed');
    expect(await loadPersistedReviewObservation(store, 'reviewer-run')).toBeUndefined();
    const summary = resultService.get('result-1');
    if (!summary) throw new Error('expected worker result');
    expect(summary.latestReview).toBeNull();
    expect(summary.reviewStatus).toBe('not-requested');
    expect(reviewAuthorizesApply(summary)).toBe(false);
    expect(summary.availability.apply.allowed).toBe(true);
  });

  it('a decision for an unscoped/stale result is rejected', async () => {
    const { service, resultService } = await setupReviewer();
    const foreign = await service.submit({
      reviewerSessionId: 'reviewer-child',
      invocationId: 'reviewer-inv',
      scope: SCOPE,
      target: { resultId: 'result-other', revision: 1 },
      decision: 'approved',
      findings: [],
      verification: [],
    });
    expect(foreign).toMatchObject({ ok: false, code: 'review-target-forbidden' });

    resultService.register(makeSummary({ revision: 2 }));
    const stale = await service.submit({
      reviewerSessionId: 'reviewer-child',
      invocationId: 'reviewer-inv',
      scope: SCOPE,
      target: TARGET,
      decision: 'approved',
      findings: [],
      verification: [],
    });
    expect(stale).toMatchObject({ ok: false, code: 'stale-revision' });
  });

  it('one reviewer Run cannot submit two different decisions', async () => {
    const { service } = await setupReviewer();
    const first = await service.submit({
      reviewerSessionId: 'reviewer-child',
      invocationId: 'reviewer-inv',
      scope: SCOPE,
      target: TARGET,
      decision: 'approved',
      findings: [],
      verification: [],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('expected first submit');
    const retry = await service.submit({
      reviewerSessionId: 'reviewer-child',
      invocationId: 'reviewer-inv',
      scope: SCOPE,
      target: TARGET,
      decision: 'approved',
      findings: [],
      verification: [],
    });
    expect(retry).toMatchObject({ ok: true, duplicate: true });
    if (!retry.ok) throw new Error('expected identical retry');
    expect(retry.record.reviewId).toBe(first.record.reviewId);

    const conflict = await service.submit({
      reviewerSessionId: 'reviewer-child',
      invocationId: 'reviewer-inv',
      scope: SCOPE,
      target: TARGET,
      decision: 'changes-requested',
      findings: [finding()],
      verification: [],
    });
    expect(conflict).toMatchObject({ ok: false, code: 'invalid-input' });
  });
});
