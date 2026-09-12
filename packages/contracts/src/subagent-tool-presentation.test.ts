import { describe, expect, it } from 'vitest';
import {
  SUBAGENT_CONTROL_ACTIVITY_MAX_CHARS,
  SUBAGENT_CONTROL_TASK_MAX_CHARS,
  boundSubagentControlDisplay,
  boundSubagentLoopControlDisplay,
  readSubagentControlDisplay,
  readSubagentLoopControlDisplay,
} from './subagent-tool-presentation.js';

describe('subagent-tool-presentation', () => {
  it('keeps start accepted display unchanged when continue fields are absent', () => {
    const accepted = boundSubagentControlDisplay({
      phase: 'accepted',
      runId: 'run-abc',
      invocationId: 'inv-123',
      task: 'Scout the auth module',
    });
    expect(accepted).toEqual({
      phase: 'accepted',
      runId: 'run-abc',
      invocationId: 'inv-123',
      task: 'Scout the auth module',
    });
    expect(readSubagentControlDisplay(accepted)).toEqual(accepted);
  });

  it('preserves continue linking ids on accepted and bounds the task', () => {
    const longTask = `Repair ${'x'.repeat(SUBAGENT_CONTROL_TASK_MAX_CHARS)}`;
    const display = boundSubagentControlDisplay({
      phase: 'accepted',
      runId: 'run-2',
      invocationId: 'inv-2',
      task: longTask,
      childSessionId: 'child-1',
      predecessorResult: { resultId: 'result-v1', revision: 1 },
      reviewRef: { reviewId: 'review-v1', revision: 1 },
    });
    expect(display.phase).toBe('accepted');
    if (display.phase !== 'accepted') throw new Error('expected accepted');
    expect(display.childSessionId).toBe('child-1');
    expect(display.predecessorResult).toEqual({ resultId: 'result-v1', revision: 1 });
    expect(display.reviewRef).toEqual({ reviewId: 'review-v1', revision: 1 });
    expect(display.task.length).toBeLessThanOrEqual(SUBAGENT_CONTROL_TASK_MAX_CHARS);
    expect(readSubagentControlDisplay(display)).toEqual(display);
  });

  it('bounds result-read summary while leaving result ids intact', () => {
    const resultId = `result-${'a'.repeat(80)}`;
    const display = boundSubagentLoopControlDisplay({
      kind: 'result-read',
      result: { resultId, revision: 3 },
      mode: 'summary',
      summary: `Result summary ${'y'.repeat(200)}`,
    });
    expect(display.kind).toBe('result-read');
    if (display.kind !== 'result-read') throw new Error('expected result-read');
    expect(display.result.resultId).toBe(resultId);
    expect(display.summary.length).toBeLessThanOrEqual(SUBAGENT_CONTROL_ACTIVITY_MAX_CHARS);
    expect(readSubagentLoopControlDisplay(display)).toEqual(display);
  });

  it('does not invent a review or verification decision from output-like text', () => {
    expect(
      readSubagentLoopControlDisplay({
        kind: 'review-submit',
        reviewRef: { reviewId: 'review-1', revision: 1 },
        target: { resultId: 'result-1', revision: 1 },
        output: 'approved',
      }),
    ).toBeUndefined();
    expect(
      readSubagentLoopControlDisplay({
        kind: 'verification-submit',
        result: { resultId: 'result-1', revision: 1 },
        verificationRef: { verificationId: 'ver-1', revision: 1 },
        output: 'passed',
      }),
    ).toBeUndefined();
    expect(
      readSubagentLoopControlDisplay({
        kind: 'review-submit',
        reviewRef: { reviewId: 'review-1', revision: 1 },
        decision: 'approved',
        target: { resultId: 'result-1', revision: 1 },
      }),
    ).toEqual({
      kind: 'review-submit',
      reviewRef: { reviewId: 'review-1', revision: 1 },
      decision: 'approved',
      target: { resultId: 'result-1', revision: 1 },
    });
  });

  it('does not mark failed verification as delivered', () => {
    const display = boundSubagentLoopControlDisplay({
      kind: 'verification-submit',
      result: { resultId: 'result-1', revision: 1 },
      verificationRef: { verificationId: 'ver-1', revision: 1 },
      status: 'failed',
    });
    expect(display).toEqual({
      kind: 'verification-submit',
      result: { resultId: 'result-1', revision: 1 },
      verificationRef: { verificationId: 'ver-1', revision: 1 },
      status: 'failed',
    });
    expect(display).not.toHaveProperty('delivered');
  });
});
