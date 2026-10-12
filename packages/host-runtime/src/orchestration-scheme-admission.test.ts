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

  it('admits after completed tasks exceed maxTasksPerRun', () => {
    expect(
      decideSchemeAdmission(
        { maxConcurrency: 4, maxTasksPerRun: 2 },
        { activeCount: 0, startedCount: 20 },
      ),
    ).toEqual({ kind: 'admit' });
  });

  it('waits when active tasks reach maxTasksPerRun', () => {
    expect(
      decideSchemeAdmission(
        { maxConcurrency: 4, maxTasksPerRun: 2 },
        { activeCount: 2, startedCount: 20 },
      ),
    ).toEqual({ kind: 'wait' });
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
  it('reuses slots for sequential tasks beyond the per-turn historical count', async () => {
    const gate = new TurnScopedSchemeAdmissionGate();
    gate.bind('run-1', { maxConcurrency: 8, maxTasksPerRun: 8 });

    for (let taskIndex = 0; taskIndex < 24; taskIndex += 1) {
      const lease = await gate.acquire('run-1');
      expect(lease).toBeDefined();
      expect(gate.getSnapshot('run-1')?.activeCount).toBe(1);
      lease?.release();
      expect(gate.getSnapshot('run-1')?.activeCount).toBe(0);
    }
    expect(gate.getSnapshot('run-1')?.startedCount).toBe(24);
  });

  it('keeps the ninth task waiting until one of eight active tasks releases', async () => {
    const gate = new TurnScopedSchemeAdmissionGate();
    gate.bind('run-8', { maxConcurrency: 8, maxTasksPerRun: 8 });
    const active = await Promise.all(Array.from({ length: 8 }, () => gate.acquire('run-8')));
    let admittedCount = 0;
    const waiting = Array.from({ length: 2 }, () =>
      gate.acquire('run-8').then((lease) => {
        admittedCount += 1;
        return lease;
      }),
    );
    await Promise.resolve();
    expect(admittedCount).toBe(0);
    expect(gate.getSnapshot('run-8')?.activeCount).toBe(8);

    active[0]?.release();
    const ninth = await waiting[0];
    expect(admittedCount).toBe(1);
    expect(gate.getSnapshot('run-8')?.activeCount).toBe(8);
    // A repeated release must not admit the tenth task.
    active[0]?.release();
    await Promise.resolve();
    expect(admittedCount).toBe(1);

    ninth?.release();
    const tenth = await waiting[1];
    expect(admittedCount).toBe(2);
    expect(gate.getSnapshot('run-8')?.activeCount).toBe(8);
    tenth?.release();
    for (const lease of active) lease?.release();
    expect(gate.getSnapshot('run-8')).toMatchObject({ activeCount: 0, startedCount: 10 });
  });

  it('waits at a lower task ceiling and reuses the released slot', async () => {
    const gate = new TurnScopedSchemeAdmissionGate();
    gate.bind('run-task-cap', { maxConcurrency: 4, maxTasksPerRun: 1 });
    const first = await gate.acquire('run-task-cap');
    let admitted = false;
    const waiting = gate.acquire('run-task-cap').then((lease) => {
      admitted = true;
      return lease;
    });
    await Promise.resolve();
    expect(admitted).toBe(false);
    first?.release();
    const second = await waiting;
    expect(admitted).toBe(true);
    expect(gate.getSnapshot('run-task-cap')?.activeCount).toBe(1);
    second?.release();
  });

  it('aborts a queued task without consuming a slot', async () => {
    const gate = new TurnScopedSchemeAdmissionGate();
    gate.bind('run-abort', { maxConcurrency: 1, maxTasksPerRun: 1 });
    const first = await gate.acquire('run-abort');
    const controller = new AbortController();
    const aborted = gate.acquire('run-abort', controller.signal);
    controller.abort();
    await expect(aborted).rejects.toThrow(/aborted/);
    first?.release();
    const next = await gate.acquire('run-abort');
    expect(gate.getSnapshot('run-abort')).toMatchObject({ activeCount: 1, startedCount: 2 });
    next?.release();
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
