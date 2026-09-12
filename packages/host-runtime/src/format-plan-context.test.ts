import { describe, expect, it } from 'vitest';
import { formatPlanForModelContext } from './format-plan-context.js';

describe('formatPlanForModelContext', () => {
  it('includes title goal and steps', () => {
    const text = formatPlanForModelContext({
      id: 'p',
      sessionId: 's',
      projectPath: '/tmp',
      status: 'approved',
      title: 'T',
      goal: 'G',
      steps: [{ id: '1', title: 'A', status: 'pending' }],
      revision: 1,
      createdAt: 't',
      updatedAt: 't',
      source: 'user',
    });
    expect(text).toContain('Title: T');
    expect(text).toContain('Goal: G');
    expect(text).toContain('1: A');
  });

  it('includes set_step instruction when approved/executing', () => {
    const text = formatPlanForModelContext({
      id: 'p',
      sessionId: 's',
      projectPath: '/tmp',
      status: 'executing',
      title: 'T',
      goal: 'G',
      steps: [{ id: '1', title: 'A', status: 'active' }],
      revision: 2,
      createdAt: 't',
      updatedAt: 't',
      source: 'user',
    });
    expect(text).toContain('piwin_plan_set_step');
    expect(text).toContain('acceptance criteria');
  });

  it('mentions the stored execution mode when present', () => {
    const text = formatPlanForModelContext({
      id: 'p',
      sessionId: 's',
      projectPath: '/tmp',
      status: 'approved',
      title: 'T',
      goal: 'G',
      steps: [{ id: '1', title: 'A', status: 'pending' }],
      revision: 1,
      createdAt: 't',
      updatedAt: 't',
      source: 'user',
      execution: {
        sessionId: 's',
        planId: 'p',
        mode: 'inline',
        status: 'idle',
        childSessionIds: [],
      },
    });
    expect(text).toContain('Chosen execution mode: inline in this session.');
  });
});
