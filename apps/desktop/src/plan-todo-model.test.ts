import { describe, expect, it } from 'vitest';
import type { PlanStep, SessionPlan } from '@piwin/contracts';
import {
  compactPlanSteps,
  isPlanProgressTool,
  PLAN_TODO_COMPACT_LIMIT,
  shouldShowPlanTodoTray,
} from './plan-todo-model.js';

function step(id: string, status: PlanStep['status']): PlanStep {
  return { id, title: `Step ${id}`, status };
}

function plan(overrides: Partial<SessionPlan> = {}): SessionPlan {
  return {
    id: 'p1',
    sessionId: 's1',
    projectPath: '/tmp',
    status: 'executing',
    title: 'Ship',
    goal: 'Ship it',
    steps: [step('1', 'done'), step('2', 'active'), step('3', 'pending')],
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    source: 'assistant',
    ...overrides,
  };
}

describe('shouldShowPlanTodoTray', () => {
  it('hides in Conversation sessions', () => {
    expect(shouldShowPlanTodoTray({ plan: plan(), isConversationSession: true })).toBe(false);
  });

  it('hides when every step is done or skipped', () => {
    expect(
      shouldShowPlanTodoTray({
        plan: plan({
          status: 'executing',
          steps: [step('1', 'done'), step('2', 'skipped')],
        }),
        isConversationSession: false,
      }),
    ).toBe(false);
  });

  it('hides terminal plans even if a pending step remains', () => {
    expect(
      shouldShowPlanTodoTray({
        plan: plan({ status: 'done', steps: [step('1', 'pending')] }),
        isConversationSession: false,
      }),
    ).toBe(false);
    expect(
      shouldShowPlanTodoTray({
        plan: plan({ status: 'abandoned', steps: [step('1', 'pending')] }),
        isConversationSession: false,
      }),
    ).toBe(false);
  });

  it('hides draft and approved plans — execution gate owns that slot', () => {
    expect(
      shouldShowPlanTodoTray({
        plan: plan({ status: 'draft', steps: [step('1', 'pending')] }),
        isConversationSession: false,
      }),
    ).toBe(false);
    expect(
      shouldShowPlanTodoTray({
        plan: plan({ status: 'approved', steps: [step('1', 'pending')] }),
        isConversationSession: false,
      }),
    ).toBe(false);
  });

  it('shows executing plans with open steps', () => {
    expect(shouldShowPlanTodoTray({ plan: plan(), isConversationSession: false })).toBe(true);
  });
});

describe('compactPlanSteps', () => {
  it('returns every step when expanded or short', () => {
    const steps = [step('1', 'done'), step('2', 'pending')];
    expect(compactPlanSteps(steps, true).visible).toHaveLength(2);
    expect(compactPlanSteps(steps, false).hiddenCount).toBe(0);
  });

  it(`windows ${PLAN_TODO_COMPACT_LIMIT} steps around the first open item`, () => {
    const steps = [
      step('1', 'done'),
      step('2', 'done'),
      step('3', 'done'),
      step('4', 'active'),
      step('5', 'pending'),
      step('6', 'pending'),
      step('7', 'pending'),
      step('8', 'pending'),
    ];
    const compact = compactPlanSteps(steps, false);
    expect(compact.visible.map((item) => item.id)).toEqual(['3', '4', '5', '6', '7']);
    expect(compact.hiddenCount).toBe(3);
    expect(compact.startIndex).toBe(2);
  });
});

describe('isPlanProgressTool', () => {
  it('matches create and set-step names, including routed aliases', () => {
    expect(isPlanProgressTool({ toolName: 'piwin_plan_create' })).toBe(true);
    expect(isPlanProgressTool({ toolName: 'piwin_plan_set_step' })).toBe(true);
    expect(
      isPlanProgressTool({
        toolName: 'piwin_toolbox',
        presentation: {
          kind: 'other',
          title: 'Plan',
          routedToolName: 'plan_create',
        },
      }),
    ).toBe(true);
    expect(isPlanProgressTool({ toolName: 'bash' })).toBe(false);
  });
});
