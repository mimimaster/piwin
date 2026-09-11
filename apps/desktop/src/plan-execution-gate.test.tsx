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
  findPlanExecutionGateMessageId,
  isPlanCreateTool,
  PlanExecutionGate,
  recommendedPlanExecutionMode,
} from './plan-execution-gate';
import { TurnWorkDetails } from './turn-work-details';
import { WorkbenchPermissionBar } from './workbench-conversation';
import type { ChatMessageUi } from './chat-ui-types';

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
  it('waits until the creating turn has finished', () => {
    expect(canShowPlanExecutionGate({ plan: draftPlan(), isConversationSession: false, streaming: true })).toBe(false);
  });

  it('shows for a draft plan in a project session', () => {
    expect(
      canShowPlanExecutionGate({
        plan: draftPlan(),
        isConversationSession: false,
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

  it('can still render on the creating turn while the user keeps chatting', () => {
    expect(
      canShowPlanExecutionGate({
        plan: draftPlan(),
        isConversationSession: false,
      }),
    ).toBe(true);
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

function assistantMessage(
  id: string,
  tools: ChatMessageUi['tools'] = [],
): ChatMessageUi {
  return {
    id,
    role: 'assistant',
    text: '',
    thinking: '',
    tools,
    attachments: [],
    status: 'done',
  };
}

describe('findPlanExecutionGateMessageId', () => {
  it.each(['running', 'error'] as const)('does not offer execution for a %s create tool', (status) => {
    expect(findPlanExecutionGateMessageId([
      assistantMessage('create', [{ toolCallId: 'tool', toolName: 'piwin_plan_create', status, output: '' }]),
    ])).toBeNull();
  });

  it('pins the gate to the assistant message that created the plan', () => {
    expect(
      findPlanExecutionGateMessageId([
        assistantMessage('a1', [
          { toolCallId: 't1', toolName: 'bash', status: 'done', output: '' },
        ]),
        assistantMessage('a2', [
          { toolCallId: 't2', toolName: 'piwin_plan_create', status: 'done', output: '' },
        ]),
        assistantMessage('a3', [
          { toolCallId: 't3', toolName: 'bash', status: 'done', output: 'later' },
        ]),
      ]),
    ).toBe('a2');
  });

  it('stays on the creating message after later turns, never the latest assistant', () => {
    expect(
      findPlanExecutionGateMessageId([
        assistantMessage('create', [
          { toolCallId: 't1', toolName: 'piwin_plan_create', status: 'done', output: '' },
        ]),
        assistantMessage('follow-up', [
          { toolCallId: 't2', toolName: 'piwin_plan_set_step', status: 'running', output: '' },
        ]),
      ]),
    ).toBe('create');
  });

  it('does not attach to later turns when the creating tool is absent', () => {
    expect(
      findPlanExecutionGateMessageId([
        assistantMessage('a1'),
        assistantMessage('a2'),
      ]),
    ).toBeNull();
  });

  it('matches routed plan_create aliases', () => {
    expect(
      isPlanCreateTool({
        toolName: 'piwin_toolbox',
        presentation: { kind: 'other', title: 'Plan', routedToolName: 'plan_create' },
      }),
    ).toBe(true);
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

  it('shows the failed execution reason beside retry choices', () => {
    const { container, root } = renderNode(
      <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <PlanExecutionGate plan={draftPlan({ status: 'approved', execution: {
            sessionId: 's1', planId: 'p1', mode: 'inline', status: 'failed',
            childSessionIds: [], error: 'Verification failed',
          } })} onExecute={() => undefined} />
        </PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Verification failed');
    expect(container.querySelector('[data-testid="plan-mode-inline"]')).not.toBeNull();
    act(() => root.unmount());
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
    expect(container.textContent).toContain('选择计划执行方式');
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

  it('ignores a second click while the normal prompt handoff is pending', async () => {
    let resolveHandoff: (() => void) | undefined;
    const handoff = new Promise<void>((resolve) => {
      resolveHandoff = resolve;
    });
    const onExecute = vi.fn(() => handoff);
    const { container, root } = renderNode(
      <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <PlanExecutionGate plan={draftPlan()} onExecute={onExecute} />
        </PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
    const inlineButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="plan-mode-inline"]',
    );
    expect(inlineButton).not.toBeNull();

    act(() => {
      inlineButton?.click();
      inlineButton?.click();
    });
    expect(onExecute).toHaveBeenCalledOnce();
    expect(inlineButton?.disabled).toBe(true);

    resolveHandoff?.();
    await act(async () => {
      await handoff;
    });
    expect(inlineButton?.disabled).toBe(false);

    act(() => root.unmount());
    container.remove();
  });

  it('opens the matching plan document when the card is clicked', () => {
    const onExecute = vi.fn();
    const onOpenDocument = vi.fn();
    const { container, root } = renderNode(
      <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <PlanExecutionGate
            plan={draftPlan()}
            onExecute={onExecute}
            onOpenDocument={onOpenDocument}
          />
        </PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
    const gate = container.querySelector<HTMLElement>('[data-testid="plan-execution-gate"]');
    expect(gate).not.toBeNull();
    expect(gate?.getAttribute('data-document-openable')).toBe('true');

    act(() => gate?.click());

    expect(onOpenDocument).toHaveBeenCalledTimes(1);
    expect(onOpenDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Add auth',
        path: 'plans/s1.md',
        content: expect.stringContaining('# Implementation Plan: Add auth'),
      }),
    );
    expect(onExecute).not.toHaveBeenCalled();

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="plan-mode-inline"]')?.click();
    });
    expect(onExecute).toHaveBeenCalledWith('inline');
    expect(onOpenDocument).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    container.remove();
  });

  it('matches proto-01-transcript.html DOM elements, classes, and step metrics', () => {
    const protoPlan = draftPlan({
      title: '作曲器排队语义',
      steps: [
        { id: '1', title: 'Step 1', status: 'pending' },
        { id: '2', title: 'Step 2', status: 'pending' },
        { id: '3', title: 'Step 3', status: 'pending' },
        { id: '4', title: 'Step 4', status: 'pending' },
      ],
      independentSteps: ['2', '3'],
      complexity: 'long',
    });
    const { container, root } = renderNode(
      <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <PlanExecutionGate plan={protoPlan} onExecute={() => undefined} />
        </PiwinUiProvider>
      </DesktopLocaleProvider>,
    );

    const gate = container.querySelector('[data-testid="plan-execution-gate"]');
    expect(gate?.classList.contains('intr')).toBe(true);

    const pill = gate?.querySelector('.pill.zhu-p');
    expect(pill).not.toBeNull();
    expect(pill?.querySelector('i')).not.toBeNull();
    expect(pill?.textContent).toContain('选择执行方式');

    const heading = gate?.querySelector('h3');
    expect(heading?.textContent).toBe('选择计划执行方式');

    const desc = gate?.querySelector('.desc');
    expect(desc?.textContent).toBe('作曲器排队语义 · 4 步 · 2 步可并行');

    const choices = gate?.querySelector('.choices');
    expect(choices).not.toBeNull();

    const subagentBtn = gate?.querySelector('[data-testid="plan-mode-subagent"]');
    expect(subagentBtn?.classList.contains('choice')).toBe(true);
    expect(subagentBtn?.classList.contains('rec')).toBe(true);
    expect(subagentBtn?.querySelector('.bd')?.textContent).toBe('A');
    expect(subagentBtn?.textContent).toContain('推荐 · 子代理执行');

    const inlineBtn = gate?.querySelector('[data-testid="plan-mode-inline"]');
    expect(inlineBtn?.classList.contains('choice')).toBe(true);
    expect(inlineBtn?.classList.contains('rec')).toBe(false);
    expect(inlineBtn?.querySelector('.bd')?.textContent).toBe('B');
    expect(inlineBtn?.textContent).toContain('在当前会话直接执行');

    const kb = gate?.querySelector('.kb');
    expect(kb?.textContent).toBe(
      '按 A / B 键快速执行 · 也可以直接在输入框继续提问',
    );

    act(() => root.unmount());
    container.remove();
  });

  it('triggers options via A and B keyboard shortcuts outside input fields', () => {
    const onExecute = vi.fn();
    const { container, root } = renderNode(
      <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <div>
            <input data-testid="test-input" />
            <PlanExecutionGate plan={draftPlan()} onExecute={onExecute} />
          </div>
        </PiwinUiProvider>
      </DesktopLocaleProvider>,
    );

    // Pressing 'a' triggers option A (inline for short draftPlan)
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    });
    expect(onExecute).toHaveBeenCalledWith('inline');

    // Pressing 'b' triggers option B (subagent-driven for short draftPlan)
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    });
    expect(onExecute).toHaveBeenCalledWith('subagent-driven');

    // Typing inside an input element does NOT trigger execution
    const input = container.querySelector<HTMLInputElement>('[data-testid="test-input"]')!;
    input.focus();
    onExecute.mockClear();
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    });
    expect(onExecute).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });

  it('does not capture A/B once the card is historical transcript', () => {
    const onExecute = vi.fn();
    const { container, root } = renderNode(
      <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <PlanExecutionGate
            plan={draftPlan()}
            onExecute={onExecute}
            captureKeyboard={false}
          />
        </PiwinUiProvider>
      </DesktopLocaleProvider>,
    );

    expect(container.querySelector('.kb')).toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    });
    expect(onExecute).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();
  });
});

