// @vitest-environment happy-dom
/**
 * PlanCard progress / abort / terminal coverage. Execution-mode choice
 * lives on PlanExecutionGate, not this card.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { PlanCard } from './plan-card';
import type { SessionPlan } from '@piwin/contracts';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function renderPlan(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>);
  });
  return { container, root };
}

function draftPlan(overrides: Partial<SessionPlan> = {}): SessionPlan {
  return {
    id: 'p1',
    sessionId: 's1',
    projectPath: '/tmp',
    status: 'draft',
    title: 'Add auth',
    goal: 'Add login flow',
    steps: [
      { id: '1', title: 'Design', status: 'pending' },
      { id: '2', title: 'Implement', status: 'pending' },
    ],
    revision: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    source: 'skill',
    skillId: 'writing-plans',
    complexity: 'short',
    ...overrides,
  };
}

describe('PlanCard execution flow', () => {
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('is a progress tracker and does not host the execution-mode picker', () => {
    const { container } = renderPlan(<PlanCard plan={draftPlan()} />);
    expect(container.querySelector('[data-testid="plan-card"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="plan-process"]')).toBeNull();
    expect(container.querySelector('[data-testid="plan-mode-buttons"]')).toBeNull();
    expect(container.querySelector('[data-testid="plan-mode-inline"]')).toBeNull();
    expect(container.querySelector('[data-testid="plan-mode-subagent"]')).toBeNull();
  });

  it('shows Abort button when plan is executing', () => {
    const plan = draftPlan({
      status: 'executing',
      execution: {
        sessionId: 's1',
        planId: 'p1',
        mode: 'inline',
        status: 'running',
        childSessionIds: [],
      },
    });
    const { container } = renderPlan(<PlanCard plan={plan} onAbort={() => undefined} />);
    expect(container.querySelector('[data-testid="plan-abort"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="plan-running-label"]')).toBeTruthy();
  });

  it('shows terminal state for done plans', () => {
    const plan = draftPlan({
      status: 'done',
      steps: [
        { id: '1', title: 'Design', status: 'done' },
        { id: '2', title: 'Implement', status: 'done' },
      ],
    });
    const { container } = renderPlan(<PlanCard plan={plan} />);
    expect(container.querySelector('[data-testid="plan-terminal"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="plan-process"]')).toBeNull();
  });



  it('renders progress header count and step SVG icons correctly', () => {
    const plan = draftPlan({
      steps: [
        { id: '1', title: 'Task 1', status: 'done' },
        { id: '2', title: 'Task 2', status: 'active' },
        { id: '3', title: 'Task 3', status: 'pending' },
      ],
    });
    const { container } = renderPlan(<PlanCard plan={plan} />);
    const titleText = container.querySelector('.plan-title')?.textContent;
    expect(titleText).toContain('1 / 3 tasks done');

    expect(container.querySelector('.step-icon-done')).toBeTruthy();
    expect(container.querySelector('.step-icon-run')).toBeTruthy();
    expect(container.querySelector('.step-icon-pending')).toBeTruthy();
  });
});
