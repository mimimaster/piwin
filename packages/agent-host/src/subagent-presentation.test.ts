import { describe, expect, it } from 'vitest';
import {
  SUBAGENT_CONTROL_ACTIVITY_MAX_CHARS,
  SUBAGENT_CONTROL_TASK_MAX_CHARS,
} from '@piwin/contracts';
import { buildToolPresentation } from './tool-presentation.js';

const RESULT = { resultId: 'result-v1', revision: 1 };
const REVIEW = { reviewId: 'review-v1', revision: 1 };
const CHILD_ID = 'child-1';

describe('async subagent tool presentation', () => {
  it('maps start to a subagent invocation without implying child completion', () => {
    const presentation = buildToolPresentation({
      toolName: 'piwin_subagent_start',
      args: { task: 'Scout the auth module', role: 'explorer' },
      details: {
        runId: 'run-abc',
        invocationId: 'inv-123',
        status: 'accepted',
      },
      outputText:
        'subagent accepted (runId=run-abc, invocationId=inv-123); continue independent work',
    });

    expect(presentation.kind).toBe('subagent');
    expect(presentation.actionVerb).toBe('Delegated');
    expect(presentation.summary).toBe('Scout the auth module');
    expect(presentation.subagentControl).toEqual({
      phase: 'accepted',
      runId: 'run-abc',
      invocationId: 'inv-123',
      task: 'Scout the auth module',
    });
    expect(presentation.summary?.toLowerCase()).not.toContain('completed');
    expect(presentation.subagentControl?.phase).not.toBe('waited');
  });

  it('maps wait and cancel to control presentation without invocation topology', () => {
    const waiting = buildToolPresentation({
      toolName: 'piwin_subagent_wait',
      args: { runIds: ['run-a', 'run-b'] },
    });
    expect(waiting.kind).not.toBe('subagent');
    expect(waiting.subagentControl).toMatchObject({
      phase: 'waiting',
      total: 2,
      runs: [
        { runId: 'run-a', executionStatus: 'running' },
        { runId: 'run-b', executionStatus: 'running' },
      ],
    });

    const waited = buildToolPresentation({
      toolName: 'piwin_subagent_wait',
      args: { runIds: ['run-a'] },
      details: {
        controlDisplay: {
          phase: 'waited',
          total: 1,
          completed: 1,
          failed: 0,
          cancelled: 0,
          needsIntegration: 0,
          runs: [{ runId: 'run-a', executionStatus: 'completed' }],
        },
      },
    });
    expect(waited.kind).not.toBe('subagent');
    expect(waited.subagentControl?.phase).toBe('waited');

    const cancelling = buildToolPresentation({
      toolName: 'piwin_subagent_cancel',
      args: { runIds: ['run-z'] },
    });
    expect(cancelling.kind).not.toBe('subagent');
    expect(cancelling.subagentControl?.phase).toBe('cancelling');

    const cancelled = buildToolPresentation({
      toolName: 'piwin_subagent_cancel',
      args: { runIds: ['run-z'] },
      details: {
        controlDisplay: {
          phase: 'cancelled',
          total: 1,
          cancelled: 1,
          alreadyTerminal: 0,
          runs: [{ runId: 'run-z', executionStatus: 'cancelled' }],
        },
      },
    });
    expect(cancelled.kind).not.toBe('subagent');
    expect(cancelled.subagentControl?.phase).toBe('cancelled');
  });

  it('degrades malformed details to a generic bounded tool card', () => {
    const start = buildToolPresentation({
      toolName: 'piwin_subagent_start',
      args: { task: 'Do work' },
      details: { status: 'accepted', runId: 'only-run' },
      outputText: 'subagent accepted',
    });
    expect(start.subagentControl).toBeUndefined();
    expect(start.kind).toBe('subagent');
    expect(start.title).toBe('Subagent');

    const wait = buildToolPresentation({
      toolName: 'piwin_subagent_wait',
      args: { runIds: ['run-a'] },
      details: { phase: 'waited', total: 'not-a-number' },
      outputText: 'subagent wait (1 runs)\nrun-a:completed',
    });
    expect(wait.subagentControl?.phase).toBe('waiting');
    expect(wait.kind).toBe('other');
    expect(wait.output?.text).toContain('run-a:completed');
  });

  it('maps result-read and review-submit without invocation topology', () => {
    const resultRead = buildToolPresentation({
      toolName: 'piwin_subagent_result_read',
      args: { mode: 'summary', result: RESULT },
      details: {
        result: RESULT,
        reviewStatus: 'changes-requested',
      },
      outputText: 'result result-v1 rev 1 completed/retained',
    });
    expect(resultRead.kind).not.toBe('subagent');
    expect(resultRead.subagentControl).toBeUndefined();
    expect(resultRead.subagentLoop).toEqual({
      kind: 'result-read',
      result: RESULT,
      mode: 'summary',
      summary: 'Result summary',
    });

    const reviewSubmit = buildToolPresentation({
      toolName: 'piwin_subagent_review_submit',
      args: { target: RESULT, decision: 'approved' },
      details: {
        reviewRef: REVIEW,
        decision: 'approved',
        target: RESULT,
      },
      outputText: 'review review-v1 approved',
    });
    expect(reviewSubmit.kind).not.toBe('subagent');
    expect(reviewSubmit.subagentControl).toBeUndefined();
    expect(reviewSubmit.subagentLoop).toEqual({
      kind: 'review-submit',
      reviewRef: REVIEW,
      decision: 'approved',
      target: RESULT,
    });
  });

  it('maps continue as the same child with a new run id', () => {
    const start = buildToolPresentation({
      toolName: 'piwin_subagent_start',
      args: { task: 'Implement login' },
      details: {
        runId: 'run-1',
        invocationId: 'inv-1',
        status: 'accepted',
      },
    });
    const continued = buildToolPresentation({
      toolName: 'piwin_subagent_continue',
      args: {
        childSessionId: CHILD_ID,
        expectedResult: RESULT,
        review: REVIEW,
        task: 'Repair the login guard.',
      },
      details: {
        runId: 'run-2',
        invocationId: 'inv-2',
        status: 'accepted',
        childSessionId: CHILD_ID,
        predecessorResult: RESULT,
        reviewRef: REVIEW,
      },
    });

    expect(continued.kind).toBe('subagent');
    expect(continued.subagentControl).toEqual({
      phase: 'accepted',
      runId: 'run-2',
      invocationId: 'inv-2',
      task: 'Repair the login guard.',
      childSessionId: CHILD_ID,
      predecessorResult: RESULT,
      reviewRef: REVIEW,
    });
    expect(start.subagentControl).toEqual({
      phase: 'accepted',
      runId: 'run-1',
      invocationId: 'inv-1',
      task: 'Implement login',
    });
  });

  it('maps apply and verification without invocation topology; failed is not delivered', () => {
    const applied = buildToolPresentation({
      toolName: 'piwin_subagent_result_apply',
      args: { result: RESULT, approvedBy: REVIEW },
      details: {
        operationId: 'op-1',
        result: RESULT,
        integrationStatus: 'applied',
      },
      outputText: 'subagent result applied (operationId=op-1, resultId=result-v1, status=applied)',
    });
    expect(applied.kind).not.toBe('subagent');
    expect(applied.subagentControl).toBeUndefined();
    expect(applied.subagentLoop).toEqual({
      kind: 'result-apply',
      result: RESULT,
      operationId: 'op-1',
      integrationStatus: 'applied',
    });

    const failed = buildToolPresentation({
      toolName: 'piwin_subagent_verification_submit',
      args: { result: RESULT, status: 'passed' },
      details: {
        verificationRef: { verificationId: 'ver-1', revision: 1 },
        status: 'failed',
      },
      outputText: 'passed',
    });
    expect(failed.kind).not.toBe('subagent');
    expect(failed.subagentControl).toBeUndefined();
    expect(failed.subagentLoop).toEqual({
      kind: 'verification-submit',
      result: RESULT,
      verificationRef: { verificationId: 'ver-1', revision: 1 },
      status: 'failed',
    });
    expect(failed.subagentLoop).not.toHaveProperty('delivered');
    expect(failed.summary?.toLowerCase()).not.toContain('delivered');
    expect(failed.actionVerb?.toLowerCase()).not.toContain('delivered');
    expect(failed.summary).toBe('failed');
  });

  it('bounds user-facing summaries and keeps ids in the structured field', () => {
    const resultId = `result-${'a'.repeat(80)}`;
    const longTask = `Repair ${'x'.repeat(SUBAGENT_CONTROL_TASK_MAX_CHARS)}`;
    const continued = buildToolPresentation({
      toolName: 'piwin_subagent_continue',
      args: {
        childSessionId: CHILD_ID,
        expectedResult: { resultId, revision: 1 },
        review: REVIEW,
        task: longTask,
      },
      details: {
        runId: 'run-2',
        invocationId: 'inv-2',
        status: 'accepted',
        childSessionId: CHILD_ID,
        predecessorResult: { resultId, revision: 1 },
        reviewRef: REVIEW,
      },
    });
    expect(continued.summary?.length).toBeLessThanOrEqual(SUBAGENT_CONTROL_TASK_MAX_CHARS);
    expect(continued.subagentControl?.phase).toBe('accepted');
    if (continued.subagentControl?.phase !== 'accepted') throw new Error('expected accepted');
    expect(continued.subagentControl.predecessorResult?.resultId).toBe(resultId);
    expect(continued.subagentControl.childSessionId).toBe(CHILD_ID);

    const resultRead = buildToolPresentation({
      toolName: 'piwin_subagent_result_read',
      args: { mode: 'diff', result: { resultId, revision: 2 } },
      details: { result: { resultId, revision: 2 } },
    });
    expect(resultRead.summary?.length).toBeLessThanOrEqual(SUBAGENT_CONTROL_ACTIVITY_MAX_CHARS);
    expect(resultRead.subagentLoop).toMatchObject({
      kind: 'result-read',
      result: { resultId, revision: 2 },
      mode: 'diff',
    });
    if (resultRead.subagentLoop?.kind !== 'result-read') throw new Error('expected result-read');
    expect(resultRead.subagentLoop.result.resultId).toBe(resultId);
  });

  it('degrades malformed loop details and does not treat output text as a decision', () => {
    const review = buildToolPresentation({
      toolName: 'piwin_subagent_review_submit',
      args: { target: RESULT, decision: 'approved' },
      details: {
        reviewRef: REVIEW,
        target: RESULT,
      },
      outputText: 'approved',
    });
    expect(review.kind).toBe('other');
    expect(review.subagentLoop).toBeUndefined();
    expect(review.subagentControl).toBeUndefined();
    expect(review.actionVerb).not.toBe('Reviewed');

    const verification = buildToolPresentation({
      toolName: 'piwin_subagent_verification_submit',
      args: { result: RESULT, status: 'passed' },
      details: {
        verificationRef: { verificationId: 'ver-1', revision: 1 },
        result: RESULT,
      },
      outputText: 'passed',
    });
    expect(verification.kind).toBe('other');
    expect(verification.subagentLoop).toBeUndefined();
    expect(verification.actionVerb).not.toBe('Verified');
    expect(verification.summary).not.toBe('passed');
  });
});
