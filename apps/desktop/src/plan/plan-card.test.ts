import { describe, expect, it } from 'vitest';
import type { SessionPlan } from '@piwin/contracts';
import { formatPlanMarkdown, planStepVisual, resolveSessionPlanDocument } from './plan-card';

describe('planStepVisual', () => {
  it('maps contract status to visual state', () => {
    expect(planStepVisual('done')).toBe('done');
    expect(planStepVisual('active')).toBe('run');
    expect(planStepVisual('pending')).toBe('pending');
    expect(planStepVisual('skipped')).toBe('skipped');
  });
});

function plan(): SessionPlan {
  return {
    id: 'plan-1',
    sessionId: 'session-1',
    projectPath: '/repo',
    status: 'draft',
    title: '回收 worktree',
    goal: '落地后删除副本',
    steps: [{ id: '1', title: '收窄保留判定', status: 'pending' }],
    revision: 0,
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z',
    source: 'assistant',
  };
}

describe('resolveSessionPlanDocument', () => {
  it('fills the logical plan path from the live session plan', () => {
    const resolved = resolveSessionPlanDocument(
      { title: 'session-1.md', path: 'plans/session-1.md' },
      'session-1',
      plan(),
    );
    expect(resolved.content).toContain('回收 worktree');
    expect(resolved.content).toContain('收窄保留判定');
    expect(resolved.path).toBe('plans/session-1.md');
  });

  it('leaves real files and other sessions on the disk path', () => {
    const current = plan();
    expect(
      resolveSessionPlanDocument(
        { title: 'notes.md', path: 'docs/plans/session-1.md' },
        'session-1',
        current,
      ),
    ).toEqual({ title: 'notes.md', path: 'docs/plans/session-1.md' });
    expect(
      resolveSessionPlanDocument(
        { title: 'other.md', path: 'plans/session-2.md' },
        'session-1',
        current,
      ).content,
    ).toBeUndefined();
  });

  it('does not replace a body the caller already supplied', () => {
    const resolved = resolveSessionPlanDocument(
      { title: 'Plan', path: 'plans/session-1.md', content: 'already rendered' },
      'session-1',
      plan(),
    );
    expect(resolved.content).toBe('already rendered');
  });

  it('renders the plan title instead of a missing-file stub', () => {
    expect(formatPlanMarkdown(plan())).toContain('# Implementation Plan: 回收 worktree');
  });
});
