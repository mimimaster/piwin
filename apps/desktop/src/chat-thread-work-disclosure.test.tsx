// @vitest-environment happy-dom
import type { PlanDisplayPayload, SessionPlan } from '@piwin/contracts';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import type { ChatMessageUi, RunRecordUi } from './chat-reducer.js';
import { ChatThread } from './chat-thread.js';
import type { ComposerDockProps } from './composer-dock.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function noop(): void {
  /* test callback */
}

const composerCard: ComposerDockProps = {
  layoutMode: 'docked',
  projectPath: null,
  projectTrusted: true,
  activeSessionId: null,
  streaming: false,
  runPhase: 'idle',
  compacting: false,
  composer: '',
  onComposerChange: noop,
  agentMode: 'agent',
  onAgentModeChange: noop,
  pendingAttachments: [],
  onRemoveAttachment: noop,
  dropActive: false,
  onDropActiveChange: noop,
  plusMenuOpen: false,
  onPlusMenuOpenChange: noop,
  plusSubmenu: 'none',
  onPlusSubmenuChange: noop,
  modelOptions: [],
  selectedModelKey: '',
  onSelectModel: noop,
  menuSkills: [],
  menuMcp: [],
  onRefreshComposerMenus: noop,
  onOpenSkillsPanel: noop,
  onOpenMcpPanel: noop,
  onAttachFile: noop,
  onAttachImage: noop,
  onPaste: noop,
  onDrop: noop,
  onSend: noop,
  onPause: noop,
  onAbort: noop,
  onCompact: noop,
  contextUsage: null,
  onSteer: noop,
  onFollowUp: noop,
};

function message(id: string, overrides: Partial<ChatMessageUi>): ChatMessageUi {
  return {
    id,
    role: 'assistant',
    text: '',
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
    ...overrides,
  };
}

function renderThread(
  messages: ChatMessageUi[],
  extras: {
    streaming?: boolean;
    activeRunId?: string | null;
    runRecordsById?: Record<string, RunRecordUi>;
    isConversationSession?: boolean;
    onPlanExecute?: (display: PlanDisplayPayload, mode: 'inline' | 'subagent-driven') => void;
    sessionPlan?: SessionPlan | null;
  } = {},
): ReactElement {
  return (
    <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <ChatThread
        messages={messages}
        {...(extras.onPlanExecute ? { onPlanExecute: extras.onPlanExecute } : {})}
        {...(extras.sessionPlan !== undefined ? { sessionPlan: extras.sessionPlan } : {})}
        sessionId="disclosure-session"
        streaming={extras.streaming === true}
        editingMessageId={null}
        lastUserMessageId="user-1"
        activeTheme={null}
        artifactThemeKey={0}
        runRecordsById={
          extras.runRecordsById ?? {
            'run-1': {
              runId: 'run-1',
              phaseHistory: [],
              startedAt: 1_000,
              endedAt: 95_000,
              outcome: 'completed',
            },
          }
        }
        activeRunId={extras.activeRunId === undefined ? null : extras.activeRunId}
        onEdit={noop}
        onCancelEdit={noop}
        onEditResend={noop}
        onRetry={noop}
        onInspectSubagent={undefined}
        artifactInlineEnabled
        composerCard={composerCard}
        locale="en"
        {...(extras.isConversationSession === true
          ? { isConversationSession: true }
          : {})}
      />
    </PiwinUiProvider>
  );
}

