import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createSubagentRunStore,
  SubagentRunManifestCorruptError,
  SubagentRunManifestExistsError,
} from './subagent-run-store.js';
import type {
  SubagentBatchRequest,
  SubagentDeliveryVerification,
  SubagentReviewRecord,
  SubagentTaskSpec,
} from '@piwin/contracts';

function makeTask(overrides: Partial<SubagentTaskSpec> = {}): SubagentTaskSpec {
  return {
    id: 'task-1',
    parentSessionId: 'parent-1',
    task: 'do something',
    ...overrides,
  };
}

function makeBatch(
  tasks: SubagentTaskSpec[],
  overrides: Partial<SubagentBatchRequest> = {},
): SubagentBatchRequest {
  return {
    parentSessionId: 'parent-1',
    tasks,
    maxConcurrency: 4,
    ...overrides,
  };
}

describe('SubagentRunStore', () => {
  it('creates and loads a manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    const manifest = await store.createManifest('run-1', makeBatch([makeTask({ id: 'a' })]));
    expect(manifest.runId).toBe('run-1');
    expect(manifest.status).toBe('running');
    const loaded = await store.loadManifest('run-1');
    expect(loaded?.runId).toBe('run-1');
  });

  it('lists durable manifests for startup reconciliation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    await store.createManifest('run-1', makeBatch([makeTask({ id: 'a' })]));
    await store.createManifest('run-2', makeBatch([makeTask({ id: 'b' })]));
    expect((await store.listManifests()).map((manifest) => manifest.runId).sort()).toEqual([
      'run-1',
      'run-2',
    ]);
  });

  it('persists and lists the latest invocation revision for a parent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    await store.createManifest(
      'run-1',
      makeBatch([
        makeTask({
          id: 'a',
          invocationId: 'invocation-1',
          parentRunId: 'parent-run',
          parentToolCallId: 'tool-1',
        }),
      ]),
    );
    const initial = (await store.listInvocations('parent-1'))[0];
    if (!initial) throw new Error('expected invocation');
    expect(initial).toMatchObject({
      id: 'invocation-1',
      parentToolCallId: 'tool-1',
      status: 'queued',
      revision: 1,
    });

    await store.recordInvocation('run-1', {
      ...initial,
      status: 'running',
      activity: { kind: 'tool', toolName: 'shell', title: 'Run tests' },
      childSessionId: 'child-1',
      revision: 2,
      updatedAt: '2026-08-12T01:00:00.000Z',
    });
    await store.recordInvocation('run-1', { ...initial, revision: 1 });

    expect((await store.listInvocations('parent-1'))[0]).toMatchObject({
      status: 'running',
      childSessionId: 'child-1',
      revision: 2,
      activity: { kind: 'tool', toolName: 'shell', title: 'Run tests' },
    });
  });

  it('persists delivery, group, and lineage fields through a store round-trip', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    const predecessor = { resultId: 'result-v1', revision: 1 };
    await store.createManifest(
      'run-1',
      makeBatch([
        makeTask({
          id: 'a',
          invocationId: 'inv-1',
          deliveryIntent: 'candidate',
          applyPolicy: 'explicit',
          legacyManual: false,
          retainWorktree: true,
          candidateGroupId: 'group-login',
          candidateLineageId: 'lineage-login',
          candidateGeneration: 2,
          predecessorResult: predecessor,
          reviewTarget: {
            result: predecessor,
            changes: { changeSetId: 'cs-v1', revision: 1 },
          },
        }),
      ]),
    );
    const loaded = await store.loadManifest('run-1');
    expect(loaded?.tasks[0]).toMatchObject({
      deliveryIntent: 'candidate',
      applyPolicy: 'explicit',
      legacyManual: false,
      retainWorktree: true,
      candidateGroupId: 'group-login',
      candidateLineageId: 'lineage-login',
      candidateGeneration: 2,
      predecessorResult: predecessor,
    });
    expect(loaded?.invocations['inv-1']).toMatchObject({
      candidateLineageId: 'lineage-login',
      candidateGeneration: 2,
      predecessorResult: predecessor,
    });
  });

  it('persists a reviewer decision once and rejects a different payload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    await store.createManifest(
      'run-1',
      makeBatch([makeTask({ id: 'reviewer', invocationId: 'inv-1' })]),
    );
    const record: SubagentReviewRecord = {
      reviewId: 'review-1',
      revision: 1,
      parentSessionId: 'parent-1',
      reviewerSessionId: 'reviewer-child',
      reviewerRunId: 'run-1',
      targetResult: { resultId: 'result-1', revision: 1 },
      targetChanges: { changeSetId: 'cs-1', revision: 1 },
      decision: 'approved',
      findings: [],
      verification: [],
      createdAt: '2026-09-13T01:00:00.000Z',
    };
    await expect(store.persistReviewerDecision('run-1', 'reviewer', record)).resolves.toEqual({
      ok: true,
      record,
    });
    await expect(store.persistReviewerDecision('run-1', 'reviewer', record)).resolves.toEqual({
      ok: true,
      record,
    });
    const conflict = await store.persistReviewerDecision('run-1', 'reviewer', {
      ...record,
      decision: 'blocked',
      findings: [
        {
          id: 'f1',
          severity: 'low',
          title: 'Blocked',
          detail: 'Need access',
        },
      ],
    });
    expect(conflict).toMatchObject({ ok: false, code: 'conflict' });
    const loaded = await store.loadManifest('run-1');
    expect(loaded?.tasks[0]?.reviewRef).toEqual({ reviewId: 'review-1', revision: 1 });
    expect(loaded?.invocations['inv-1']?.reviewRef).toEqual({ reviewId: 'review-1', revision: 1 });
  });

  it('persists a delivery verification once and rejects a different payload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    await store.createManifest('run-1', makeBatch([makeTask({ id: 'worker', invocationId: 'inv-1' })]));
    await store.recordResult('run-1', 'worker', {
      runId: 'run-1',
      taskId: 'worker',
      childSessionId: 'worker-child',
      executionStatus: 'completed',
      summaryStatus: 'merged',
      integrationStatus: 'applied',
      resultRef: { resultId: 'result-1', revision: 1 },
    });
    const record: SubagentDeliveryVerification = {
      verificationId: 'verify-1',
      revision: 1,
      parentSessionId: 'parent-1',
      parentRunId: 'parent-run-2',
      result: { resultId: 'result-1', revision: 1 },
      approvedBy: { reviewId: 'review-1', revision: 1 },
      applyOperationId: 'op-1',
      appliedChanges: { changeSetId: 'cs-1', revision: 1 },
      status: 'passed',
      checks: [{ label: 'typecheck', status: 'passed', evidence: 'tsc ok' }],
      createdAt: '2026-09-13T03:00:00.000Z',
    };
    await expect(store.persistDeliveryVerification('run-1', 'worker', record)).resolves.toEqual({
      ok: true,
      record,
    });
    await expect(store.persistDeliveryVerification('run-1', 'worker', record)).resolves.toEqual({
      ok: true,
      record,
    });
    const conflict = await store.persistDeliveryVerification('run-1', 'worker', {
      ...record,
      status: 'failed',
      checks: [{ label: 'typecheck', status: 'failed', evidence: 'tsc failed' }],
    });
    expect(conflict).toMatchObject({ ok: false, code: 'conflict' });
    const loaded = await store.loadManifest('run-1');
    expect(loaded?.tasks[0]?.latestVerification).toEqual({
      verificationId: 'verify-1',
      revision: 1,
    });
    expect(loaded?.results.worker?.latestVerification).toEqual({
      verificationId: 'verify-1',
      revision: 1,
    });
    expect(loaded?.results.worker?.integrationStatus).toBe('applied');
  });

  it('persists apply fields and keeps them across a same-result rewrite', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    await store.createManifest('run-1', makeBatch([makeTask({ id: 'worker', invocationId: 'inv-1' })]));
    await store.recordResult('run-1', 'worker', {
      runId: 'run-1',
      taskId: 'worker',
      childSessionId: 'worker-child',
      executionStatus: 'completed',
      summaryStatus: 'merged',
      integrationStatus: 'applied',
      resultRef: { resultId: 'result-1', revision: 1 },
    });
    await store.projectResultApply('run-1', 'worker', {
      appliedChanges: { changeSetId: 'cs-1', revision: 1 },
      latestOperationId: 'op-1',
    });
    await store.recordResult('run-1', 'worker', {
      runId: 'run-1',
      taskId: 'worker',
      childSessionId: 'worker-child',
      executionStatus: 'completed',
      summaryStatus: 'merged',
      integrationStatus: 'applied',
      resultRef: { resultId: 'result-1', revision: 1 },
    });
    expect((await store.loadManifest('run-1'))?.results.worker).toMatchObject({
      appliedChanges: { changeSetId: 'cs-1', revision: 1 },
      latestOperationId: 'op-1',
    });

    await store.recordResult('run-1', 'worker', {
      runId: 'run-1',
      taskId: 'worker',
      childSessionId: 'worker-child',
      executionStatus: 'completed',
      summaryStatus: 'merged',
      integrationStatus: 'retained',
      resultRef: { resultId: 'result-2', revision: 1 },
    });
    const replaced = (await store.loadManifest('run-1'))?.results.worker;
    expect(replaced?.resultRef).toEqual({ resultId: 'result-2', revision: 1 });
    expect(replaced?.appliedChanges).toBeUndefined();
    expect(replaced?.latestOperationId).toBeUndefined();
  });

  it('reads a legacy manifest without inventing lineage or delivery fields', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    await writeFile(
      join(dir, 'run-old.json'),
      `${JSON.stringify({
        runId: 'run-old',
        parentSessionId: 'parent-1',
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
        tasks: [{ id: 'a', task: 'do something' }],
        maxConcurrency: 4,
        failurePolicy: 'continue',
        snapshots: {},
        leases: {},
        results: {},
        invocations: {},
        status: 'completed',
      })}\n`,
      'utf8',
    );
    const store = createSubagentRunStore({ runsDir: dir });
    const loaded = await store.loadManifest('run-old');
    expect(loaded?.tasks[0]).toEqual({ id: 'a', task: 'do something' });
    expect(loaded?.tasks[0]?.deliveryIntent).toBeUndefined();
    expect(loaded?.tasks[0]?.candidateLineageId).toBeUndefined();
  });

  it('records snapshots, leases, and results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    await store.createManifest('run-1', makeBatch([makeTask({ id: 'a' })]));
    await store.recordSnapshot('run-1', 'a', {
      isolation: 'readonly',
      workingDirectory: '/tmp/project',
    });
    await store.recordLease('run-1', 'a', {
      mode: 'readonly',
      cwd: '/tmp/project',
      parentRepoPath: '/tmp/project',
    });
    await store.recordResult('run-1', 'a', {
      runId: 'run-1',
      taskId: 'a',
      executionStatus: 'completed',
      summaryStatus: 'merged',
      integrationStatus: 'not-requested',
    });
    const loaded = await store.loadManifest('run-1');
    expect(loaded?.snapshots.a?.isolation).toBe('readonly');
    expect(loaded?.leases.a?.cwd).toBe('/tmp/project');
    expect(loaded?.results.a?.executionStatus).toBe('completed');
  });

  it('serializes parallel manifest mutations without losing sibling task results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    await store.createManifest('run-1', makeBatch([makeTask({ id: 'a' }), makeTask({ id: 'b' })]));
    await Promise.all([
      store.recordResult('run-1', 'a', {
        runId: 'run-1',
        taskId: 'a',
        executionStatus: 'completed',
        summaryStatus: 'merged',
        integrationStatus: 'not-requested',
      }),
      store.recordResult('run-1', 'b', {
        runId: 'run-1',
        taskId: 'b',
        executionStatus: 'failed',
        summaryStatus: 'not-requested',
        integrationStatus: 'not-requested',
      }),
    ]);

    expect(Object.keys((await store.loadManifest('run-1'))?.results ?? {}).sort()).toEqual([
      'a',
      'b',
    ]);
  });

  it('sets batch status', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    await store.createManifest('run-1', makeBatch([makeTask({ id: 'a' })]));
    await store.setStatus('run-1', 'completed');
    const loaded = await store.loadManifest('run-1');
    expect(loaded?.status).toBe('completed');
  });

  it('persists a cross-process cancel request and clears it after settlement', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    await store.createManifest('run-1', makeBatch([makeTask({ id: 'a' })]));

    expect(await store.isCancelRequested('run-1')).toBe(false);
    expect(await store.requestCancel('run-1')).toBe(true);
    expect(await store.isCancelRequested('run-1')).toBe(true);

    await store.clearCancelRequest('run-1');
    expect(await store.isCancelRequested('run-1')).toBe(false);
  });

  it('resolves a cancellation wait from the filesystem event', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    await store.createManifest('run-1', makeBatch([makeTask({ id: 'a' })]));

    const wait = store.waitForCancel('run-1');
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(await store.requestCancel('run-1')).toBe(true);
    await expect(wait).resolves.toBe(true);
  });

  it('stops waiting when the cancellation signal is aborted', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    await store.createManifest('run-1', makeBatch([makeTask({ id: 'a' })]));
    const controller = new AbortController();
    const wait = store.waitForCancel('run-1', controller.signal);

    controller.abort();

    await expect(wait).resolves.toBe(false);
  });

  it('does not create a cancel request for a terminal batch', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    await store.createManifest('run-1', makeBatch([makeTask({ id: 'a' })]));
    await store.setStatus('run-1', 'completed');

    expect(await store.requestCancel('run-1')).toBe(false);
    expect(await store.isCancelRequested('run-1')).toBe(false);
  });

  it('reconciles running tasks without live children on restart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    await store.createManifest('run-1', makeBatch([makeTask({ id: 'a' })]));
    await store.recordResult('run-1', 'a', {
      runId: 'run-1',
      taskId: 'a',
      childSessionId: 'child-1',
      executionStatus: 'running',
      summaryStatus: 'not-requested',
      integrationStatus: 'not-requested',
    });
    // No live child → should be reconciled to failed.
    const reconciled = await store.reconcile('run-1', () => false);
    expect(reconciled?.results.a?.executionStatus).toBe('failed');
    expect(reconciled?.results.a?.error).toContain('interrupted');
  });

  it('does not reconcile tasks with live children', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    await store.createManifest('run-1', makeBatch([makeTask({ id: 'a' })]));
    await store.recordResult('run-1', 'a', {
      runId: 'run-1',
      taskId: 'a',
      childSessionId: 'child-1',
      executionStatus: 'running',
      summaryStatus: 'not-requested',
      integrationStatus: 'not-requested',
    });
    const reconciled = await store.reconcile('run-1', (id) => id === 'child-1');
    expect(reconciled?.results.a?.executionStatus).toBe('running');
  });

  it('returns undefined for unknown run id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    const loaded = await store.loadManifest('nonexistent');
    expect(loaded).toBeUndefined();
  });

  it('rejects unsafe run ids before deriving filesystem paths', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    await store.createManifest('run-1', makeBatch([makeTask({ id: 'a' })]));

    for (const unsafeId of ['../escape', 'a/b', 'a\\b', '..', '', ' run-1 ']) {
      await expect(store.loadManifest(unsafeId)).rejects.toThrow(/Invalid run id/);
      await expect(
        store.createManifest(unsafeId, makeBatch([makeTask({ id: 'a' })])),
      ).rejects.toThrow(/Invalid run id/);
      await expect(store.requestCancel(unsafeId)).rejects.toThrow(/Invalid run id/);
    }
  });

  it('creates manifests exclusively and reports duplicates', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    await store.createManifest('run-1', makeBatch([makeTask({ id: 'a' })]));
    await expect(store.createManifest('run-1', makeBatch([makeTask({ id: 'a' })]))).rejects.toThrow(
      SubagentRunManifestExistsError,
    );
  });

  it('surfaces corrupt manifests instead of treating them as missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    await store.createManifest('run-1', makeBatch([makeTask({ id: 'a' })]));
    await writeFile(join(dir, 'run-1.json'), '{truncated-json', 'utf8');

    await expect(store.loadManifest('run-1')).rejects.toThrow(SubagentRunManifestCorruptError);
    await expect(store.listManifests()).rejects.toThrow(SubagentRunManifestCorruptError);
  });

  it('persists manifests with owner-only permissions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-run-store-'));
    const store = createSubagentRunStore({ runsDir: dir });
    await store.createManifest('run-1', makeBatch([makeTask({ id: 'a' })]));

    const mode = (await stat(join(dir, 'run-1.json'))).mode & 0o777;
    expect(mode & 0o077).toBe(0);

    const raw = await readFile(join(dir, 'run-1.json'), 'utf8');
    expect(JSON.parse(raw).runId).toBe('run-1');
  });
});
