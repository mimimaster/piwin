import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { emptySubagentResultReviewFields, type SubagentResultSummary } from '@piwin/contracts';
import { createTurnChangeObjectStore, openTurnChangeStore } from '@piwin/git';
import { createSubagentRunStore } from '@piwin/session';
import { handleSubagentCommand, type SubagentCommandContext } from './commands/subagent-commands.js';
import { applyStatusFromIntegration } from './subagent-apply-reservation.js';
import { reconcileSubagentApplyOperations } from './subagent-apply-reconcile.js';
import { createSubagentIntegrationCoordinator } from './subagent-integration-coordinator.js';
import {
  SUBAGENT_RESOLUTION_INSTRUCTION,
  createSubagentResultService,
} from './subagent-result-service.js';
import { hydrateSubagentResultService } from './subagent-result-projection.js';
import { workspaceIdForRoot } from './turn-changes/coordinator.js';

const dirs: string[] = [];

function makeSummary(overrides: Partial<SubagentResultSummary> = {}): SubagentResultSummary {
  return {
    resultId: 'result-1',
    revision: 1,
    parentSessionId: 'session-1',
    childSessionId: 'child-1',
    taskId: 'task-1',
    batchRunId: 'run-1',
    sourceAttemptId: null,
    targetWorkspaceId: 'ws-1',
    deliveryIntent: 'candidate',
    legacyManual: false,
    candidateGroupId: null,
    ...emptySubagentResultReviewFields(),
    executionStatus: 'completed',
    summaryStatus: 'merged',
    integrationStatus: 'retained',
    childChanges: { changeSetId: 'cs-child', revision: 1 },
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

function orchestrationContext(
  overrides: Partial<SubagentCommandContext> = {},
): SubagentCommandContext {
  return {
    prepareBatch: async (input) => input,
    startBatch: () => ({ runId: 'run-1' }),
    getBatchProjection: async () => ({
      runId: 'run-1',
      status: 'running',
      results: [],
    }),
    cancelBatch: async () => {},
    continueChild: async () => ({ runId: 'continuation-run' }),
    actOnWorktree: async () => ({ integrationStatus: 'retained' }),
    ...overrides,
  };
}

describe('SubagentResultService', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('lists and gets registered summaries with pagination and filters', () => {
    const service = createSubagentResultService();
    const pending = makeSummary({ resultId: 'r1', sourceAttemptId: 'att-1' });
    const otherParent = makeSummary({ resultId: 'r2', parentSessionId: 'other' });
    const applied = makeSummary({ resultId: 'r3', integrationStatus: 'applied' });
    service.register(pending);
    service.register(otherParent);
    service.register(applied);

    expect(service.get('r1')).toEqual(pending);
    expect(service.get('missing')).toBeUndefined();
    expect(service.list({ parentSessionId: 'session-1' }).items.map((item) => item.resultId)).toEqual([
      'r1',
      'r3',
    ]);
    expect(
      service.list({ parentSessionId: 'session-1', pendingOnly: true }).items.map((item) => item.resultId),
    ).toEqual(['r1']);
    expect(
      service.list({ parentSessionId: 'session-1', attemptId: 'att-1' }).items.map((item) => item.resultId),
    ).toEqual(['r1']);

    const firstPage = service.list({ parentSessionId: 'session-1', limit: 1 });
    expect(firstPage.items).toEqual([pending]);
    expect(firstPage.nextCursor).toBe('r1');
    const cursor = firstPage.nextCursor;
    if (cursor === undefined) throw new Error('expected nextCursor');
    const secondPage = service.list({
      parentSessionId: 'session-1',
      limit: 1,
      cursor,
    });
    expect(secondPage.items).toEqual([applied]);
    expect(secondPage.nextCursor).toBeUndefined();
  });

  it('clamps list limit to 200 and defaults to 50', () => {
    const service = createSubagentResultService();
    for (let index = 0; index < 210; index += 1) {
      service.register(makeSummary({ resultId: `r-${String(index)}` }));
    }
    expect(service.list({ parentSessionId: 'session-1' }).items).toHaveLength(50);
    const clamped = service.list({ parentSessionId: 'session-1', limit: 500 });
    expect(clamped.items).toHaveLength(200);
    expect(clamped.nextCursor).toBe('r-199');
  });

  it('applies once and returns already-applied without a second write', async () => {
    const calls: string[] = [];
    const service = createSubagentResultService();
    service.register(makeSummary({ resultId: 'result-1', candidateGroupId: 'group-1' }));

    const first = await service.apply({
      resultId: 'result-1',
      expectedRevision: 1,
      applyResult: async (input) => {
        calls.push(input.resultId);
        return { operationId: 'op-1' };
      },
    });
    const second = await service.apply({
      resultId: 'result-1',
      expectedRevision: 1,
      applyResult: async (input) => {
        calls.push(input.resultId);
        return { operationId: 'op-2' };
      },
    });

    expect(first).toEqual({ ok: true, operationId: 'op-1' });
    expect(second).toMatchObject({
      ok: false,
      code: 'already-applied',
      alreadyApplied: true,
    });
    expect(calls).toEqual(['result-1']);
    expect(service.get('result-1')?.integrationStatus).toBe('applied');
  });

  it('rejects a second candidate in the same group without another write', async () => {
    const calls: string[] = [];
    const service = createSubagentResultService();
    service.register(makeSummary({ resultId: 'a', candidateGroupId: 'group-1' }));
    service.register(makeSummary({ resultId: 'b', candidateGroupId: 'group-1' }));

    const first = await service.apply({
      resultId: 'a',
      expectedRevision: 1,
      applyResult: async (input) => {
        calls.push(input.resultId);
        return { operationId: `op-${input.resultId}` };
      },
    });
    const second = await service.apply({
      resultId: 'b',
      expectedRevision: 1,
      applyResult: async (input) => {
        calls.push(input.resultId);
        return { operationId: `op-${input.resultId}` };
      },
    });

    expect(first).toEqual({ ok: true, operationId: 'op-a' });
    expect(second).toMatchObject({ ok: false, code: 'candidate-group-selected' });
    expect(calls).toEqual(['a']);
    expect(service.get('b')?.integrationStatus).toBe('retained');
  });

  it('request-resolution calls startParentPrompt not continueChild', async () => {
    const continued: string[] = [];
    const started: Array<{ parentSessionId: string; text: string; resultId: string }> = [];
    const service = createSubagentResultService();
    service.register(makeSummary({ resultId: 'result-1', parentSessionId: 'session-1' }));

    const outcome = await service.requestResolution({
      resultId: 'result-1',
      expectedRevision: 1,
      purpose: 'resolve',
      startParentPrompt: async (input) => {
        started.push(input);
        return { runId: 'parent-run' };
      },
    });

    expect(outcome).toEqual({ ok: true, runId: 'parent-run' });
    expect(started).toHaveLength(1);
    expect(started[0]?.parentSessionId).toBe('session-1');
    expect(started[0]?.resultId).toBe('result-1');
    expect(started[0]?.text).toContain(SUBAGENT_RESOLUTION_INSTRUCTION);
    expect(continued).toEqual([]);

    const commandResponse = await handleSubagentCommand(
      {
        type: 'subagent/request-resolution',
        resultId: 'result-1',
        expectedRevision: 1,
        purpose: 'resolve',
      },
      'request-resolution',
      orchestrationContext({
        resultService: service,
        continueChild: async (childSessionId, text) => {
          continued.push(`${childSessionId}:${text}`);
          return { runId: 'continuation-run' };
        },
        startParentPrompt: async (input) => {
          started.push(input);
          return { runId: 'parent-run-2' };
        },
      }),
    );
    expect(commandResponse).toMatchObject({
      success: true,
      command: 'subagent/request-resolution',
      data: { runId: 'parent-run-2' },
    });
    expect(continued).toEqual([]);
  });

  it('fails request-resolution and apply for missing or stale results', async () => {
    const service = createSubagentResultService();
    service.register(makeSummary({ resultId: 'result-1', revision: 2 }));
    const applyResult = async () => ({ operationId: 'op-1' });
    const startParentPrompt = async () => ({ runId: 'parent-run' });

    expect(
      await service.requestResolution({
        resultId: 'missing',
        expectedRevision: 2,
        purpose: 'resolve',
        startParentPrompt,
      }),
    ).toMatchObject({ ok: false, code: 'not-found' });
    expect(
      await service.requestResolution({
        resultId: 'result-1',
        expectedRevision: 1,
        purpose: 'resolve',
        startParentPrompt,
      }),
    ).toMatchObject({ ok: false, code: 'stale-revision' });
    expect(
      await service.apply({ resultId: 'missing', expectedRevision: 2, applyResult }),
    ).toMatchObject({ ok: false, code: 'not-found' });
    expect(
      await service.apply({ resultId: 'result-1', expectedRevision: 1, applyResult }),
    ).toMatchObject({ ok: false, code: 'stale-revision' });
  });

  it('returns frozen files and diffs from an injected TurnChangeStore', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-subagent-result-'));
    dirs.push(rootDir);
    const store = openTurnChangeStore({ rootDir });
    const objectStore = createTurnChangeObjectStore({ rootDir });
    const before = await store.putObject(new TextEncoder().encode('old\n'));
    const after = await store.putObject(new TextEncoder().encode('new\n'));
    const published = store.publishChangeVersion({
      changeSetId: 'cs-child',
      revision: 1,
      coverageComplete: true,
      files: [
        {
          relativePath: 'a.txt',
          beforeSha: before.sha256,
          afterSha: after.sha256,
          beforeExists: true,
          afterExists: true,
        },
      ],
    });
    const file = published.files[0];
    if (file === undefined) throw new Error('expected published file');

    const service = createSubagentResultService({ changeStore: store, objectStore });
    service.register(makeSummary({ resultId: 'result-1' }), { worktreePath: '/tmp/child-wt' });

    const files = service.listFiles({ resultId: 'result-1', revision: 1 });
    expect(files.files).toEqual([
      {
        fileId: file.fileId,
        relativePath: 'a.txt',
        kind: 'modified',
      },
    ]);

    const diff = await service.diffFile({
      resultId: 'result-1',
      revision: 1,
      fileId: file.fileId,
    });
    expect(diff.ok).toBe(true);
    if (diff.ok) {
      expect(diff.additions).toBe(1);
      expect(diff.deletions).toBe(1);
      expect(diff.binary).toBe(false);
      expect(diff.patch).toContain('a.txt');
    }

    const missingFile = await service.diffFile({
      resultId: 'result-1',
      revision: 1,
      fileId: '/etc/passwd',
    });
    expect(missingFile).toMatchObject({ ok: false, code: 'not-found' });

    const cleanup = service.planCleanup('result-1', 1);
    expect(cleanup).toMatchObject({ ok: true, worktreePath: '/tmp/child-wt' });
    if (cleanup.ok) {
      expect(cleanup.token.length).toBeGreaterThan(0);
      expect(Date.parse(cleanup.expiresAt)).toBeGreaterThan(Date.now());
    }
    store.close();
  });

  it('returns an empty files page when no change store is injected', () => {
    const service = createSubagentResultService();
    service.register(makeSummary());
    expect(service.listFiles({ resultId: 'result-1', revision: 1 })).toEqual({ files: [] });
  });

  it('candidate metadata survives store round-trip and Host restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-result-restart-'));
    dirs.push(dir);
    const parentRepo = '/tmp/piwin-parent-ws';
    const store = createSubagentRunStore({ runsDir: dir });
    const predecessor = { resultId: 'result-v1', revision: 1 };
    await store.createManifest('run-1', {
      parentSessionId: 'parent-1',
      tasks: [
        {
          id: 'task-1',
          parentSessionId: 'parent-1',
          task: 'implement login',
          deliveryIntent: 'candidate',
          applyPolicy: 'explicit',
          legacyManual: false,
          candidateGroupId: 'group-login',
          candidateLineageId: 'lineage-login',
          candidateGeneration: 2,
          predecessorResult: predecessor,
        },
      ],
    });
    await store.recordLease('run-1', 'task-1', {
      mode: 'worktree',
      cwd: parentRepo,
      parentRepoPath: parentRepo,
      worktreePath: '/tmp/child-wt',
      worktreeBranch: 'child',
      baseCommit: 'abc',
    });
    await store.recordResult('run-1', 'task-1', {
      runId: 'run-1',
      taskId: 'task-1',
      childSessionId: 'child-1',
      executionStatus: 'completed',
      summaryStatus: 'merged',
      integrationStatus: 'retained',
      resultRef: { resultId: 'result-v2', revision: 1 },
      childChanges: { changeSetId: 'cs-v2', revision: 1 },
      worktreePath: '/tmp/child-wt',
    });

    const loaded = await store.loadManifest('run-1');
    expect(loaded?.tasks[0]).toMatchObject({
      deliveryIntent: 'candidate',
      applyPolicy: 'explicit',
      candidateGroupId: 'group-login',
      candidateLineageId: 'lineage-login',
      candidateGeneration: 2,
      predecessorResult: predecessor,
    });

    if (!loaded) throw new Error('expected persisted manifest');
    const first = createSubagentResultService();
    hydrateSubagentResultService(first, [loaded]);
    const beforeRestart = first.get('result-v2');
    expect(beforeRestart).toMatchObject({
      resultId: 'result-v2',
      deliveryIntent: 'candidate',
      legacyManual: false,
      candidateGroupId: 'group-login',
      candidateLineageId: 'lineage-login',
      candidateGeneration: 2,
      predecessorResult: predecessor,
      targetWorkspaceId: workspaceIdForRoot(parentRepo),
      childChanges: { changeSetId: 'cs-v2', revision: 1 },
      reviewStatus: 'not-requested',
    });
    expect(beforeRestart?.availability.apply.allowed).toBe(true);

    const restarted = createSubagentRunStore({ runsDir: dir });
    const after = createSubagentResultService();
    hydrateSubagentResultService(after, await restarted.listManifests());
    expect(after.get('result-v2')).toEqual(beforeRestart);
  });

  it('continuation v2 links to v1 with a distinct result id', () => {
    const service = createSubagentResultService();
    const v1 = makeSummary({
      resultId: 'result-v1',
      taskId: 'task-v1',
      candidateGroupId: 'group-login',
      candidateLineageId: 'lineage-login',
      candidateGeneration: 1,
      childChanges: { changeSetId: 'cs-v1', revision: 1 },
    });
    const v2 = makeSummary({
      resultId: 'result-v2',
      taskId: 'task-v2',
      candidateGroupId: 'group-login',
      candidateLineageId: 'lineage-login',
      candidateGeneration: 2,
      predecessorResult: { resultId: 'result-v1', revision: 1 },
      childChanges: { changeSetId: 'cs-v2', revision: 1 },
    });
    service.register(v1);
    service.register(v2);
    expect(service.get('result-v2')?.resultId).not.toBe(service.get('result-v1')?.resultId);
    expect(service.get('result-v2')?.predecessorResult).toEqual({
      resultId: 'result-v1',
      revision: 1,
    });
    expect(service.get('result-v2')?.candidateLineageId).toBe('lineage-login');
  });

  it('v2 makes v1 non-head without mutating v1 frozen content', () => {
    const service = createSubagentResultService();
    const frozenV1 = { changeSetId: 'cs-v1', revision: 1 };
    service.register(
      makeSummary({
        resultId: 'result-v1',
        reviewStatus: 'approved',
        latestReview: { reviewId: 'rev-1', revision: 1 },
        candidateLineageId: 'lineage-login',
        candidateGeneration: 1,
        childChanges: frozenV1,
      }),
    );
    const v1Before = service.get('result-v1');
    if (!v1Before) throw new Error('expected v1');
    const frozenSnapshot = structuredClone(v1Before.childChanges);

    service.register(
      makeSummary({
        resultId: 'result-v2',
        candidateLineageId: 'lineage-login',
        candidateGeneration: 2,
        predecessorResult: { resultId: 'result-v1', revision: 1 },
        childChanges: { changeSetId: 'cs-v2', revision: 1 },
      }),
    );

    const v1After = service.get('result-v1');
    expect(v1After?.reviewStatus).toBe('stale');
    expect(v1After?.availability.apply).toEqual({
      allowed: false,
      reason: 'candidate-superseded',
    });
    expect(v1After?.resultId).toBe('result-v1');
    expect(v1After?.revision).toBe(1);
    expect(v1After?.childChanges).toEqual(frozenSnapshot);
    expect(v1After?.latestReview).toEqual({ reviewId: 'rev-1', revision: 1 });
    expect(service.get('result-v2')?.reviewStatus).toBe('not-requested');
    expect(service.get('result-v2')?.availability.apply.allowed).toBe(true);
  });

  it('legacy manifest migration cannot make a result more writable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-result-legacy-'));
    dirs.push(dir);
    await writeFile(
      join(dir, 'run-legacy.json'),
      `${JSON.stringify({
        runId: 'run-legacy',
        parentSessionId: 'parent-1',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        tasks: [{ id: 'task-1', task: 'old worktree task' }],
        maxConcurrency: 4,
        failurePolicy: 'continue',
        snapshots: {},
        leases: {
          'task-1': {
            mode: 'worktree',
            cwd: '/tmp/parent',
            parentRepoPath: '/tmp/parent',
            worktreePath: '/tmp/legacy-wt',
            worktreeBranch: 'child',
            baseCommit: 'abc',
          },
        },
        results: {
          'task-1': {
            runId: 'run-legacy',
            taskId: 'task-1',
            childSessionId: 'child-legacy',
            executionStatus: 'completed',
            summaryStatus: 'merged',
            integrationStatus: 'retained',
            resultRef: { resultId: 'legacy-result', revision: 1 },
            childChanges: { changeSetId: 'cs-legacy', revision: 1 },
            worktreePath: '/tmp/legacy-wt',
          },
        },
        invocations: {},
        status: 'completed',
      })}\n`,
      'utf8',
    );
    const store = createSubagentRunStore({ runsDir: dir });
    const service = createSubagentResultService();
    hydrateSubagentResultService(service, await store.listManifests());
    const summary = service.get('legacy-result');
    expect(summary).toMatchObject({
      legacyManual: true,
      candidateLineageId: null,
      candidateGeneration: null,
      predecessorResult: null,
      latestReview: null,
      reviewStatus: 'not-requested',
    });
    expect(summary?.availability.view.allowed).toBe(true);
    expect(summary?.availability.apply).toEqual({ allowed: false, reason: 'legacy-manual' });
    expect(summary?.availability.resolve).toEqual({ allowed: false, reason: 'legacy-manual' });
    expect(summary?.availability.cleanup).toEqual({ allowed: false, reason: 'legacy-manual' });

    hydrateSubagentResultService(service, await store.listManifests());
    expect(service.get('legacy-result')?.availability.apply.allowed).toBe(false);
  });

  it('candidate group and candidate lineage remain independent', async () => {
    const service = createSubagentResultService();
    service.register(
      makeSummary({
        resultId: 'a',
        candidateGroupId: 'group-login',
        candidateLineageId: 'lineage-a',
        candidateGeneration: 1,
      }),
    );
    service.register(
      makeSummary({
        resultId: 'b',
        candidateGroupId: 'group-login',
        candidateLineageId: 'lineage-b',
        candidateGeneration: 1,
      }),
    );
    service.register(
      makeSummary({
        resultId: 'c',
        candidateGroupId: 'group-other',
        candidateLineageId: 'lineage-a',
        candidateGeneration: 2,
        predecessorResult: { resultId: 'a', revision: 1 },
      }),
    );

    expect(service.get('a')?.candidateGroupId).toBe('group-login');
    expect(service.get('a')?.candidateLineageId).toBe('lineage-a');
    expect(service.get('a')?.reviewStatus).toBe('stale');
    expect(service.get('b')?.reviewStatus).toBe('not-requested');
    expect(service.get('b')?.availability.apply.allowed).toBe(true);
    expect(service.get('c')?.candidateGroupId).toBe('group-other');

    const applied = await service.apply({
      resultId: 'b',
      expectedRevision: 1,
      applyResult: async () => ({ operationId: 'op-b' }),
    });
    expect(applied).toEqual({ ok: true, operationId: 'op-b' });
    expect(
      await service.apply({
        resultId: 'a',
        expectedRevision: 1,
        applyResult: async () => ({ operationId: 'op-a' }),
      }),
    ).toMatchObject({ ok: false, code: 'candidate-group-selected' });
    expect(service.get('c')?.availability.apply.allowed).toBe(true);
  });

  it('same apply fingerprint replays one operation id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-result-apply-fp-'));
    dirs.push(dir);
    const store = openTurnChangeStore({ rootDir: dir });
    const writes: string[] = [];
    const service = createSubagentResultService({ operationStore: store });
    service.register(makeSummary({ resultId: 'result-1' }));

    const first = await service.apply({
      resultId: 'result-1',
      expectedRevision: 1,
      applyResult: async (input) => {
        writes.push(input.operationId);
        return { operationId: input.operationId };
      },
    });
    const second = await service.apply({
      resultId: 'result-1',
      expectedRevision: 1,
      applyResult: async (input) => {
        writes.push(`second:${input.operationId}`);
        return { operationId: input.operationId };
      },
    });

    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(writes).toHaveLength(1);
    store.close();
  });

  it('concurrent same-result and same-group applies produce one writer', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-result-apply-race-'));
    dirs.push(dir);
    const store = openTurnChangeStore({ rootDir: dir });
    const writes: string[] = [];
    const started = createDeferred();
    const releaseFirst = createDeferred();
    const service = createSubagentResultService({ operationStore: store });
    service.register(makeSummary({ resultId: 'a', candidateGroupId: 'group-1' }));
    service.register(makeSummary({ resultId: 'b', candidateGroupId: 'group-1' }));

    const first = service.apply({
      resultId: 'a',
      expectedRevision: 1,
      applyResult: async (input) => {
        writes.push(input.resultId);
        started.resolve();
        await releaseFirst.promise;
        return { operationId: input.operationId };
      },
    });
    await started.promise;
    const [sameResult, sameGroup] = await Promise.all([
      service.apply({
        resultId: 'a',
        expectedRevision: 1,
        idempotencyKey: 'other-a',
        requestHash: 'other-a',
        applyResult: async (input) => {
          writes.push(input.resultId);
          return { operationId: input.operationId };
        },
      }),
      (async () => {
        releaseFirst.resolve();
        return service.apply({
          resultId: 'b',
          expectedRevision: 1,
          applyResult: async (input) => {
            writes.push(input.resultId);
            return { operationId: input.operationId };
          },
        });
      })(),
    ]);
    const firstResult = await first;

    expect(firstResult).toMatchObject({ ok: true });
    expect(sameResult).toMatchObject({ ok: false, code: 'already-applied' });
    expect(sameGroup).toMatchObject({ ok: false, code: 'candidate-group-selected' });
    expect(writes).toEqual(['a']);
    store.close();
  });

  it('restart after reservation rejects an overlapping apply', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-result-apply-reserve-'));
    dirs.push(dir);
    const firstStore = openTurnChangeStore({ rootDir: dir });
    const first = createSubagentResultService({ operationStore: firstStore });
    first.register(makeSummary({ resultId: 'result-1', candidateGroupId: 'group-1' }));
    firstStore.reserveSubagentApply({
      operationId: 'op-reserved',
      changeSetId: 'cs-child',
      expectedRevision: 1,
      principal: 'host',
      idempotencyKey: 'manual-reserve',
      requestHash: 'manual-reserve',
      resultId: 'result-1',
      candidateGroupId: 'group-1',
    });
    firstStore.close();

    const restartedStore = openTurnChangeStore({ rootDir: dir });
    const restarted = createSubagentResultService({ operationStore: restartedStore });
    restarted.register(makeSummary({ resultId: 'result-1', candidateGroupId: 'group-1' }));
    restarted.register(makeSummary({ resultId: 'result-2', candidateGroupId: 'group-1' }));
    restarted.reconcileApplyReservations(restartedStore.listSubagentApplyReservations());

    const writes: string[] = [];
    expect(
      await restarted.apply({
        resultId: 'result-2',
        expectedRevision: 1,
        applyResult: async (input) => {
          writes.push(input.resultId);
          return { operationId: input.operationId };
        },
      }),
    ).toMatchObject({ ok: false, code: 'candidate-group-selected' });
    expect(
      await restarted.apply({
        resultId: 'result-1',
        expectedRevision: 1,
        idempotencyKey: 'overlap',
        requestHash: 'overlap',
        applyResult: async (input) => {
          writes.push(input.resultId);
          return { operationId: input.operationId };
        },
      }),
    ).toMatchObject({ ok: false, code: 'already-applied' });
    expect(writes).toEqual([]);
    restartedStore.close();
  });

  it('restart after file write reconciles success without a second write', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-result-apply-written-'));
    dirs.push(dir);
    const firstStore = openTurnChangeStore({ rootDir: dir });
    const reserved = firstStore.reserveSubagentApply({
      operationId: 'op-written',
      changeSetId: 'cs-child',
      expectedRevision: 1,
      principal: 'host',
      idempotencyKey: 'subagent-apply:result-1',
      requestHash: 'subagent-apply:result-1:1',
      resultId: 'result-1',
    });
    expect(reserved.outcome).toBe('created');
    firstStore.updateOperationStatus('op-written', 'applying');
    firstStore.recordOperationFiles([
      {
        operationId: 'op-written',
        relativePath: 'a.ts',
        fromSha: null,
        toSha: 'a'.repeat(64),
        backupSha: null,
        fromExists: false,
        toExists: true,
        status: 'verified',
      },
    ]);
    firstStore.close();

    const restartedStore = openTurnChangeStore({ rootDir: dir });
    const objectStore = createTurnChangeObjectStore({ rootDir: dir });
    const restarted = createSubagentResultService({ operationStore: restartedStore });
    restarted.register(makeSummary({ resultId: 'result-1', integrationStatus: 'retained' }));
    await reconcileSubagentApplyOperations({
      store: restartedStore,
      objectStore,
      resultService: restarted,
    });

    expect(restarted.get('result-1')?.integrationStatus).toBe('applied');
    expect(restarted.get('result-1')?.latestOperationId).toBe('op-written');
    const writes: string[] = [];
    const replay = await restarted.apply({
      resultId: 'result-1',
      expectedRevision: 1,
      applyResult: async (input) => {
        writes.push(input.resultId);
        return { operationId: input.operationId };
      },
    });
    expect(replay).toEqual({ ok: true, operationId: 'op-written' });
    expect(writes).toEqual([]);
    restartedStore.close();
  });

  it('failed pre-write validation releases reservation; needs-repair does not', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-result-apply-release-'));
    dirs.push(dir);
    const store = openTurnChangeStore({ rootDir: dir });
    const service = createSubagentResultService({ operationStore: store });
    service.register(makeSummary({ resultId: 'result-1', candidateGroupId: 'group-1' }));
    service.register(makeSummary({ resultId: 'result-2', candidateGroupId: 'group-1' }));

    const rejected = await service.apply({
      resultId: 'result-1',
      expectedRevision: 1,
      applyResult: async (input) => ({ operationId: input.operationId, status: 'rejected' }),
    });
    expect(rejected.ok).toBe(false);
    expect(store.getSubagentApplyReservation({ resultId: 'result-1' })).toBeUndefined();

    const writes: string[] = [];
    const retried = await service.apply({
      resultId: 'result-1',
      expectedRevision: 1,
      idempotencyKey: 'retry',
      requestHash: 'retry',
      applyResult: async (input) => {
        writes.push(input.resultId);
        return { operationId: input.operationId };
      },
    });
    expect(retried.ok).toBe(true);
    expect(writes).toEqual(['result-1']);

    const repairDir = await mkdtemp(join(tmpdir(), 'piwin-result-apply-repair-'));
    dirs.push(repairDir);
    const isolated = openTurnChangeStore({ rootDir: repairDir });
    const repairService = createSubagentResultService({ operationStore: isolated });
    repairService.register(makeSummary({ resultId: 'result-2', candidateGroupId: 'group-1' }));
    const repair = await repairService.apply({
      resultId: 'result-2',
      expectedRevision: 1,
      applyResult: async (input) => ({ operationId: input.operationId, status: 'needs-repair' }),
    });
    expect(repair).toMatchObject({ ok: false, code: 'needs-repair' });
    isolated.releaseSubagentApplyReservation(
      isolated.getSubagentApplyReservation({ resultId: 'result-2' })?.operationId ?? '',
    );
    expect(isolated.getSubagentApplyReservation({ resultId: 'result-2' })?.status).toBe('needs-repair');

    const blocked = await repairService.apply({
      resultId: 'result-2',
      expectedRevision: 1,
      idempotencyKey: 'blocked',
      requestHash: 'blocked',
      applyResult: async (input) => {
        writes.push(input.resultId);
        return { operationId: input.operationId };
      },
    });
    expect(blocked).toMatchObject({ ok: false, code: 'needs-repair' });
    expect(writes).toEqual(['result-1']);
    isolated.close();
    store.close();
  });

  it('same-fingerprint applying replay continues the original writer', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-result-apply-resume-'));
    dirs.push(dir);
    const store = openTurnChangeStore({ rootDir: dir });
    const service = createSubagentResultService({ operationStore: store });
    service.register(makeSummary({ resultId: 'result-1' }));
    expect(
      store.reserveSubagentApply({
        operationId: 'op-resume',
        changeSetId: 'cs-child',
        expectedRevision: 1,
        principal: 'host',
        idempotencyKey: 'subagent-apply:result-1',
        requestHash: 'subagent-apply:result-1:1',
        resultId: 'result-1',
      }).outcome,
    ).toBe('created');

    const writes: string[] = [];
    const resumed = await service.apply({
      resultId: 'result-1',
      expectedRevision: 1,
      applyResult: async (input) => {
        writes.push(input.operationId);
        return { operationId: input.operationId };
      },
    });

    expect(resumed).toEqual({ ok: true, operationId: 'op-resume' });
    expect(writes).toEqual(['op-resume']);
    expect(service.get('result-1')?.integrationStatus).toBe('applied');
    store.close();
  });

  it('wired applyResult conflict keeps the lock and is not ok', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-result-apply-wired-conflict-'));
    dirs.push(dir);
    const store = openTurnChangeStore({ rootDir: dir });
    const service = createSubagentResultService({ operationStore: store });
    service.register(makeSummary({ resultId: 'res-1' }));
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

    const outcome = await service.apply({
      resultId: 'res-1',
      expectedRevision: 1,
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
        const reservationStatus = store.getSubagentApplyReservation({
          resultId: input.resultId,
        })?.status;
        return {
          operationId: input.operationId,
          status: applyStatusFromIntegration({
            integrationStatus: integrated.integrationStatus,
            ...(reservationStatus === undefined ? {} : { reservationStatus }),
          }),
        };
      },
    });

    expect(outcome).toMatchObject({ ok: false, code: 'needs-repair' });
    expect(store.getSubagentApplyReservation({ resultId: 'res-1' })?.status).toBe('needs-repair');
    expect(service.get('res-1')?.integrationStatus).not.toBe('applied');
    store.close();
  });

  it('restart after coordinator success without operation_file rows reconciles without a second write', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-result-apply-wired-restart-'));
    dirs.push(dir);
    const firstStore = openTurnChangeStore({ rootDir: dir });
    const crashedStore = {
      reserveSubagentApply: firstStore.reserveSubagentApply.bind(firstStore),
      releaseSubagentApplyReservation: firstStore.releaseSubagentApplyReservation.bind(firstStore),
      getOperation: firstStore.getOperation.bind(firstStore),
      getSubagentApplyReservation: firstStore.getSubagentApplyReservation.bind(firstStore),
      recordSubagentApplyWriteCompleted: firstStore.recordSubagentApplyWriteCompleted.bind(firstStore),
      hasSubagentApplyWriteCompleted: firstStore.hasSubagentApplyWriteCompleted.bind(firstStore),
      updateOperationStatus: (operationId: string, status: string) => {
        if (status === 'succeeded') {
          firstStore.recordSubagentApplyWriteCompleted(operationId);
          return;
        }
        firstStore.updateOperationStatus(operationId, status);
      },
    };
    const coordinator = createSubagentIntegrationCoordinator({
      integrateWorktree: async () => ({
        success: true,
        changedFiles: ['src/a.ts'],
        allowedOutputPaths: [],
      }),
      isBaseClean: async () => true,
      removeWorktree: async () => {},
      applyReservation: crashedStore,
    });
    await coordinator.integrate(
      {
        runId: 'run-1',
        taskId: 'task-1',
        executionStatus: 'completed',
        summaryStatus: 'not-requested',
        integrationStatus: 'pending',
        resultRef: { resultId: 'result-1', revision: 1 },
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
    const reserved = firstStore.getSubagentApplyReservation({ resultId: 'result-1' });
    expect(reserved?.status).toBe('applying');
    expect(reserved && firstStore.hasSubagentApplyWriteCompleted(reserved.operationId)).toBe(true);
    expect(reserved ? firstStore.listOperationFiles(reserved.operationId) : ['missing']).toEqual([]);
    firstStore.close();

    const restartedStore = openTurnChangeStore({ rootDir: dir });
    const objectStore = createTurnChangeObjectStore({ rootDir: dir });
    const restarted = createSubagentResultService({ operationStore: restartedStore });
    restarted.register(makeSummary({ resultId: 'result-1', integrationStatus: 'retained' }));
    await reconcileSubagentApplyOperations({
      store: restartedStore,
      objectStore,
      resultService: restarted,
    });

    expect(restarted.get('result-1')?.integrationStatus).toBe('applied');
    const writes: string[] = [];
    const replay = await restarted.apply({
      resultId: 'result-1',
      expectedRevision: 1,
      applyResult: async (input) => {
        writes.push(input.resultId);
        return { operationId: input.operationId };
      },
    });
    expect(replay.ok).toBe(true);
    expect(writes).toEqual([]);
    expect(restartedStore.listOperationFiles(reserved?.operationId ?? '')).toEqual([]);
    restartedStore.close();
  });
});

function createDeferred(): {
  promise: Promise<void>;
  resolve(): void;
} {
  let resolvePromise: (() => void) | undefined;
  const promise = new Promise<void>((resolveValue) => {
    resolvePromise = resolveValue;
  });
  return {
    resolve: () => {
      if (!resolvePromise) throw new Error('deferred promise was not initialized');
      resolvePromise();
    },
    promise,
  };
}
