// @vitest-environment happy-dom
/**
 * PlanCard Process / mode selection / abort flow coverage.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { PlanCard } from './plan-card';
import type { PlanExecutionMode, SessionPlan } from '@piwin/contracts';

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

  it('shows Process button for a draft plan with onExecute', () => {
    const { container } = renderPlan(<PlanCard plan={draftPlan()} onExecute={() => undefined} />);
    expect(container.querySelector('[data-testid="plan-process"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="plan-mode-buttons"]')).toBeNull();
  });

  it('reveals mode buttons after clicking Process', () => {
    const { container } = renderPlan(<PlanCard plan={draftPlan()} onExecute={() => undefined} />);
    const processBtn = container.querySelector<HTMLButtonElement>('[data-testid="plan-process"]');
    expect(processBtn).toBeTruthy();
    act(() => {
      processBtn?.click();
    });
    expect(container.querySelector('[data-testid="plan-mode-buttons"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="plan-mode-subagent"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="plan-mode-inline"]')).toBeTruthy();
  });

  it('calls onExecute with inline when inline button is clicked', () => {
    let selectedMode: PlanExecutionMode | null = null;
    const { container } = renderPlan(
      <PlanCard
        plan={draftPlan()}
        onExecute={(mode) => {
          selectedMode = mode;
        }}
      />,
    );
    const processBtn = container.querySelector<HTMLButtonElement>('[data-testid="plan-process"]');
    act(() => {
      processBtn?.click();
    });
    const inlineBtn = container.querySelector<HTMLButtonElement>('[data-testid="plan-mode-inline"]');
    act(() => {
      inlineBtn?.click();
    });
    expect(selectedMode).toBe('inline');
  });

  it('calls onExecute with subagent-driven when subagent button is clicked', () => {
    let selectedMode: PlanExecutionMode | null = null;
    const { container } = renderPlan(
      <PlanCard
        plan={draftPlan()}
        onExecute={(mode) => {
          selectedMode = mode;
        }}
      />,
    );
    const processBtn = container.querySelector<HTMLButtonElement>('[data-testid="plan-process"]');
    act(() => {
      processBtn?.click();
    });
    const subagentBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="plan-mode-subagent"]',
    );
    act(() => {
      subagentBtn?.click();
    });
    expect(selectedMode).toBe('subagent-driven');
  });

  it('marks subagent-driven as recommended for long plans', () => {
    const { container } = renderPlan(
      <PlanCard plan={draftPlan({ complexity: 'long' })} onExecute={() => undefined} />,
    );
    const processBtn = container.querySelector<HTMLButtonElement>('[data-testid="plan-process"]');
    act(() => {
      processBtn?.click();
    });
    const subagentBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="plan-mode-subagent"]',
    );
    expect(subagentBtn?.className).toContain('plan-btn-recommended');
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

  it('does not show Process button when no onExecute callback', () => {
    const { container } = renderPlan(<PlanCard plan={draftPlan()} />);
    expect(container.querySelector('[data-testid="plan-process"]')).toBeNull();
  });
});
