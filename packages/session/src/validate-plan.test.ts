import { describe, expect, it } from 'vitest';
import { validateSessionPlan } from './validate-plan.js';

const sample = {
  id: 'p1',
  sessionId: 's1',
  projectPath: '/tmp/proj',
  status: 'draft',
  title: 'Ship feature',
  goal: 'Implement X safely',
  steps: [{ id: '1', title: 'Design', status: 'pending' }],
  revision: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  source: 'user',
};

describe('validateSessionPlan', () => {
  it('accepts a valid plan', () => {
    const result = validateSessionPlan(sample);
    expect(result.ok).toBe(true);
  });

  it('rejects executable fields and missing goal', () => {
    expect(validateSessionPlan({ ...sample, js: 'x' }).ok).toBe(false);
    expect(validateSessionPlan({ ...sample, goal: '' }).ok).toBe(false);
  });

  it('rejects duplicate step ids', () => {
    const result = validateSessionPlan({
      ...sample,
      steps: [
        { id: '1', title: 'A', status: 'pending' },
        { id: '1', title: 'B', status: 'pending' },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.message.includes('duplicate step id'))).toBe(true);
    }
  });

  it('rejects unknown independent step ids', () => {
    const result = validateSessionPlan({
      ...sample,
      steps: [
        { id: '1', title: 'A', status: 'pending' },
        { id: '2', title: 'B', status: 'pending' },
      ],
      independentSteps: ['1', 'ghost'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.message.includes('unknown step id'))).toBe(true);
    }
  });

  it('accepts valid skill provenance and complexity', () => {
    const result = validateSessionPlan({
      ...sample,
      source: 'skill',
      skillId: 'writing-plans',
      complexity: 'long',
      independentSteps: ['1'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.skillId).toBe('writing-plans');
      expect(result.plan.complexity).toBe('long');
      expect(result.plan.independentSteps).toEqual(['1']);
    }
  });

  it('rejects invalid complexity', () => {
    const result = validateSessionPlan({ ...sample, complexity: 'huge' });
    expect(result.ok).toBe(false);
  });

  it('accepts a valid execution state', () => {
    const result = validateSessionPlan({
      ...sample,
      execution: {
        sessionId: 's1',
        planId: 'p1',
        mode: 'subagent-driven',
        status: 'running',
        childSessionIds: ['c1'],
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.execution?.mode).toBe('subagent-driven');
      expect(result.plan.execution?.childSessionIds).toEqual(['c1']);
    }
  });

  it('rejects invalid execution mode', () => {
    const result = validateSessionPlan({
      ...sample,
      execution: {
        sessionId: 's1',
        planId: 'p1',
        mode: 'parallel',
        status: 'running',
        childSessionIds: [],
      },
    });
    expect(result.ok).toBe(false);
  });
});
