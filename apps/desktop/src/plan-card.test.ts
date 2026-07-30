import { describe, expect, it } from 'vitest';
import { planStepVisual } from './plan-card';

describe('planStepVisual', () => {
  it('maps contract status to visual state', () => {
    expect(planStepVisual('done')).toBe('done');
    expect(planStepVisual('active')).toBe('run');
    expect(planStepVisual('pending')).toBe('pending');
    expect(planStepVisual('skipped')).toBe('skipped');
  });
});
