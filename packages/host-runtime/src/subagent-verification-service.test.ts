import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  emptySubagentResultReviewFields,
  type HostPush,
  type SubagentDeliveryVerification,
  type SubagentResultSummary,
  type SubagentReviewRecord,
} from '@piwin/contracts';
import { createSubagentRunStore } from '@piwin/session';
import { hydrateSubagentResultService } from './subagent-result-projection.js';
import { createSubagentResultService } from './subagent-result-service.js';
import { createSubagentVerificationService } from './subagent-verification-service.js';

const dirs: string[] = [];
const TARGET = { resultId: 'result-1', revision: 1 };
const CHANGES = { changeSetId: 'cs-child', revision: 1 };
const APPROVED_BY = { reviewId: 'review-1', revision: 1 };
const APPLY_OP = 'op-applied';

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
    latestReview: APPROVED_BY,
    reviewStatus: 'approved',
    executionStatus: 'completed',
    summaryStatus: 'merged',
    integrationStatus: 'applied',
    childChanges: CHANGES,
    appliedChanges: CHANGES,
    copyState: 'present',
    latestOperationId: APPLY_OP,
    availability: {
      view: { allowed: true },
      apply: { allowed: false, reason: 'already-applied' },
      resolve: { allowed: false },
      cleanup: { allowed: true },
    },
    ...overrides,
  };
}

function makeReview(overrides: Partial<SubagentReviewRecord> = {}): SubagentReviewRecord {
  return {
    reviewId: APPROVED_BY.reviewId,
    revision: 1,
    parentSessionId: 'parent-1',
    reviewerSessionId: 'reviewer-child',
    reviewerRunId: 'reviewer-run',
    targetResult: TARGET,
    targetChanges: CHANGES,
    decision: 'approved',
    findings: [],
    verification: [{ label: 'reviewer-local', status: 'not-run' }],
    createdAt: '2026-09-13T01:00:00.000Z',
    ...overrides,
  };
}

async function setup(options?: { summary?: Partial<SubagentResultSummary> }) {
  const dir = await mkdtemp(join(tmpdir(), 'piwin-verification-service-'));
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
    integrationStatus: 'applied',
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
  await store.persistReviewerDecision('reviewer-run', 'reviewer-task', makeReview());
  const pushes: HostPush[] = [];
  let ids = 0;
  const service = createSubagentVerificationService({
    runStore: store,
    resultService,
    publish: (message) => {
      pushes.push(message);
    },
    now: () => new Date('2026-09-13T03:00:00.000Z'),
    createId: () => `verify-${String((ids += 1))}`,
  });
  return { dir, store, resultService, service, pushes };
}

function passedInput(overrides: Partial<Parameters<ReturnType<typeof createSubagentVerificationService>['submit']>[0]> = {}) {
  return {
    parentSessionId: 'parent-1',
    parentRunId: 'parent-verify-run',
    result: TARGET,
    approvedBy: APPROVED_BY,
    applyOperationId: APPLY_OP,
    status: 'passed' as const,
    checks: [{ label: 'typecheck', status: 'passed' as const, evidence: 'tsc ok' }],
    ...overrides,
  };
}

