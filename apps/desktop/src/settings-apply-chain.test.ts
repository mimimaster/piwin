import { describe, expect, it } from 'vitest';
import { createSettingsApplyChain } from './settings-apply-chain.js';

describe('createSettingsApplyChain', () => {
  it('runs overlapping operations one at a time', async () => {
    const chain = createSettingsApplyChain();
    let inFlight = 0;
    let peak = 0;
    const order: number[] = [];

    const operation = async (id: number): Promise<void> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      order.push(id);
      await new Promise((resolve) => {
        setTimeout(resolve, 15);
      });
      inFlight -= 1;
    };

    await Promise.all([
      chain.enqueue(() => operation(1)),
      chain.enqueue(() => operation(2)),
      chain.enqueue(() => operation(3)),
    ]);

    expect(peak).toBe(1);
    expect(order).toEqual([1, 2, 3]);
  });

  it('still runs the next operation after a failure', async () => {
    const chain = createSettingsApplyChain();
    const seen: string[] = [];

    const failed = chain.enqueue(async () => {
      seen.push('fail');
      throw new Error('boom');
    });
    const ok = chain.enqueue(async () => {
      seen.push('ok');
      return 7;
    });

    await expect(failed).rejects.toThrow('boom');
    await expect(ok).resolves.toBe(7);
    expect(seen).toEqual(['fail', 'ok']);
  });
});
