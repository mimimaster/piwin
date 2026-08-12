import { describe, expect, it } from 'vitest';
import type { SubagentTaskResult } from '@piwin/contracts';
import {
  invocationActivityForResult,
  invocationStatusForResult,
} from './subagent-invocation-state.js';

function result(
  overrides: Partial<SubagentTaskResult> = {},
): SubagentTaskResult {
  return {
    runId: 'run-1',
    taskId: 'task-1',
    executionStatus: 'completed',
    summaryStatus: 'merged',
    integrationStatus: 'not-requested',
    ...overrides,
  };
}

describe('subagent invocation terminal projection', () => {
  it('distinguishes completed execution from unresolved retained changes', () => {
    const retained = result({ integrationStatus: 'retained' });
    expect(invocationStatusForResult(retained)).toBe('needs-integration');
    expect(invocationActivityForResult(retained)).toEqual({ kind: 'needs-integration' });
  });

  it('keeps an integration conflict actionable in the parent transcript', () => {
    const conflicted = result({
      integrationStatus: 'conflict',
      error: 'merge conflict in src/app.ts',
    });
    expect(invocationStatusForResult(conflicted)).toBe('needs-integration');
    expect(invocationActivityForResult(conflicted)).toEqual({
      kind: 'needs-integration',
      message: 'merge conflict in src/app.ts',
    });
  });

  it('returns completed after changes are applied and failed after integration failure', () => {
    expect(invocationStatusForResult(result({ integrationStatus: 'applied' }))).toBe(
      'completed',
    );
    expect(invocationStatusForResult(result({ integrationStatus: 'failed' }))).toBe('failed');
  });
});