describe('subagent verification service', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('1. a passed record requires a successfully applied exact result', async () => {
    const retained = await setup({
      summary: {
        integrationStatus: 'retained',
        appliedChanges: null,
        latestOperationId: null,
        availability: {
          view: { allowed: true },
          apply: { allowed: true },
          resolve: { allowed: true },
          cleanup: { allowed: true },
        },
      },
    });
    expect(await retained.service.submit(passedInput())).toMatchObject({
      ok: false,
      code: 'invalid-input',
    });

    const { service, resultService, pushes } = await setup();
    const submitted = await service.submit(passedInput());
    expect(submitted).toMatchObject({ ok: true, duplicate: false });
    if (!submitted.ok) throw new Error('expected passed verification');
    expect(submitted.record.appliedChanges).toEqual(CHANGES);
    expect(submitted.record.parentRunId).toBe('parent-verify-run');
    expect(resultService.get('result-1')?.latestVerification).toEqual({
      verificationId: submitted.record.verificationId,
      revision: 1,
    });
    expect(resultService.get('result-1')?.integrationStatus).toBe('applied');
    expect(pushes.some((push) => push.type === 'subagent/result-updated')).toBe(true);
  });

  it('2. stale review, foreign operation, wrong parent session, or no applied changes is rejected', async () => {
    const { service, resultService } = await setup();
    expect(
      await service.submit(passedInput({ approvedBy: { reviewId: 'review-old', revision: 1 } })),
    ).toMatchObject({ ok: false, code: 'stale-review' });
    expect(
      await service.submit(passedInput({ applyOperationId: 'op-other' })),
    ).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(
      await service.submit(passedInput({ parentSessionId: 'reviewer-child' })),
    ).toMatchObject({ ok: false, code: 'review-target-forbidden' });
    expect(
      await service.submit(passedInput({ parentSessionId: 'worker-child' })),
    ).toMatchObject({ ok: false, code: 'review-target-forbidden' });

    resultService.register(makeSummary({ appliedChanges: null }));
    expect(await service.submit(passedInput())).toMatchObject({
      ok: false,
      code: 'review-data-expired',
    });
    expect(resultService.get('result-1')?.integrationStatus).toBe('applied');
  });

  it('3. passed/failed check consistency is validated and bounded', async () => {
    const { service } = await setup();
    expect(
      await service.submit(passedInput({ checks: [] })),
    ).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(
      await service.submit(
        passedInput({
          checks: [{ label: 'typecheck', status: 'failed', evidence: 'boom' }],
        }),
      ),
    ).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(
      await service.submit({
        ...passedInput(),
        status: 'failed',
        checks: [{ label: 'typecheck', status: 'passed', evidence: 'ok' }],
      }),
    ).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(
      await service.submit(
        passedInput({
          checks: Array.from({ length: 21 }, (_, index) => ({
            label: `check-${String(index)}`,
            status: 'passed' as const,
            evidence: 'ok',
          })),
        }),
      ),
    ).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(
      await service.submit(
        passedInput({
          checks: [{ label: 'typecheck', status: 'passed', evidence: 'e'.repeat(2001) }],
        }),
      ),
    ).toMatchObject({ ok: false, code: 'invalid-input' });
  });

  it('4. identical retry returns the same ref; conflicting retry is rejected', async () => {
    const { service } = await setup();
    const first = await service.submit(passedInput());
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('expected first submit');
    const retry = await service.submit(
      passedInput({ parentRunId: 'later-parent-run' }),
    );
    expect(retry).toMatchObject({ ok: true, duplicate: true });
    if (!retry.ok) throw new Error('expected identical retry');
    expect(retry.record.verificationId).toBe(first.record.verificationId);
    expect(retry.record.parentRunId).toBe('parent-verify-run');

    const conflict = await service.submit({
      ...passedInput(),
      status: 'failed',
      checks: [{ label: 'typecheck', status: 'failed', evidence: 'boom' }],
    });
    expect(conflict).toMatchObject({ ok: false, code: 'invalid-input' });
  });

  it('5. verification status survives restart and failed verify stays applied', async () => {
    const { dir, service, resultService, store } = await setup();
    const failed: SubagentDeliveryVerification['checks'] = [
      { label: 'typecheck', status: 'failed', evidence: 'tsc failed' },
    ];
    const submitted = await service.submit({
      ...passedInput(),
      status: 'failed',
      checks: failed,
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) throw new Error('expected failed verification');
    expect(resultService.get('result-1')?.integrationStatus).toBe('applied');
    expect(resultService.get('result-1')?.latestVerification).toEqual({
      verificationId: submitted.record.verificationId,
      revision: 1,
    });
    const worker = await store.loadManifest('worker-run');
    expect(worker?.results['worker-task']?.integrationStatus).toBe('applied');
    expect(worker?.tasks[0]?.deliveryVerification?.status).toBe('failed');

    const restartedStore = createSubagentRunStore({ runsDir: dir });
    const restartedResults = createSubagentResultService();
    hydrateSubagentResultService(restartedResults, await restartedStore.listManifests());
    const restartedManifest = await restartedStore.loadManifest('worker-run');
    expect(restartedManifest?.tasks[0]?.deliveryVerification?.status).toBe('failed');
    expect(restartedManifest?.results['worker-task']?.integrationStatus).toBe('applied');
    const hydrated = restartedResults.get('result-1');
    expect(hydrated?.latestVerification).toEqual({
      verificationId: submitted.record.verificationId,
      revision: 1,
    });
    expect(hydrated?.integrationStatus).toBe('applied');
    expect(hydrated?.appliedChanges).toEqual(CHANGES);
    expect(hydrated?.latestOperationId).toBe(APPLY_OP);
  });
});
