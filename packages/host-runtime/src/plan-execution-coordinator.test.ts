import { describe, expect, it } from 'vitest';
import type { SessionPlan } from '@piwin/contracts';
import {
  abortExecutionState,
  buildInlineDirective,
  buildPlanSubagentTask,
  buildPlanSummary,
  buildSubagentTaskDirective,
  buildSubagentVerificationDirective,
  completeExecutionState,
  createExecutionState,
  failExecutionState,
  selectSubagentSteps,
} from './plan-execution-coordinator.js';

function plan(overrides: Partial<SessionPlan> = {}): SessionPlan {
  return {
    id: 'p1',
    sessionId: 's1',
    projectPath: '/tmp',
    status: 'approved',
    title: 'Add auth',
    goal: 'Add login flow',
    steps: [
      { id: '1', title: 'Design', status: 'pending', detail: 'types + tests' },
      { id: '2', title: 'Implement', status: 'pending' },
    ],
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    source: 'skill',
    skillId: 'writing-plans',
    complexity: 'long',
    independentSteps: ['1', '2'],
    ...overrides,
  };
}

describe('buildInlineDirective', () => {
  it('includes plan title, goal, and step list', () => {
    const directive = buildInlineDirective(plan());
    expect(directive.promptText).toContain('Add auth');
    expect(directive.promptText).toContain('Add login flow');
    expect(directive.promptText).toContain('[1] Design');
    expect(directive.promptText).toContain('[2] Implement');
    expect(directive.promptText).toContain('piwin_plan_set_step');
  });
});

describe('buildSubagentTaskDirective', () => {
  it('builds a directive for a known step', () => {
    const directive = buildSubagentTaskDirective(plan(), '1');
    expect(directive?.stepId).toBe('1');
    expect(directive?.promptText).toContain('Design');
    expect(directive?.promptText).toContain('types + tests');
    expect(directive?.promptText).toContain('complete only this step');
  });

  it('returns null for an unknown step id', () => {
    expect(buildSubagentTaskDirective(plan(), 'ghost')).toBeNull();
  });
});

describe('buildPlanSubagentTask', () => {
  it('defaults plan work to the isolated implementer profile', () => {
    const task = buildPlanSubagentTask(plan(), '1');
    expect(task).toMatchObject({
      id: '1',
      parentSessionId: 's1',
      profileId: 'implementer',
      applyPolicy: 'auto',
      deliveryIntent: 'integrate',
      legacyManual: false,
    });
  });

  it('preserves an explicit step profile', () => {
    const task = buildPlanSubagentTask(
      plan({ steps: [{ id: '1', title: 'Review', status: 'pending', profileId: 'reviewer' }] }),
      '1',
    );
    expect(task?.profileId).toBe('reviewer');
    expect(task).toMatchObject({
      deliveryIntent: 'report',
      applyPolicy: 'none',
      legacyManual: false,
    });
  });
});

describe('buildSubagentVerificationDirective', () => {
  it('instructs the parent to verify while leaving Walkthrough generation to Host', () => {
    const directive = buildSubagentVerificationDirective(plan());
    expect(directive.promptText).toContain('verify');
    expect(directive.promptText).toContain('Host generates the separate Walkthrough Artifact');
  });

  it('requires parent execution of non-independent sequential steps', () => {
    const mixedPlan = plan();
    mixedPlan.independentSteps = ['1'];
    const directive = buildSubagentVerificationDirective(mixedPlan);
    expect(directive.promptText).toContain('Parent-owned sequential steps');
    expect(directive.promptText).toContain('[2] Implement');
    expect(directive.promptText).toContain('never mark an unexecuted step done');
  });

  it('includes bounded child summaries and verification evidence', () => {
    const directive = buildSubagentVerificationDirective(plan(), [
      {
        runId: 'r1',
        taskId: '1',
        childSessionId: 'c1',
        executionStatus: 'completed',
        summaryStatus: 'pending',
        integrationStatus: 'applied',
        summaryPreview: 'Implemented the contract change.',
        changedFiles: ['packages/contracts/src/example.ts'],
        verification: 'unit tests passed',
      },
    ]);
    expect(directive.promptText).toContain('Child execution evidence');
    expect(directive.promptText).toContain('Implemented the contract change.');
    expect(directive.promptText).toContain('unit tests passed');
  });
});

describe('execution state helpers', () => {
  it('createExecutionState initializes queued state', () => {
    const state = createExecutionState(plan(), 'subagent-driven');
    expect(state.status).toBe('queued');
    expect(state.mode).toBe('subagent-driven');
    expect(state.childSessionIds).toEqual([]);
  });

  it('failExecutionState caps error and sets endedAt', () => {
    const state = failExecutionState(createExecutionState(plan(), 'inline'), 'x'.repeat(1000));
    expect(state.status).toBe('failed');
    expect(state.error?.length).toBeLessThanOrEqual(500);
    expect(state.endedAt).toBeTruthy();
  });

  it('abortExecutionState sets aborted', () => {
    const state = abortExecutionState(createExecutionState(plan(), 'inline'));
    expect(state.status).toBe('aborted');
    expect(state.endedAt).toBeTruthy();
  });

  it('completeExecutionState sets completed', () => {
    const state = completeExecutionState(createExecutionState(plan(), 'inline'));
    expect(state.status).toBe('completed');
    expect(state.endedAt).toBeTruthy();
  });
});

describe('buildPlanSummary', () => {
  it('partitions steps by status and includes merged children', () => {
    const summary = buildPlanSummary({
      plan: plan({
        steps: [
          { id: '1', title: 'Design', status: 'done' },
          { id: '2', title: 'Implement', status: 'done' },
          { id: '3', title: 'Docs', status: 'skipped' },
          { id: '4', title: 'Polish', status: 'pending' },
        ],
      }),
      mode: 'subagent-driven',
      mergedChildSessionIds: ['c1', 'c2'],
      verificationResult: 'all green',
      unresolvedItems: ['needs docs review'],
    });
    expect(summary.completedStepIds).toEqual(['1', '2']);
    expect(summary.skippedStepIds).toEqual(['3']);
    expect(summary.failedStepIds).toEqual(['4']);
    expect(summary.mergedChildSessionIds).toEqual(['c1', 'c2']);
    expect(summary.verificationResult).toBe('all green');
    expect(summary.unresolvedItems).toEqual(['needs docs review']);
  });
});

describe('selectSubagentSteps', () => {
  it('returns declared independent steps in plan order', () => {
    expect(selectSubagentSteps(plan())).toEqual(['1', '2']);
  });

  it('returns empty when no independent steps declared', () => {
    const p = plan();
    delete p.independentSteps;
    expect(selectSubagentSteps(p)).toEqual([]);
  });

  it('filters out unknown ids', () => {
    expect(selectSubagentSteps(plan({ independentSteps: ['2', 'ghost'] }))).toEqual(['2']);
  });
});
