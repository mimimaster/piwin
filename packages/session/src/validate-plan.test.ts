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
});
