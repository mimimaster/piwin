// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { SessionPlan } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { createInitialChatUiState } from './chat-reducer';
import { DesktopLocaleProvider } from './desktop-locale-context';
import {
  canShowPlanExecutionGate,
  PlanExecutionGate,
  recommendedPlanExecutionMode,
} from './plan-execution-gate';
import { WorkbenchPermissionBar } from './workbench-conversation';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function draftPlan(overrides: Partial<SessionPlan> = {}): SessionPlan {
  return {
    id: 'p1',
    sessionId: 's1',
    projectPath: '/tmp/repo',
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

describe('canShowPlanExecutionGate', () => {
  it('shows for a draft plan in a project session that is idle', () => {
    expect(
      canShowPlanExecutionGate({
        plan: draftPlan(),
        isConversationSession: false,
        streaming: false,
      }),
    ).toBe(true);
  });

  it('shows for an approved plan that has not started running', () => {
    expect(
      canShowPlanExecutionGate({
        plan: draftPlan({ status: 'approved' }),
        isConversationSession: false,
      }),
    ).toBe(true);
  });

  it('hides in Conversation sessions even when a draft exists', () => {
    expect(
      canShowPlanExecutionGate({
        plan: draftPlan(),
        isConversationSession: true,
      }),
    ).toBe(false);
  });

  it('hides while the agent is still streaming', () => {
    expect(
      canShowPlanExecutionGate({
        plan: draftPlan(),
        isConversationSession: false,
        streaming: true,
      }),
    ).toBe(false);
  });

  it('hides while the previous run is paused', () => {
    expect(
      canShowPlanExecutionGate({
        plan: draftPlan(),
        isConversationSession: false,
        paused: true,
      }),
    ).toBe(false);
  });

  it('shows a stuck executing plan after execution failed so the user can retry', () => {
    expect(
      canShowPlanExecutionGate({
        plan: draftPlan({
          status: 'executing',
          execution: {
            sessionId: 's1',
            planId: 'p1',
            mode: 'subagent-driven',
            status: 'failed',
            childSessionIds: [],
            error: 'session-busy: body-job',
          },
        }),
        isConversationSession: false,
      }),
    ).toBe(true);
  });

  it('hides when a permission prompt is already occupying the interruption slot', () => {
    expect(
      canShowPlanExecutionGate({
        plan: draftPlan(),
        isConversationSession: false,
        hasPermissionPrompt: true,
      }),
    ).toBe(false);
  });

  it('hides while the plan is executing, done, or abandoned', () => {
    expect(
      canShowPlanExecutionGate({
        plan: draftPlan({ status: 'executing' }),
        isConversationSession: false,
      }),
    ).toBe(false);
    expect(
      canShowPlanExecutionGate({
        plan: draftPlan({ status: 'done' }),
        isConversationSession: false,
      }),
    ).toBe(false);
    expect(
      canShowPlanExecutionGate({
        plan: draftPlan({ status: 'abandoned' }),
        isConversationSession: false,
      }),
    ).toBe(false);
  });

  it('hides when live execution is queued or running even if status lagged', () => {
    expect(
      canShowPlanExecutionGate({
        plan: draftPlan({
          status: 'approved',
          execution: {
            sessionId: 's1',
            planId: 'p1',
            mode: 'inline',
            status: 'queued',
            childSessionIds: [],
          },
        }),
        isConversationSession: false,
      }),
    ).toBe(false);
  });

  it('hides when there is no plan', () => {
    expect(
      canShowPlanExecutionGate({
        plan: null,
        isConversationSession: false,
      }),
    ).toBe(false);
  });
});

describe('recommendedPlanExecutionMode', () => {
  it('recommends inline for short plans', () => {
    expect(recommendedPlanExecutionMode(draftPlan({ complexity: 'short' }))).toBe('inline');
  });

  it('recommends subagent-driven for long plans with independent steps', () => {
    expect(
      recommendedPlanExecutionMode(
        draftPlan({ complexity: 'long', independentSteps: ['1', '2'] }),
      ),
    ).toBe('subagent-driven');
  });

  it('recommends inline for long sequential plans with no independent steps', () => {
    expect(recommendedPlanExecutionMode(draftPlan({ complexity: 'long' }))).toBe('inline');
  });

  it('treats missing complexity as inline', () => {
    const plan = draftPlan();
    delete plan.complexity;
    expect(recommendedPlanExecutionMode(plan)).toBe('inline');
  });
});

function renderNode(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { container, root };
}

describe('PlanExecutionGate', () => {
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('renders title, plan name, and both execution modes without a Process step', () => {
    const { container, root } = renderNode(
      <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <PlanExecutionGate plan={draftPlan()} onExecute={() => undefined} />
        </PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
    expect(container.querySelector('[data-testid="plan-execution-gate"]')).not.toBeNull();
    expect(container.textContent).toContain('怎么执行这个计划');
    expect(container.textContent).toContain('Add auth');
    expect(container.querySelector('[data-testid="plan-mode-inline"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="plan-mode-subagent"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="plan-process"]')).toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it('marks inline as the primary action for a short plan', () => {
    const { container, root } = renderNode(
      <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <PlanExecutionGate plan={draftPlan({ complexity: 'short' })} onExecute={() => undefined} />
        </PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
    const inlineBtn = container.querySelector('[data-testid="plan-mode-inline"]');
    const subagentBtn = container.querySelector('[data-testid="plan-mode-subagent"]');
    expect(inlineBtn?.getAttribute('data-recommended')).toBe('true');
    expect(subagentBtn?.getAttribute('data-recommended')).toBe('false');
    act(() => root.unmount());
    container.remove();
  });

  it('marks subagent-driven as the primary action for a long plan', () => {
    const { container, root } = renderNode(
      <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <PlanExecutionGate
            plan={draftPlan({ complexity: 'long', independentSteps: ['1', '2'] })}
            onExecute={() => undefined}
          />
        </PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
    const inlineBtn = container.querySelector('[data-testid="plan-mode-inline"]');
    const subagentBtn = container.querySelector('[data-testid="plan-mode-subagent"]');
    expect(subagentBtn?.getAttribute('data-recommended')).toBe('true');
    expect(inlineBtn?.getAttribute('data-recommended')).toBe('false');
    act(() => root.unmount());
    container.remove();
  });

  it('calls onExecute with the selected mode', () => {
    const onExecute = vi.fn();
    const { container, root } = renderNode(
      <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <PlanExecutionGate plan={draftPlan()} onExecute={onExecute} />
        </PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="plan-mode-inline"]')?.click();
    });
    expect(onExecute).toHaveBeenCalledWith('inline');
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="plan-mode-subagent"]')?.click();
    });
    expect(onExecute).toHaveBeenCalledWith('subagent-driven');
    act(() => root.unmount());
    container.remove();
  });
});

describe('WorkbenchPermissionBar plan execution gate', () => {
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  function projectState() {
    const state = createInitialChatUiState();
    return {
      ...state,
      activeScope: { kind: 'project' as const, projectPath: '/tmp/repo' },
      projectPath: '/tmp/repo',
    };
  }

  it('shows the gate above the composer for a draft plan in a project session', () => {
    const { container, root } = renderNode(
      <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WorkbenchPermissionBar
            state={projectState()}
            extensionUiRequest={null}
            sessionPlan={draftPlan()}
            onPlanExecute={() => undefined}
            onPermission={() => undefined}
            onExtensionUiResolve={() => undefined}
          />
        </PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
    expect(container.querySelector('[data-testid="plan-execution-gate"]')).not.toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it('does not show the gate in Conversation (general) scope', () => {
    const { container, root } = renderNode(
      <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WorkbenchPermissionBar
            state={createInitialChatUiState()}
            extensionUiRequest={null}
            sessionPlan={draftPlan()}
            onPlanExecute={() => undefined}
            onPermission={() => undefined}
            onExtensionUiResolve={() => undefined}
          />
        </PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
    expect(container.querySelector('[data-testid="plan-execution-gate"]')).toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it('lets a permission prompt occupy the slot instead of the plan gate', () => {
    const state = {
      ...projectState(),
      permissionPrompt: {
        requestId: 'req-1',
        sessionId: 's1',
        action: 'bash:ls',
        detail: 'ls',
        defaultDecision: 'ask' as const,
      },
    };
    const { container, root } = renderNode(
      <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WorkbenchPermissionBar
            state={state}
            extensionUiRequest={null}
            sessionPlan={draftPlan()}
            onPlanExecute={() => undefined}
            onPermission={() => undefined}
            onExtensionUiResolve={() => undefined}
          />
        </PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
    expect(container.querySelector('[data-testid="permission-bar"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="plan-execution-gate"]')).toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it('renders approval controls for a general-scope session', () => {
    const onPermission = vi.fn();
    const state = {
      ...createInitialChatUiState(),
      permissionPrompt: {
        requestId: 'req-general',
        sessionId: 's-general',
        action: 'web_search',
        detail: 'query',
        defaultDecision: 'ask' as const,
      },
      permissionQueue: [
        {
          requestId: 'req-general',
          sessionId: 's-general',
          action: 'web_search',
          detail: 'query',
          defaultDecision: 'ask' as const,
        },
      ],
    };
    const { container, root } = renderNode(
      <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WorkbenchPermissionBar
            state={state}
            extensionUiRequest={null}
            onPermission={onPermission}
            onExtensionUiResolve={() => undefined}
          />
        </PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
    expect(container.querySelector('[data-testid="permission-bar"]')).not.toBeNull();
    const allowOnce = container.querySelector<HTMLButtonElement>(
      '[data-testid="permission-bar-allow-once"]',
    );
    expect(allowOnce).not.toBeNull();
    act(() => allowOnce?.click());
    expect(onPermission).toHaveBeenCalledWith('allow', 'once');
    act(() => root.unmount());
    container.remove();
  });

  it('does not show the gate while a run is paused', () => {
    const state = {
      ...projectState(),
      runTerminal: { kind: 'paused' as const, at: Date.now(), checkpointId: 'ckpt-1' },
    };
    const { container, root } = renderNode(
      <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WorkbenchPermissionBar
            state={state}
            extensionUiRequest={null}
            sessionPlan={draftPlan()}
            onPlanExecute={() => undefined}
            onPermission={() => undefined}
            onExtensionUiResolve={() => undefined}
          />
        </PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
    expect(container.querySelector('[data-testid="plan-execution-gate"]')).toBeNull();
    act(() => root.unmount());
    container.remove();
  });
});
