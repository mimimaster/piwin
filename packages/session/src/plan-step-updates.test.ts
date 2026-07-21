import { describe, expect, it } from 'vitest';
import type { SessionPlan } from '@piwin/contracts';
import {
  applyPlanStatus,
  applyPlanStepUpdate,
  markNextPlanStepActive,
} from './plan-step-updates.js';

function samplePlan(overrides: Partial<SessionPlan> = {}): SessionPlan {
  return {
    id: 'p1',
    sessionId: 's1',
    projectPath: '/tmp',
    status: 'approved',
    title: 'T',
    goal: 'G',
    steps: [
      { id: '1', title: 'A', status: 'pending' },
      { id: '2', title: 'B', status: 'pending' },
    ],
    revision: 1,
    createdAt: 't0',
    updatedAt: 't0',
    source: 'user',
    ...overrides,
  };
}

describe('applyPlanStepUpdate', () => {
  it('rejects unknown stepId', () => {
    const result = applyPlanStepUpdate({
      plan: samplePlan(),
      stepId: 'missing',
      status: 'done',
    });
    expect(result.ok).toBe(false);
  });

  it('promotes approved to executing on first progress', () => {
    const result = applyPlanStepUpdate({
      plan: samplePlan(),
      stepId: '1',
      status: 'active',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.plan.status).toBe('executing');
    expect(result.plan.steps[0]?.status).toBe('active');
  });

  it('auto-completes plan when all steps terminal', () => {
    const result = applyPlanStepUpdate({
      plan: samplePlan({
        status: 'executing',
        steps: [
          { id: '1', title: 'A', status: 'done' },
          { id: '2', title: 'B', status: 'pending' },
        ],
      }),
      stepId: '2',
      status: 'done',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.plan.status).toBe('done');
  });
});

describe('applyPlanStatus', () => {
  it('sets abandoned', () => {
    const result = applyPlanStatus({ plan: samplePlan(), status: 'abandoned' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.plan.status).toBe('abandoned');
  });
});

describe('markNextPlanStepActive', () => {
  it('activates first pending and completes previous active', () => {
    const result = markNextPlanStepActive(
      samplePlan({
        status: 'executing',
        steps: [
          { id: '1', title: 'A', status: 'active' },
          { id: '2', title: 'B', status: 'pending' },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.plan.steps[0]?.status).toBe('done');
    expect(result.plan.steps[1]?.status).toBe('active');
  });
});
