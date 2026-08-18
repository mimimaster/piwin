import { describe, expect, it } from 'vitest';
import type { ForegroundRunMismatchProblem, HostResponse } from './index.js';

describe('HostProblem', () => {
  it('attaches a typed foreground mismatch without replacing error text', () => {
    const problem: ForegroundRunMismatchProblem = {
      code: 'foreground-run-mismatch',
      data: { reason: 'active', actualRun: { runId: 'run-a', status: 'running' } },
    };
    const response: HostResponse = {
      type: 'response',
      command: 'session/prompt',
      success: false,
      error: 'foreground-run-mismatch: session is busy',
      problem,
    };
    expect(response.success).toBe(false);
    if (!response.success) {
      expect(response.problem?.code).toBe('foreground-run-mismatch');
    }
  });
});
