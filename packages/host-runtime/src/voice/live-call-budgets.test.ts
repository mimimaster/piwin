import { describe, expect, it } from 'vitest';
import {
  LIVE_RECONNECT_MAX,
  SlidingWindowBudget,
  createLiveReconnectBudget,
  createLiveStartBudget,
} from './live-call-budgets.js';

describe('Live sliding-window budgets', () => {
  it('allows a bounded burst then refuses until the window slides', () => {
    const budget = new SlidingWindowBudget(100, 2);
    expect(budget.tryConsume(1_000)).toBe(true);
    expect(budget.tryConsume(1_010)).toBe(true);
    expect(budget.tryConsume(1_020)).toBe(false);
    expect(budget.tryConsume(1_101)).toBe(true);
  });

  it('uses the reconnect budget of two attempts in ten seconds', () => {
    const budget = createLiveReconnectBudget();
    expect(LIVE_RECONNECT_MAX).toBe(2);
    expect(budget.tryConsume(0)).toBe(true);
    expect(budget.tryConsume(1)).toBe(true);
    expect(budget.tryConsume(2)).toBe(false);
  });

  it('resets start attempts after an explicit reset', () => {
    const budget = createLiveStartBudget();
    for (let index = 0; index < 5; index += 1) {
      expect(budget.tryConsume(0)).toBe(true);
    }
    expect(budget.tryConsume(0)).toBe(false);
    budget.reset();
    expect(budget.tryConsume(0)).toBe(true);
  });
});
