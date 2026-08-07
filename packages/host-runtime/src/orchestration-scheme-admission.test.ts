import { describe, expect, it } from 'vitest';
import {
  decideSchemeAdmission,
  TurnScopedSchemeAdmissionGate,
} from './orchestration-scheme-admission.js';

describe('decideSchemeAdmission', () => {
  it('admits when no limits (Off / unbound)', () => {
    expect(decideSchemeAdmission(undefined, { activeCount: 99, startedCount: 99 })).toEqual({
      kind: 'admit',
    });
  });

  it('rejects when maxTasksPerRun is exhausted', () => {
    const decision = decideSchemeAdmission(
      { maxConcurrency: 4, maxTasksPerRun: 2 },
      { activeCount: 0, startedCount: 2 },
    );
    expect(decision.kind).toBe('reject');
    if (decision.kind === 'reject') {
      expect(decision.reason).toMatch(/maxTasksPerRun/);
    }
  });

  it('waits when at concurrency ceiling but under task cap', () => {
    expect(
      decideSchemeAdmission(
        { maxConcurrency: 2, maxTasksPerRun: 8 },
        { activeCount: 2, startedCount: 2 },
      ),
    ).toEqual({ kind: 'wait' });
  });

  it('admits under both ceilings', () => {
    expect(
      decideSchemeAdmission(
        { maxConcurrency: 2, maxTasksPerRun: 8 },
        { activeCount: 1, startedCount: 3 },
      ),
    ).toEqual({ kind: 'admit' });
  });
});

describe('TurnScopedSchemeAdmissionGate', () => {
  it('enforces maxTasksPerRun across sequential acquires', async () => {
    const gate = new TurnScopedSchemeAdmissionGate();
    gate.bind('run-1', { maxConcurrency: 4, maxTasksPerRun: 2 });

    const first = await gate.acquire('run-1');
    const second = await gate.acquire('run-1');
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    await expect(gate.acquire('run-1')).rejects.toThrow(/maxTasksPerRun/);

    first?.release();
    second?.release();
    // Releases do not free the tasks-per-run budget.
    await expect(gate.acquire('run-1')).rejects.toThrow(/maxTasksPerRun/);
  });

  it('waits on concurrency then admits after release', async () => {
    const gate = new TurnScopedSchemeAdmissionGate();
    gate.bind('run-2', { maxConcurrency: 1, maxTasksPerRun: 4 });

    const first = await gate.acquire('run-2');
    expect(first).toBeDefined();

    let secondResolved = false;
    const secondPromise = gate.acquire('run-2').then((lease) => {
      secondResolved = true;
      return lease;
    });

    // Give the waiter a turn; it must still be blocked.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(secondResolved).toBe(false);

    first?.release();
    const second = await secondPromise;
    expect(secondResolved).toBe(true);
    second?.release();

    const snapshot = gate.getSnapshot('run-2');
    expect(snapshot?.activeCount).toBe(0);
    expect(snapshot?.startedCount).toBe(2);
  });

  it('unbound runId skips all scheme admission work', async () => {
    const gate = new TurnScopedSchemeAdmissionGate();
    const lease = await gate.acquire('no-scheme-run');
    expect(lease).toBeUndefined();
  });

  it('clear rejects waiters and drops binding', async () => {
    const gate = new TurnScopedSchemeAdmissionGate();
    gate.bind('run-3', { maxConcurrency: 1, maxTasksPerRun: 8 });
    const first = await gate.acquire('run-3');
    const waiting = gate.acquire('run-3');
    gate.clear('run-3');
    await expect(waiting).rejects.toThrow(/parent run ended/);
    first?.release();
    expect(gate.getSnapshot('run-3')).toBeUndefined();
  });
});
