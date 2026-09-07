import { describe, expect, it } from 'vitest';
import { createExclusiveQueue } from './mutex.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createExclusiveQueue', () => {
  it('serializes concurrent operations (no interleaving)', async () => {
    const { runExclusive } = createExclusiveQueue();
    const order: string[] = [];

    const gate = deferred<void>();

    // First op starts immediately and blocks on `gate`.
    const first = runExclusive(async () => {
      order.push('first:start');
      await gate.promise;
      order.push('first:end');
      return 1;
    });

    // Two more ops queue behind the first.
    const second = runExclusive(async () => {
      order.push('second');
      return 2;
    });
    const third = runExclusive(async () => {
      order.push('third');
      return 3;
    });

    // Give queued promises a tick to settle; they must not run yet.
    await Promise.resolve();
    expect(order).toEqual(['first:start']);

    gate.resolve();
    const results = await Promise.all([first, second, third]);

    expect(results).toEqual([1, 2, 3]);
    expect(order).toEqual(['first:start', 'first:end', 'second', 'third']);
  });

  it('does not wedge the queue when an operation rejects', async () => {
    const { runExclusive } = createExclusiveQueue();

    const failing = runExclusive(async () => {
      throw new Error('boom');
    });
    await expect(failing).rejects.toThrow('boom');

    const after = await runExclusive(async () => 'ok');
    expect(after).toBe('ok');
  });

  it('does not start an operation aborted while queued', async () => {
    const { runExclusive } = createExclusiveQueue();
    const gate = deferred<void>();
    const started = deferred<void>();

    const first = runExclusive(async () => {
      started.resolve();
      await gate.promise;
      return 'first';
    });
    await started.promise;

    const abort = new AbortController();
    let ran = false;
    const second = runExclusive(async () => {
      ran = true;
      return 'second';
    }, abort.signal);

    abort.abort();
    gate.resolve();
    await first;
    await expect(second).rejects.toThrow('aborted');
    expect(ran).toBe(false);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const { runExclusive } = createExclusiveQueue();
    const abort = new AbortController();
    abort.abort();
    let ran = false;
    await expect(
      runExclusive(async () => {
        ran = true;
        return 'nope';
      }, abort.signal),
    ).rejects.toThrow('aborted');
    expect(ran).toBe(false);
    expect(await runExclusive(async () => 'ok')).toBe('ok');
  });
});
