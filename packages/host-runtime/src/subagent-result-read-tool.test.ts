import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { emptySubagentResultReviewFields, type SubagentResultSummary, type ToolResult } from '@piwin/contracts';
import { createTurnChangeObjectStore, openTurnChangeStore } from '@piwin/git';
import { createSubagentResultService } from './subagent-result-service.js';
import {
  SUBAGENT_RESULT_READ_PATCH_MAX_CHARS,
  SUBAGENT_RESULT_READ_TOOL_NAME,
  createSubagentResultReadTool,
} from './subagent-result-read-tool.js';

const dirs: string[] = [];

function makeSummary(overrides: Partial<SubagentResultSummary> = {}): SubagentResultSummary {
  return {
    resultId: 'result-1',
    revision: 1,
    parentSessionId: 'parent-1',
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

const SCOPE = {
  result: { resultId: 'result-1', revision: 1 },
  changes: { changeSetId: 'cs-child', revision: 1 },
};

async function execute(
  tool: ReturnType<typeof createSubagentResultReadTool>,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return tool.execute(args, new AbortController().signal, {
    sessionId: 'reviewer-1',
    runtimeGenerationId: 'gen-1',
    runId: 'run-review',
    toolName: SUBAGENT_RESULT_READ_TOOL_NAME,
  });
}

describe('piwin_subagent_result_read', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('reads summary, file list, and diff for the exact bound target', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-result-read-'));
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
    if (!file) throw new Error('expected published file');
    const service = createSubagentResultService({ changeStore: store, objectStore });
    service.register(makeSummary());
    const tool = createSubagentResultReadTool({ scope: SCOPE, resultService: service });

    const summary = await execute(tool, { mode: 'summary', result: SCOPE.result });
    expect(summary).toMatchObject({
      ok: true,
      details: { result: SCOPE.result, childChanges: SCOPE.changes },
    });

    const files = await execute(tool, { mode: 'files', result: SCOPE.result });
    expect(files).toMatchObject({
      ok: true,
      details: {
        files: [{ fileId: file.fileId, relativePath: 'a.txt', kind: 'modified' }],
        truncated: false,
      },
    });

    const diff = await execute(tool, {
      mode: 'diff',
      result: SCOPE.result,
      fileId: file.fileId,
    });
    expect(diff.ok).toBe(true);
    if (diff.ok) {
      expect(diff.details).toMatchObject({ binary: false, truncated: false });
      expect(String(diff.details?.patch)).toContain('a.txt');
    }
    store.close();
  });

  it('denies another result in the same session', async () => {
    const service = createSubagentResultService();
    service.register(makeSummary());
    service.register(makeSummary({ resultId: 'result-2', childChanges: { changeSetId: 'cs-2', revision: 1 } }));
    const tool = createSubagentResultReadTool({ scope: SCOPE, resultService: service });
    const denied = await execute(tool, {
      mode: 'summary',
      result: { resultId: 'result-2', revision: 1 },
    });
    expect(denied).toMatchObject({ ok: false, code: 'review-target-forbidden' });
  });

  it('degrades stale revision, unknown file id, binary, and truncated patches', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-result-read-degrade-'));
    dirs.push(rootDir);
    const store = openTurnChangeStore({ rootDir });
    const objectStore = createTurnChangeObjectStore({ rootDir });
    const textBefore = await store.putObject(new TextEncoder().encode('old\n'));
    const hugeAfter = await store.putObject(
      new TextEncoder().encode(`${'line\n'.repeat(SUBAGENT_RESULT_READ_PATCH_MAX_CHARS)}\n`),
    );
    const binaryAfter = await store.putObject(new Uint8Array([0x00, 0x01, 0xff]));
    const published = store.publishChangeVersion({
      changeSetId: 'cs-child',
      revision: 1,
      coverageComplete: true,
      files: [
        {
          relativePath: 'huge.txt',
          beforeSha: textBefore.sha256,
          afterSha: hugeAfter.sha256,
          beforeExists: true,
          afterExists: true,
        },
        {
          relativePath: 'blob.bin',
          beforeSha: textBefore.sha256,
          afterSha: binaryAfter.sha256,
          beforeExists: true,
          afterExists: true,
        },
      ],
    });
    const huge = published.files.find((file) => file.relativePath === 'huge.txt');
    const binary = published.files.find((file) => file.relativePath === 'blob.bin');
    if (!huge || !binary) throw new Error('expected published files');
    const service = createSubagentResultService({ changeStore: store, objectStore });
    service.register(makeSummary());
    const tool = createSubagentResultReadTool({ scope: SCOPE, resultService: service });

    expect(
      await execute(tool, { mode: 'summary', result: { resultId: 'result-1', revision: 9 } }),
    ).toMatchObject({ ok: false, code: 'review-target-forbidden' });

    const staleService = createSubagentResultService({ changeStore: store, objectStore });
    staleService.register(makeSummary({ revision: 2 }));
    const staleTool = createSubagentResultReadTool({
      scope: { result: { resultId: 'result-1', revision: 1 }, changes: SCOPE.changes },
      resultService: staleService,
    });
    expect(await execute(staleTool, { mode: 'summary', result: SCOPE.result })).toMatchObject({
      ok: false,
      code: 'stale-revision',
    });

    expect(
      await execute(tool, { mode: 'diff', result: SCOPE.result, fileId: 'missing-file' }),
    ).toMatchObject({ ok: false, code: 'review-target-not-found' });

    const binaryDiff = await execute(tool, {
      mode: 'diff',
      result: SCOPE.result,
      fileId: binary.fileId,
    });
    expect(binaryDiff).toMatchObject({
      ok: true,
      details: { binary: true, truncated: false },
    });
    if (binaryDiff.ok) expect(binaryDiff.details?.patch).toBeUndefined();

    const truncated = await execute(tool, {
      mode: 'diff',
      result: SCOPE.result,
      fileId: huge.fileId,
    });
    expect(truncated.ok).toBe(true);
    if (truncated.ok) {
      expect(truncated.details?.truncated).toBe(true);
      expect(String(truncated.details?.patch).length).toBeLessThanOrEqual(
        SUBAGENT_RESULT_READ_PATCH_MAX_CHARS,
      );
    }
    store.close();
  });

  it('uses the bound change revision when result and change revisions diverge', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-result-read-rev-'));
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
    if (!file) throw new Error('expected published file');
    const service = createSubagentResultService({ changeStore: store, objectStore });
    service.register(makeSummary({ revision: 2, childChanges: { changeSetId: 'cs-child', revision: 1 } }));
    const scope = {
      result: { resultId: 'result-1', revision: 2 },
      changes: { changeSetId: 'cs-child', revision: 1 },
    };
    const tool = createSubagentResultReadTool({ scope, resultService: service });

    const files = await execute(tool, { mode: 'files', result: scope.result });
    expect(files).toMatchObject({
      ok: true,
      details: {
        files: [{ fileId: file.fileId, relativePath: 'a.txt', kind: 'modified' }],
        truncated: false,
      },
    });

    const diff = await execute(tool, {
      mode: 'diff',
      result: scope.result,
      fileId: file.fileId,
    });
    expect(diff.ok).toBe(true);
    if (diff.ok) {
      expect(diff.details).toMatchObject({ binary: false, truncated: false });
      expect(String(diff.details?.patch)).toContain('a.txt');
    }
    store.close();
  });

  it('fails closed when bound changes no longer match the frozen summary', async () => {
    const service = createSubagentResultService();
    service.register(makeSummary({ childChanges: { changeSetId: 'cs-other', revision: 1 } }));
    const tool = createSubagentResultReadTool({ scope: SCOPE, resultService: service });
    expect(await execute(tool, { mode: 'files', result: SCOPE.result })).toMatchObject({
      ok: false,
      code: 'review-data-expired',
    });
  });
});
