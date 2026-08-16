import { describe, expect, it } from 'vitest';
import type { ExecutionRunRecord } from '@piwin/contracts';
import { planRunReconcile } from './run-reconcile.js';

function run(status: ExecutionRunRecord['status']): ExecutionRunRecord {
  return {
    runId: 'run-1',
    kind: 'session-turn',
    rootRunId: 'run-1',
    sessionId: 'session-1',
    status,
    phase: 'streaming',
  };
}

describe('planRunReconcile', () => {
  it('does nothing when the Host query has no usable answer', () => {
    expect(planRunReconcile(undefined)).toBe('none');
  });

  it('clears stale streaming when the registry has no foreground run', () => {
    expect(planRunReconcile(null)).toBe('clear-stale');
  });

  it('does nothing while the Host still reports an active run', () => {
    expect(planRunReconcile(run('running'))).toBe('none');
    expect(planRunReconcile(run('cancelling'))).toBe('none');
  });

  it('applies the terminal record for every terminal status', () => {
    expect(planRunReconcile(run('completed'))).toBe('apply-terminal');
    expect(planRunReconcile(run('failed'))).toBe('apply-terminal');
    expect(planRunReconcile(run('cancelled'))).toBe('apply-terminal');
    expect(planRunReconcile(run('interrupted'))).toBe('apply-terminal');
  });
});