describe('ChatThread completed work disclosure', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders a plan card after present once the settled turn completes', () => {
    const plan: SessionPlan = {
      id: 'plan', sessionId: 'session-1', projectPath: '/tmp', status: 'draft',
      title: 'Web 手机响应式适配', goal: 'Mobile layout',
      steps: [{ id: 'one', title: 'Fix viewport', status: 'pending' }],
      revision: 0, createdAt: '2026-09-11T09:37:29.150Z',
      updatedAt: '2026-09-11T09:37:29.150Z', source: 'assistant',
    };
    const onPlanExecute = vi.fn();
    const messages = [
      message('user-plan', { role: 'user', text: '继续吧' }),
      message('plan-create', { runId: 'run-plan', tools: [{
        toolCallId: 'create', toolName: 'piwin_plan_create', status: 'done',
        output: 'draft plan created', runId: 'run-plan',
      }] }),
      message('plan-read', { runId: 'run-plan', tools: [{
        toolCallId: 'read', toolName: 'read', status: 'done', output: 'source', runId: 'run-plan',
      }] }),
      message('plan-answer', {
        text: '实施计划已生成。',
        runId: 'run-plan',
        tools: [{
          toolCallId: 'present', toolName: 'piwin_plan_present', status: 'done',
          output: 'ready', runId: 'run-plan',
          presentation: {
            kind: 'other',
            title: 'piwin_plan_present',
            plan: {
              version: 1,
              path: '/tmp/.piwin/sessions/session-1/plan.json',
              displayPath: 'plans/session-1.md',
              plan,
            },
          },
        }],
      }),
    ];
    const runRecordsById = {
      'run-plan': {
        runId: 'run-plan',
        status: 'completed' as const,
        phaseHistory: [],
        startedAt: 1_000,
        endedAt: 2_000,
        outcome: 'completed' as const,
      },
    };
    act(() =>
      root.render(
        renderThread(messages, {
          onPlanExecute,
          streaming: true,
          activeRunId: 'run-plan',
          runRecordsById,
        }),
      ),
    );
    expect(container.querySelector('[data-testid="plan-execution-gate"]')).toBeNull();
    act(() => root.render(renderThread(messages, { onPlanExecute, runRecordsById })));
    expect(container.querySelectorAll('[data-testid="plan-execution-gate"]')).toHaveLength(1);
    const gate = container.querySelector('[data-testid="plan-execution-gate"]');
    expect(gate?.textContent).toContain(plan.title);
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="plan-mode-inline"]')?.click());
    expect(onPlanExecute).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/tmp/.piwin/sessions/session-1/plan.json' }),
      'inline',
    );
  });

  it('still shows the plan card when present is followed by a final text summary', () => {
    const plan: SessionPlan = {
      id: 'plan', sessionId: 'session-1', projectPath: '/tmp', status: 'draft',
      title: 'Web 手机响应式适配', goal: 'Mobile layout',
      steps: [{ id: 'one', title: 'Fix viewport', status: 'pending' }],
      revision: 0, createdAt: '2026-09-11T09:37:29.150Z',
      updatedAt: '2026-09-11T09:37:29.150Z', source: 'assistant',
    };
    const messages = [
      message('user-plan', { role: 'user', text: '写个计划' }),
      message('plan-present', {
        runId: 'run-plan',
        tools: [{
          toolCallId: 'present', toolName: 'piwin_plan_present', status: 'done',
          output: 'ready', runId: 'run-plan',
          presentation: {
            kind: 'other',
            title: 'piwin_plan_present',
            plan: {
              version: 1,
              path: '/tmp/.piwin/sessions/session-1/plan.json',
              displayPath: 'plans/session-1.md',
              plan,
            },
          },
        }],
      }),
      message('plan-summary', {
        text: '计划已写好。请选择 inline 或子代理执行。',
        runId: 'run-plan',
      }),
    ];
    const runRecordsById = {
      'run-plan': {
        runId: 'run-plan',
        status: 'completed' as const,
        phaseHistory: [],
        startedAt: 1_000,
        endedAt: 2_000,
        outcome: 'completed' as const,
      },
    };
    act(() => root.render(renderThread(messages, { onPlanExecute: vi.fn(), runRecordsById })));
    expect(container.querySelectorAll('[data-testid="plan-execution-gate"]')).toHaveLength(1);
  });

  it('uses the present tool run when the final summary has no runId', () => {
    const plan: SessionPlan = {
      id: 'plan', sessionId: 'session-1', projectPath: '/tmp', status: 'draft',
      title: 'Web 手机响应式适配', goal: 'Mobile layout',
      steps: [{ id: 'one', title: 'Fix viewport', status: 'pending' }],
      revision: 0, createdAt: '2026-09-11T09:37:29.150Z',
      updatedAt: '2026-09-11T09:37:29.150Z', source: 'assistant',
    };
    const messages = [
      message('user-plan', { role: 'user', text: '写个计划' }),
      message('plan-present', {
        runId: 'run-plan',
        tools: [{
          toolCallId: 'present', toolName: 'piwin_plan_present', status: 'done',
          output: 'ready', runId: 'run-plan',
          presentation: {
            kind: 'other',
            title: 'piwin_plan_present',
            plan: {
              version: 1,
              path: '/tmp/.piwin/sessions/session-1/plan.json',
              displayPath: 'plans/session-1.md',
              plan,
            },
          },
        }],
      }),
      message('plan-summary', {
        text: '计划已写好。请选择当前会话执行，还是子代理执行？',
      }),
    ];
    const runRecordsById = {
      'run-plan': {
        runId: 'run-plan',
        status: 'completed' as const,
        phaseHistory: [],
        startedAt: 1_000,
        endedAt: 2_000,
        outcome: 'completed' as const,
      },
    };
    act(() => root.render(renderThread(messages, { onPlanExecute: vi.fn(), runRecordsById })));
    expect(container.querySelectorAll('[data-testid="plan-execution-gate"]')).toHaveLength(1);
  });

  it('keeps an old card visible but not choosable after the live plan starts', () => {
    const plan: SessionPlan = {
      id: 'plan', sessionId: 'session-1', projectPath: '/tmp', status: 'draft',
      title: 'Web 手机响应式适配', goal: 'Mobile layout',
      steps: [{ id: 'one', title: 'Fix viewport', status: 'pending' }],
      revision: 0, createdAt: '2026-09-11T09:37:29.150Z',
      updatedAt: '2026-09-11T09:37:29.150Z', source: 'assistant',
    };
    const messages = [
      message('user-plan', { role: 'user', text: '写个计划' }),
      message('plan-present', {
        runId: 'run-plan',
        tools: [{
          toolCallId: 'present', toolName: 'piwin_plan_present', status: 'done',
          output: 'ready', runId: 'run-plan',
          presentation: {
            kind: 'other',
            title: 'piwin_plan_present',
            plan: {
              version: 1,
              path: '/tmp/.piwin/sessions/session-1/plan.json',
              displayPath: 'plans/session-1.md',
              plan,
            },
          },
        }],
      }),
    ];
    const runRecordsById = {
      'run-plan': {
        runId: 'run-plan',
        status: 'completed' as const,
        phaseHistory: [],
        startedAt: 1_000,
        endedAt: 2_000,
        outcome: 'completed' as const,
      },
    };
    act(() =>
      root.render(
        renderThread(messages, {
          onPlanExecute: vi.fn(),
          runRecordsById,
          sessionPlan: {
            ...plan,
            status: 'executing',
            revision: 1,
            execution: {
              sessionId: 'session-1',
              planId: 'plan',
              mode: 'inline',
              status: 'running',
              childSessionIds: [],
            },
          },
        }),
      ),
    );
    const gate = container.querySelector('[data-testid="plan-execution-gate"]');
    expect(gate).not.toBeNull();
    expect(gate?.getAttribute('data-action-state')).toBe('stale');
    expect(container.querySelector<HTMLButtonElement>('[data-testid="plan-mode-inline"]')?.disabled).toBe(
      true,
    );
  });

  it('unmounts completed work by default and restores the unchanged rows on demand', () => {
    const messages = [
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        thinking: 'Inspecting the implementation.',
        runId: 'run-1',
        tools: [
          {
            toolCallId: 'read-1',
            toolName: 'read_file',
            status: 'done',
            output: 'source',
            runId: 'run-1',
          },
        ],
      }),
      message('answer-1', {
        text: 'Implemented and verified.',
        runId: 'run-1',
      }),
    ];

    act(() => root.render(renderThread(messages)));

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="turn-work-disclosure-trigger"]',
    );
    expect(trigger?.textContent).toContain('Worked for 1m 34s');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('#msg-work-1')).toBeNull();
    expect(container.querySelector('#msg-answer-1')?.textContent).toContain(
      'Implemented and verified.',
    );

    act(() => trigger?.click());

    expect(container.querySelector('#msg-work-1')).not.toBeNull();
    expect(container.querySelector('#msg-answer-1')?.textContent).toContain(
      'Implemented and verified.',
    );
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
  });

  it('folds the live chain behind one running header and unmounts its rows', () => {
    const messages = [
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        thinking: 'Inspecting the implementation.',
        runId: 'run-live',
        tools: [
          {
            toolCallId: 'read-1',
            toolName: 'read',
            status: 'done',
            output: 'source',
            runId: 'run-live',
          },
        ],
      }),
      message('live-1', {
        thinking: 'Editing the file.',
        runId: 'run-live',
        status: 'streaming',
        tools: [
          {
            toolCallId: 'edit-1',
            toolName: 'edit',
            status: 'running',
            output: '',
            runId: 'run-live',
          },
        ],
      }),
    ];

    act(() =>
      root.render(
        renderThread(messages, {
          streaming: true,
          activeRunId: 'run-live',
          runRecordsById: {
            'run-live': {
              runId: 'run-live',
              phaseHistory: [],
              startedAt: 1_000,
              endedAt: null,
            },
          },
        }),
      ),
    );

    const disclosure = container.querySelector('[data-testid="turn-work-disclosure"]');
    expect(disclosure?.getAttribute('data-live')).toBe('true');
    // The chain is the fold now: its rows stay unmounted until the user opens it.
    expect(container.querySelector('#msg-work-1')).toBeNull();
    expect(container.querySelector('#msg-live-1')).toBeNull();

    // The running edit is what the header names (this harness renders in `en`).
    const trigger = container.querySelector<HTMLElement>(
      '[data-testid="turn-work-disclosure-trigger"]',
    );
    expect(trigger?.textContent).toContain('Running');
    expect(trigger?.textContent).toContain('tool 2');

    act(() => trigger?.click());
    expect(container.querySelector('#msg-work-1')).not.toBeNull();
    expect(container.querySelector('#msg-live-1')).not.toBeNull();
  });

  it('does not tuck a mid-turn user-facing reply into the process disclosure', () => {
    const messages = [
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        thinking: 'Inspecting.',
        runId: 'run-1',
        tools: [
          {
            toolCallId: 'read-1',
            toolName: 'read',
            status: 'done',
            output: 'source',
            runId: 'run-1',
          },
        ],
      }),
      message('answer-mid', {
        text: 'Here is the plan before I continue.',
        runId: 'run-1',
      }),
      message('work-2', {
        runId: 'run-1',
        tools: [
          {
            toolCallId: 'edit-1',
            toolName: 'edit',
            status: 'done',
            output: 'ok',
            runId: 'run-1',
          },
        ],
      }),
      message('answer-1', {
        text: 'Implemented and verified.',
        runId: 'run-1',
      }),
    ];

    act(() => root.render(renderThread(messages)));

    expect(container.querySelector('[data-testid="turn-work-disclosure"]')).toBeNull();
    expect(container.querySelector('#msg-answer-mid .markdown')?.textContent).toContain(
      'Here is the plan before I continue.',
    );
    expect(container.querySelector('#msg-answer-1 .markdown')?.textContent).toContain(
      'Implemented and verified.',
    );
  });

  it('keeps an image caption as the turn reply while folding earlier process rows', () => {
    const processCaption = '接着去生成图片。';
    const imageCaption = 'Here is the image.';
    const messages = [
      message('user-1', { role: 'user', text: 'Draw a pelican.' }),
      message('work-1', {
        text: processCaption,
        thinking: 'Need a reference.',
        runId: 'run-1',
        tools: [
          {
            toolCallId: 'read-1',
            toolName: 'read',
            status: 'done',
            output: 'ok',
            runId: 'run-1',
          },
        ],
      }),
      message('image-1', {
        text: imageCaption,
        runId: 'run-1',
        tools: [
          {
            toolCallId: 'gen-1',
            toolName: 'image_gen',
            status: 'done',
            output: 'ok',
            runId: 'run-1',
          },
        ],
      }),
    ];

    act(() => root.render(renderThread(messages)));

    expect(container.querySelector('#msg-work-1')).toBeNull();
    expect(container.textContent).not.toContain(processCaption);
    expect(container.querySelector('#msg-image-1 .markdown')?.textContent).toContain(imageCaption);

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="turn-work-disclosure-trigger"]',
    );
    act(() => trigger?.click());
    expect(container.querySelector('#msg-work-1 .markdown')?.textContent).toContain(processCaption);
    expect(
      container.querySelector('#msg-image-1 [data-testid="assistant-response-actions"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('#msg-image-1 [data-testid="response-copy-btn"]'),
    ).not.toBeNull();
  });

  it('folds intermediate process rows with captions into a single running disclosure during a live turn', () => {
    const earlierCaption = '先读文件。';
    const lastCaption = '接着改这一处。';
    const messages = [
      message('user-1', { role: 'user', text: 'Fix it.' }),
      message('work-1', {
        text: earlierCaption,
        thinking: 'Inspecting.',
        runId: 'run-1',
        tools: [
          {
            toolCallId: 'read-1',
            toolName: 'read',
            status: 'done',
            output: 'ok',
            runId: 'run-1',
          },
        ],
      }),
      message('work-2', {
        text: lastCaption,
        thinking: 'Editing.',
        runId: 'run-1',
        tools: [
          {
            toolCallId: 'edit-1',
            toolName: 'edit',
            status: 'running',
            output: 'ok',
            runId: 'run-1',
          },
        ],
      }),
    ];

    act(() =>
      root.render(
        renderThread(messages, {
          streaming: true,
          activeRunId: 'run-1',
          runRecordsById: {
            'run-1': {
              runId: 'run-1',
              phaseHistory: [],
              startedAt: 1_000,
              endedAt: null,
            },
          },
        }),
      ),
    );

    const disclosure = container.querySelector('[data-testid="turn-work-disclosure"]');
    expect(disclosure).not.toBeNull();
    expect(disclosure?.getAttribute('data-live')).toBe('true');
    expect(container.querySelector('#msg-work-1')).toBeNull();
    expect(container.querySelector('#msg-work-2')).toBeNull();

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="turn-work-disclosure-trigger"]',
    );
    expect(trigger?.textContent).toContain(lastCaption);

    act(() => trigger?.click());
    expect(container.querySelector('#msg-work-1')).not.toBeNull();
    expect(container.querySelector('#msg-work-2')).not.toBeNull();
    expect(container.querySelector('#msg-work-1 .markdown')?.textContent).toContain(earlierCaption);
    expect(container.querySelector('#msg-work-2 .markdown')?.textContent).toContain(lastCaption);
  });

  it('keeps the Conversation identity header above 已工作 after expand', () => {
    const messages = [
      message('user-1', { role: 'user', text: 'read the page' }),
      message('work-1', {
        thinking: 'I will fetch the URL',
        runId: 'run-1',
        model: { protocol: 'openai-compatible', providerId: 'xai', modelId: 'grok-4.6' },
        tools: [
          {
            toolCallId: 'fetch-1',
            toolName: 'web_fetch',
            status: 'done',
            output: 'ok',
            runId: 'run-1',
          },
        ],
      }),
      message('answer-1', {
        text: '页首内容已读取。',
        runId: 'run-1',
        model: { protocol: 'openai-compatible', providerId: 'xai', modelId: 'grok-4.6' },
      }),
    ];

    act(() => root.render(renderThread(messages, { isConversationSession: true })));

    const orderOf = (): string[] =>
      [...container.querySelectorAll(
        '[data-testid="conversation-turn-identity"], [data-testid="turn-work-disclosure"], #msg-work-1, #msg-answer-1',
      )].map((node) => node.id || node.getAttribute('data-testid') || '');

    expect(orderOf()).toEqual([
      'conversation-turn-identity',
      'turn-work-disclosure',
      'msg-answer-1',
    ]);
    expect(container.querySelector('#msg-work-1')).toBeNull();
    expect(container.querySelectorAll('[data-testid="conversation-message-header"]')).toHaveLength(
      1,
    );

    act(() => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="turn-work-disclosure-trigger"]')
        ?.click();
    });

    expect(orderOf()).toEqual([
      'conversation-turn-identity',
      'turn-work-disclosure',
      'msg-work-1',
      'msg-answer-1',
    ]);
    expect(
      container.querySelector('#msg-work-1 [data-testid="conversation-message-header"]'),
    ).toBeNull();
    expect(
      container.querySelector('#msg-answer-1 [data-testid="conversation-message-header"]'),
    ).toBeNull();
    expect(container.querySelectorAll('[data-testid="conversation-message-header"]')).toHaveLength(
      1,
    );
    expect(
      container.querySelector('[data-testid="conversation-message-model-name"]')?.textContent,
    ).toBe('grok-4.6');
  });

  it('unmounts completed work when the last assistant mixed tools with the answer', () => {
    const messages = [
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        thinking: 'Inspecting the implementation.',
        runId: 'run-1',
        tools: [
          {
            toolCallId: 'read-1',
            toolName: 'read_file',
            status: 'done',
            output: 'source',
            runId: 'run-1',
          },
        ],
      }),
      message('answer-1', {
        text: 'Implemented and verified.',
        runId: 'run-1',
        tools: [
          {
            toolCallId: 'edit-1',
            toolName: 'edit',
            status: 'done',
            output: 'ok',
            runId: 'run-1',
          },
        ],
      }),
    ];

    act(() => root.render(renderThread(messages)));

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="turn-work-disclosure-trigger"]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('#msg-work-1')).toBeNull();
    expect(container.querySelector('#msg-answer-1')?.textContent).toContain(
      'Implemented and verified.',
    );
  });

  it('unmounts a settled process-only turn that never emitted a separate reply', () => {
    const messages = [
      message('user-1', { role: 'user', text: 'Implement this.' }),
      message('work-1', {
        thinking: 'Inspecting the implementation.',
        runId: 'run-1',
        tools: [
          {
            toolCallId: 'read-1',
            toolName: 'read',
            status: 'done',
            output: 'source',
            runId: 'run-1',
          },
        ],
      }),
      message('work-2', {
        thinking: 'Editing.',
        runId: 'run-1',
        tools: [
          {
            toolCallId: 'edit-1',
            toolName: 'edit',
            status: 'done',
            output: 'ok',
            runId: 'run-1',
          },
        ],
      }),
    ];

    act(() => root.render(renderThread(messages)));

    expect(container.querySelector('[data-testid="turn-work-disclosure-trigger"]')).not.toBeNull();
    expect(container.querySelector('#msg-work-1')).toBeNull();
    expect(container.querySelector('#msg-work-2')).toBeNull();
  });
});
