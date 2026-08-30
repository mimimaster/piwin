import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SubagentResultSummary } from '@piwin/contracts';
import { createTurnChangeObjectStore, openTurnChangeStore } from '@piwin/git';
import { handleSubagentCommand, type SubagentCommandContext } from './commands/subagent-commands.js';
import {
  SUBAGENT_RESOLUTION_INSTRUCTION,
  createSubagentResultService,
} from './subagent-result-service.js';

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
});
