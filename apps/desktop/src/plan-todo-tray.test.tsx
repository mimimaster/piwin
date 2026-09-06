// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { DesktopLocaleProvider } from './desktop-locale-context';
import { PlanTodoTray } from './plan-todo-tray';
import type { SessionPlan } from '@piwin/contracts';

function renderTray(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
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

describe('PlanTodoTray', () => {
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('does not host the execution-mode picker', () => {
    const { container, root } = renderTray(<PlanTodoTray plan={draftPlan()} />);
    expect(container.querySelector('[data-testid="plan-todo-tray"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="plan-process"]')).toBeNull();
    expect(container.querySelector('[data-testid="plan-mode-inline"]')).toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it('shows Abort when the plan is executing', () => {
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
    const { container, root } = renderTray(<PlanTodoTray plan={plan} onAbort={() => undefined} />);
    expect(container.querySelector('[data-testid="plan-abort"]')).toBeTruthy();
    act(() => root.unmount());
    container.remove();
  });

  it('compacts long lists and expands on request', () => {
    const plan = draftPlan({
      steps: Array.from({ length: 8 }, (_, index) => ({
        id: String(index + 1),
        title: `Task ${index + 1}`,
        status: index < 3 ? 'done' : index === 3 ? 'active' : 'pending',
      })) as SessionPlan['steps'],
    });
    const { container, root } = renderTray(<PlanTodoTray plan={plan} />);
    expect(container.querySelectorAll('.plan-todo-step')).toHaveLength(5);
    expect(container.querySelector('[data-testid="plan-todo-tray-more"]')?.textContent).toContain(
      'and 3 more',
    );
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="plan-todo-tray-more"]')?.click();
    });
    expect(container.querySelectorAll('.plan-todo-step')).toHaveLength(8);
    act(() => root.unmount());
    container.remove();
  });
});