describe('PlanExecutionGate on the call chain', () => {
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('renders after the turn tool group and hides plan-create rows', () => {
    const onOpenDocument = vi.fn();
    const message = assistantMessage('a1', [
      { toolCallId: 't1', toolName: 'bash', status: 'done', output: 'ok' },
      { toolCallId: 't2', toolName: 'piwin_plan_create', status: 'done', output: 'draft' },
    ]);
    const { container, root } = renderNode(
      <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnWorkDetails
            message={message}
            runRecordsById={{}}
            activeRunId={null}
            permissionPrompt={null}
            workDetailsExpanded="always"
            onOpenDocument={onOpenDocument}
            planExecutionGate={{ plan: draftPlan(), onExecute: () => undefined }}
          />
        </PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
    const group = container.querySelector('[data-testid="turn-tool-group"]');
    const gate = container.querySelector<HTMLElement>('[data-testid="plan-execution-gate"]');
    expect(group).not.toBeNull();
    expect(gate).not.toBeNull();
    expect(group && gate && group.compareDocumentPosition(gate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(gate?.closest('[data-testid="turn-work-details"]')).toBeNull();
    act(() => gate?.click());
    expect(onOpenDocument).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'plans/s1.md' }),
    );
    expect(container.querySelector('[data-tool-name="piwin_plan_create"]')).toBeNull();
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

  it('does not dock the gate above the composer for a draft plan', () => {
    const { container, root } = renderNode(
      <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WorkbenchPermissionBar
            state={projectState()}
            sidebarMode="code"
            extensionUiRequest={null}
            sessionPlan={draftPlan()}
            onPermission={() => undefined}
            onExtensionUiResolve={() => undefined}
          />
        </PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
    expect(container.querySelector('[data-testid="plan-execution-gate"]')).toBeNull();
    expect(container.querySelector('[data-testid="plan-todo-tray"]')).toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it('does not show the gate in Conversation (general) scope', () => {
    const { container, root } = renderNode(
      <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WorkbenchPermissionBar
            state={createInitialChatUiState()}
            sidebarMode="chat"
            extensionUiRequest={null}
            sessionPlan={draftPlan()}
            onPermission={() => undefined}
            onExtensionUiResolve={() => undefined}
          />
        </PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
    expect(container.querySelector('[data-testid="plan-execution-gate"]')).toBeNull();
    expect(container.querySelector('[data-testid="plan-todo-tray"]')).toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it('lets a permission prompt occupy the composer slot', () => {
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
            sidebarMode="code"
            extensionUiRequest={null}
            sessionPlan={draftPlan()}
            onPermission={() => undefined}
            onExtensionUiResolve={() => undefined}
          />
        </PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
    expect(container.querySelector('[data-testid="permission-bar"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="plan-execution-gate"]')).toBeNull();
    // Draft plans do not show the live tray; permission owns the slot alone.
    expect(container.querySelector('[data-testid="plan-todo-tray"]')).toBeNull();
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
            sidebarMode="chat"
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



  it('shows the live plan list above the composer for an executing plan', () => {
    const { container, root } = renderNode(
      <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WorkbenchPermissionBar
            state={{ ...projectState(), streaming: true }}
            sidebarMode="code"
            extensionUiRequest={null}
            sessionPlan={draftPlan({
              status: 'executing',
              execution: {
                sessionId: 's1',
                planId: 'p1',
                mode: 'inline',
                status: 'running',
                childSessionIds: [],
              },
            })}
            onPermission={() => undefined}
            onExtensionUiResolve={() => undefined}
          />
        </PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
    expect(container.querySelector('[data-testid="plan-todo-tray"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="plan-execution-gate"]')).toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it('hides the live plan list once every step is complete', () => {
    const { container, root } = renderNode(
      <DesktopLocaleProvider locale="zh-CN" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WorkbenchPermissionBar
            state={projectState()}
            sidebarMode="code"
            extensionUiRequest={null}
            sessionPlan={draftPlan({
              status: 'executing',
              steps: [
                { id: '1', title: 'Design', status: 'done' },
                { id: '2', title: 'Implement', status: 'done' },
              ],
            })}
            onPermission={() => undefined}
            onExtensionUiResolve={() => undefined}
          />
        </PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
    expect(container.querySelector('[data-testid="plan-todo-tray"]')).toBeNull();
    act(() => root.unmount());
    container.remove();
  });
});
