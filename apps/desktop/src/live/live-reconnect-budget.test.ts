import { describe, expect, it } from 'vitest';
import { LiveReconnectBudget } from './live-reconnect-budget.js';

describe('LiveReconnectBudget', () => {
  it('allows two reconnects in ten seconds', () => {
    const budget = new LiveReconnectBudget();
    expect(budget.tryConsume(0)).toBe(true);
    expect(budget.tryConsume(1)).toBe(true);
    expect(budget.tryConsume(2)).toBe(false);
    expect(budget.tryConsume(10_001)).toBe(true);
    expect(budget.remaining(10_001)).toBe(1);
  });
});
