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
import { createSubagentRunStore } from '@piwin/session';
import { createSubagentResultService } from './subagent-result-service.js';
import { createSubagentVerificationService } from './subagent-verification-service.js';
import type { SubagentRunSeam } from './subagent-run-tool.js';
import {
  SUBAGENT_VERIFICATION_SUBMIT_TOOL_NAME,
  createSubagentVerificationSubmitTool,
} from './subagent-verification-submit-tool.js';

const dirs: string[] = [];
const SESSION_ID = 'parent-1';
const TARGET = { resultId: 'result-1', revision: 1 };
const CHANGES = { changeSetId: 'cs-child', revision: 1 };
const APPROVED_BY = { reviewId: 'review-1', revision: 1 };
const APPLY_OP = 'op-applied';

function makeSummary(overrides: Partial<SubagentResultSummary> = {}): SubagentResultSummary {
  return {
    resultId: 'result-1',
    revision: 1,
    parentSessionId: SESSION_ID,
    childSessionId: 'worker-child',
    taskId: 'worker-task',
    batchRunId: 'worker-run',
    sourceAttemptId: null,
    targetWorkspaceId: 'ws-1',
    deliveryIntent: 'candidate',
    legacyManual: false,
    candidateGroupId: null,
    ...emptySubagentResultReviewFields(),
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

function makeReview(): SubagentReviewRecord {
  return {
    reviewId: APPROVED_BY.reviewId,
    revision: 1,
    parentSessionId: SESSION_ID,
    reviewerSessionId: 'reviewer-child',
    reviewerRunId: 'reviewer-run',
    targetResult: TARGET,
    targetChanges: CHANGES,
    decision: 'approved',
    findings: [],
    verification: [{ label: 'reviewer-local', status: 'not-run' }],
    createdAt: '2026-09-13T01:00:00.000Z',
  };
}

function dummySeam(
  submitVerification: NonNullable<SubagentRunSeam['submitVerification']>,
): SubagentRunSeam {
  return {
    spawn: async () => {
      throw new Error('unused');
    },
    merge: async () => ({}),
    submitVerification,
  };
}

async function executeTool(
  tool: HostToolRegistration,
  args: Record<string, unknown>,
  sessionId = SESSION_ID,
): Promise<ToolResult> {
  return tool.execute(args, new AbortController().signal, {
    sessionId,
    runtimeGenerationId: 'gen-1',
    runId: 'parent-verify-run',
    toolName: SUBAGENT_VERIFICATION_SUBMIT_TOOL_NAME,
  });
}

async function setupTool() {
  const dir = await mkdtemp(join(tmpdir(), 'piwin-verification-submit-'));
  dirs.push(dir);
  const store = createSubagentRunStore({ runsDir: dir });
  const resultService = createSubagentResultService();
  resultService.register(makeSummary());
  await store.createManifest('worker-run', {
    parentSessionId: SESSION_ID,
    tasks: [{ id: 'worker-task', parentSessionId: SESSION_ID, task: 'implement' }],
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
  });
  await store.createManifest('reviewer-run', {
    parentSessionId: SESSION_ID,
    tasks: [{ id: 'reviewer-task', parentSessionId: SESSION_ID, task: 'review' }],
  });
  await store.persistReviewerDecision('reviewer-run', 'reviewer-task', makeReview());
  const service = createSubagentVerificationService({
    runStore: store,
    resultService,
    createId: () => 'verify-1',
    now: () => new Date('2026-09-13T03:00:00.000Z'),
  });
  const tool = createSubagentVerificationSubmitTool({
    sessionId: SESSION_ID,
    seam: dummySeam(async (input) => service.submit(input)),
  });
  return { tool, resultService };
}

const validArgs = {
  result: TARGET,
  approvedBy: APPROVED_BY,
  applyOperationId: APPLY_OP,
  status: 'passed',
  checks: [{ label: 'typecheck', status: 'passed', evidence: 'tsc ok' }],
};

describe('piwin_subagent_verification_submit', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('is parent evidence-only and not write-capable', async () => {
    const { tool } = await setupTool();
    expect(tool.descriptor.name).toBe(SUBAGENT_VERIFICATION_SUBMIT_TOOL_NAME);
    expect(tool.permissionSpec.action).toBe('subagent:run');
    expect(tool.permissionSpec.action).not.toBe('file-write');
    expect(tool.fileEffect).toBeUndefined();
  });

  it('returns verificationRef and status after persist', async () => {
    const { tool, resultService } = await setupTool();
    const result = await executeTool(tool, validArgs);
    expect(result).toMatchObject({
      ok: true,
      details: {
        runId: 'parent-verify-run',
        verificationRef: { verificationId: 'verify-1', revision: 1 },
        status: 'passed',
      },
    });
    expect(resultService.get('result-1')?.latestVerification).toEqual({
      verificationId: 'verify-1',
      revision: 1,
    });
  });

  it('rejects model-supplied appliedChanges and reviewer-local not-run', async () => {
    const { tool, resultService } = await setupTool();
    expect(
      await executeTool(tool, { ...validArgs, appliedChanges: CHANGES }),
    ).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(
      await executeTool(tool, { ...validArgs, status: 'not-run' }),
    ).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(
      await executeTool(tool, {
        ...validArgs,
        checks: [{ label: 'typecheck', status: 'not-run', evidence: 'skipped' }],
      }),
    ).toMatchObject({ ok: false, code: 'invalid-input' });
    expect(resultService.get('result-1')?.latestVerification).toBeNull();
    expect(resultService.get('result-1')?.integrationStatus).toBe('applied');
  });

  it('failed verification does not roll back apply', async () => {
    const { tool, resultService } = await setupTool();
    const result = await executeTool(tool, {
      ...validArgs,
      status: 'failed',
      checks: [{ label: 'typecheck', status: 'failed', evidence: 'tsc failed' }],
    });
    expect(result).toMatchObject({
      ok: true,
      details: {
        verificationRef: { verificationId: 'verify-1', revision: 1 },
        status: 'failed',
      },
    });
    expect(resultService.get('result-1')?.integrationStatus).toBe('applied');
    expect(resultService.get('result-1')?.appliedChanges).toEqual(CHANGES);
    expect(resultService.get('result-1')?.latestOperationId).toBe(APPLY_OP);
  });
});
