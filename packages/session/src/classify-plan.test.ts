import { describe, expect, it } from 'vitest';
import {
  classifyPlanComplexity,
  isWithinPlanSizeLimits,
  recommendedPlanExecutionMode,
  LONG_PLAN_INDEPENDENT_THRESHOLD,
  LONG_PLAN_STEP_THRESHOLD,
} from './classify-plan.js';
import type { PlanStep, SessionPlan } from '@piwin/contracts';

function step(id: string): PlanStep {
  return { id, title: `Step ${id}`, status: 'pending' };
}

function plan(steps: PlanStep[], independentSteps?: string[]): Pick<SessionPlan, 'steps' | 'independentSteps'> {
  return { steps, ...(independentSteps ? { independentSteps } : {}) };
}

describe('classifyPlanComplexity', () => {
  it('classifies a 3-step plan as short', () => {
    expect(classifyPlanComplexity(plan([step('1'), step('2'), step('3')]))).toBe('short');
  });

  it('classifies a 4-step plan as long', () => {
    expect(
      classifyPlanComplexity(plan([step('1'), step('2'), step('3'), step('4')])),
    ).toBe('long');
  });

  it('classifies a 2-step plan with 2 valid independent steps as long', () => {
    expect(classifyPlanComplexity(plan([step('1'), step('2')], ['1', '2']))).toBe('long');
  });

  it('classifies a 2-step plan with only 1 valid independent step as short', () => {
    expect(classifyPlanComplexity(plan([step('1'), step('2')], ['1']))).toBe('short');
  });

  it('ignores independent ids that do not match any step id', () => {
    expect(classifyPlanComplexity(plan([step('1'), step('2')], ['1', 'ghost']))).toBe('short');
  });

  it('classifies a 1-step plan as short even with independent ids', () => {
    expect(classifyPlanComplexity(plan([step('1')], ['1']))).toBe('short');
  });

  it('thresholds are stable', () => {
    expect(LONG_PLAN_STEP_THRESHOLD).toBe(4);
    expect(LONG_PLAN_INDEPENDENT_THRESHOLD).toBe(2);
  });
});

describe('recommendedPlanExecutionMode', () => {
  it('recommends inline for short plans', () => {
    expect(recommendedPlanExecutionMode({ complexity: 'short', steps: [step('1')] })).toBe(
      'inline',
    );
  });

  it('recommends subagent-driven for long plans with independent steps', () => {
    expect(
      recommendedPlanExecutionMode({
        complexity: 'long',
        steps: [step('1'), step('2')],
        independentSteps: ['1'],
      }),
    ).toBe('subagent-driven');
  });

  it('recommends inline for long plans with no independent steps', () => {
    expect(
      recommendedPlanExecutionMode({
        complexity: 'long',
        steps: [step('1'), step('2'), step('3'), step('4')],
      }),
    ).toBe('inline');
  });
});

describe('isWithinPlanSizeLimits', () => {
  it('allows plans under the step cap', () => {
    expect(isWithinPlanSizeLimits(plan(Array.from({ length: 32 }, (_, i) => step(String(i + 1)))))).toBe(true);
  });

  it('rejects plans over the step cap', () => {
    expect(isWithinPlanSizeLimits(plan(Array.from({ length: 33 }, (_, i) => step(String(i + 1)))))).toBe(false);
  });

  it('rejects plans over the independent step cap', () => {
    const ids = Array.from({ length: 33 }, (_, i) => String(i + 1));
    expect(isWithinPlanSizeLimits(plan([step('1')], ids))).toBe(false);
  });
});

