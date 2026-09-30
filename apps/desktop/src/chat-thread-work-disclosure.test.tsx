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
import { setWorkChainCompact } from './work-chain-compact.js';

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
    // Opened, the running segment stays folded: its own header says what is in
    // flight (the turn header no longer repeats the command), and its rows
    // mount when the reader opens it.
    const segmentHeader = container.querySelector<HTMLButtonElement>(
      '[data-testid="turn-work-segment-header"]',
    );
    expect(segmentHeader?.textContent).toContain('Executing');
    expect(segmentHeader?.textContent).toContain('edit');
    expect(container.querySelector('#msg-work-1')).toBeNull();
    expect(container.querySelector('#msg-live-1')).toBeNull();
    act(() => segmentHeader?.click());
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
    // Each caption opens a segment. The captions are prose and show either
    // way; the tools stay folded (the running segment by default, the settled
    // earlier one because it is not the newest) until the reader opens them.
    const segments = container.querySelectorAll('[data-testid="turn-work-segment"]');
    expect(segments).toHaveLength(2);
    expect(segments[0]?.getAttribute('data-open')).toBe('false');
    expect(segments[1]?.getAttribute('data-open')).toBe('false');
    expect(container.querySelector('#msg-work-1 .markdown')?.textContent).toContain(earlierCaption);
    expect(container.querySelector('#msg-work-2 .markdown')?.textContent).toContain(lastCaption);
    expect(container.querySelectorAll('[data-testid="tool-call-card"]')).toHaveLength(0);

    act(() =>
      segments[0]
        ?.querySelector<HTMLButtonElement>('[data-testid="turn-work-segment-header"]')
        ?.click(),
    );
    expect(container.querySelectorAll('[data-testid="tool-call-card"]')).toHaveLength(1);
    expect(container.querySelector('#msg-work-1 .markdown')?.textContent).toContain(earlierCaption);
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

  it('keeps a collapse header when a live tool has already failed', () => {
    const messages = [
      message('user-1', { role: 'user', text: 'Find the button.' }),
      message('work-1', {
        thinking: 'Searching.',
        runId: 'run-1',
        tools: [
          {
            toolCallId: 'bash-1',
            toolName: 'bash',
            status: 'error',
            output: 'exit 1',
            runId: 'run-1',
          },
        ],
      }),
      message('work-2', {
        runId: 'run-1',
        tools: [
          {
            toolCallId: 'read-2',
            toolName: 'read',
            status: 'running',
            output: '',
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
          runRecordsById: {},
        }),
      ),
    );

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="turn-work-disclosure-trigger"]',
    );
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('#msg-work-1')).not.toBeNull();

    act(() => trigger?.click());

    expect(container.querySelector('[data-testid="turn-work-disclosure-trigger"]')).not.toBeNull();
    expect(container.querySelector('#msg-work-1')).toBeNull();
    expect(container.querySelector('#msg-work-2')).toBeNull();
  });

  it('folds into 已工作 once at settle even if the user expanded the live chain', () => {
    const liveMessages = [
      message('user-1', { role: 'user', text: 'Implement it.' }),
      message('work-1', {
        runId: 'run-1',
        tools: [
          { toolCallId: 'read-1', toolName: 'read', status: 'done', output: '', runId: 'run-1' },
        ],
      }),
      message('work-2', {
        runId: 'run-1',
        status: 'streaming',
        tools: [
          { toolCallId: 'bash-1', toolName: 'bash', status: 'running', output: '', runId: 'run-1' },
        ],
      }),
    ];
    act(() =>
      root.render(
        renderThread(liveMessages, {
          streaming: true,
          activeRunId: 'run-1',
          runRecordsById: {
            'run-1': { runId: 'run-1', phaseHistory: [], startedAt: 1_000, endedAt: null },
          },
        }),
      ),
    );
    const trigger = (): HTMLButtonElement | null =>
      container.querySelector<HTMLButtonElement>('[data-testid="turn-work-disclosure-trigger"]');
    act(() => trigger()?.click());
    expect(trigger()?.getAttribute('aria-expanded')).toBe('true');
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="turn-work-segment-header"]')
        ?.click(),
    );
    expect(container.querySelector('#msg-work-1')).not.toBeNull();

    const settledMessages = [
      ...liveMessages.slice(0, 2),
      message('work-2', {
        runId: 'run-1',
        tools: [
          { toolCallId: 'bash-1', toolName: 'bash', status: 'done', output: '', runId: 'run-1' },
        ],
      }),
      message('answer-1', { runId: 'run-1', text: 'Done.' }),
    ];
    act(() => root.render(renderThread(settledMessages)));

    expect(trigger()?.getAttribute('aria-expanded')).toBe('false');
    expect(trigger()?.textContent).toContain('Worked for');
    expect(container.querySelector('#msg-work-1')).toBeNull();
    expect(container.querySelector('#msg-answer-1')?.textContent).toContain('Done.');

    // After settle the reader's own toggle sticks.
    act(() => trigger()?.click());
    act(() => root.render(renderThread(settledMessages)));
    expect(trigger()?.getAttribute('aria-expanded')).toBe('true');
  });

  it('folds a settled browser-driving turn whose screenshots attach media', () => {
    const screenshot = {
      id: 'shot-1',
      kind: 'media' as const,
      path: '/media/shot-1.jpg',
      mimeType: 'image/jpeg',
      byteSize: 10,
      source: 'generated' as const,
    };
    const messages = [
      message('user-1', { role: 'user', text: 'Check the page.' }),
      message('work-1', {
        runId: 'run-1',
        text: 'Taking a screenshot.',
        attachments: [screenshot],
        tools: [
          {
            toolCallId: 'shot',
            toolName: 'browser_screenshot',
            status: 'done',
            output: '',
            runId: 'run-1',
          },
        ],
      }),
      message('work-2', {
        runId: 'run-1',
        tools: [
          { toolCallId: 'bash-1', toolName: 'bash', status: 'done', output: '', runId: 'run-1' },
        ],
      }),
      message('answer-1', { runId: 'run-1', text: 'Looks right.' }),
    ];
    act(() => root.render(renderThread(messages)));

    const trigger = container.querySelector<HTMLButtonElement>(
      '[data-testid="turn-work-disclosure-trigger"]',
    );
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('#msg-work-1')).toBeNull();
    expect(container.querySelector('#msg-answer-1')?.textContent).toContain('Looks right.');
  });
});

describe('ChatThread 已工作 segments', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    setWorkChainCompact(false);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    setWorkChainCompact(false);
  });

  function settledChain(steps: number): ChatMessageUi[] {
    const work = Array.from({ length: steps }, (_, index) =>
      message(`work-${index}`, {
        text: `Step ${index}.`,
        runId: 'run-1',
        tools: [
          {
            toolCallId: `bash-${index}`,
            toolName: 'bash',
            status: 'done',
            output: 'ok',
            runId: 'run-1',
            presentation: { kind: 'shell', title: 'bash', command: 'pnpm test' },
          },
        ],
      }),
    );
    return [
      message('user-1', { role: 'user', text: 'Fix it.' }),
      ...work,
      message('answer', { text: 'Done.', runId: 'run-1' }),
    ];
  }

  function openFold(): void {
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="turn-work-disclosure-trigger"]')
        ?.click(),
    );
  }

  it('lists segments and mounts rows only for the open ones', () => {
    act(() => root.render(renderThread(settledChain(3))));
    openFold();

    const segments = container.querySelectorAll('[data-testid="turn-work-segment"]');
    expect(Array.from(segments, (segment) => segment.getAttribute('data-open'))).toEqual([
      'false',
      'false',
      'true',
    ]);
    // Every step's narration is on screen; only the newest step's tool is mounted.
    for (const index of [0, 1, 2]) {
      expect(container.querySelector(`#msg-work-${index} .markdown`)?.textContent).toContain(
        `Step ${index}.`,
      );
    }
    expect(container.querySelectorAll('[data-testid="tool-call-card"]')).toHaveLength(1);
    // The tools row owns no `msg-` anchor (the narration row does), so look
    // inside the segment rather than for an id.
    expect(segments[2]?.querySelector('[data-testid="tool-call-card"]')).not.toBeNull();
    expect(segments[0]?.querySelector('[data-testid="tool-call-card"]')).toBeNull();
    expect(container.querySelector('#msg-answer')).not.toBeNull();
  });

  it('精简 closes every segment and keeps a segment the reader opened', () => {
    act(() => root.render(renderThread(settledChain(3))));
    openFold();
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="turn-work-segment-header"]')
        ?.click(),
    );
    expect(container.querySelectorAll('[data-testid="tool-call-card"]')).toHaveLength(2);

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="work-chain-compact-toggle"]',
    );
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
    act(() => toggle?.click());

    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    // 精简 folds the tools of every segment but the one the reader opened; the
    // narration stays.
    expect(container.querySelectorAll('[data-testid="tool-call-card"]')).toHaveLength(1);
    expect(
      container
        .querySelectorAll('[data-testid="turn-work-segment"]')[0]
        ?.querySelector('[data-testid="tool-call-card"]'),
    ).not.toBeNull();
    expect(container.querySelector('#msg-work-2 .markdown')?.textContent).toContain('Step 2.');
  });

  it('heads each step 「Ran … · N tools」 like the turn fold, and the narration stays outside it', () => {
    act(() => root.render(renderThread(settledChain(3))));
    openFold();

    const first = container.querySelector('[data-testid="turn-work-segment"]');
    const header = first?.querySelector('[data-testid="turn-work-segment-header"]');
    expect(header?.textContent).toContain('Ran');
    expect(header?.textContent).toContain('1 tool');
    // The header carries the run glyph, not the turn fold's bulb.
    expect(header?.querySelector('.work-fold-run')).not.toBeNull();
    expect(header?.querySelector('.work-fold-bulb')).toBeNull();
    // Narration is a sibling of the fold, not part of its header.
    expect(header?.textContent).not.toContain('Step 0.');
    expect(first?.querySelector('#msg-work-0')).not.toBeNull();
  });

  it('collapses an open step from its spine and, past a few tools, from a foot bar', () => {
    const many = message('work-big', {
      text: 'Big step.',
      runId: 'run-1',
      tools: Array.from({ length: 9 }, (_, index) => ({
        toolCallId: `t-${index}`,
        toolName: 'bash',
        status: 'done' as const,
        output: 'ok',
        runId: 'run-1',
        presentation: { kind: 'shell' as const, title: 'bash', command: `echo ${index}` },
      })),
    });
    act(() =>
      root.render(
        renderThread([
          message('user-1', { role: 'user', text: 'Fix it.' }),
          many,
          message('answer', { text: 'Done.', runId: 'run-1' }),
        ]),
      ),
    );
    openFold();

    const segment = (): Element | null =>
      container.querySelector('[data-testid="turn-work-segment"]');
    expect(segment()?.getAttribute('data-open')).toBe('true');
    expect(segment()?.querySelector('[data-testid="turn-work-segment-foot"]')).not.toBeNull();
    act(() =>
      segment()
        ?.querySelector<HTMLButtonElement>('[data-testid="turn-work-segment-foot"]')
        ?.click(),
    );
    expect(segment()?.getAttribute('data-open')).toBe('false');
    expect(container.querySelectorAll('[data-testid="tool-call-card"]')).toHaveLength(0);
    expect(container.querySelector('#msg-work-big .markdown')?.textContent).toContain('Big step.');

    // Reopened, the spine folds it again.
    act(() =>
      segment()
        ?.querySelector<HTMLButtonElement>('[data-testid="turn-work-segment-header"]')
        ?.click(),
    );
    act(() =>
      segment()
        ?.querySelector<HTMLButtonElement>('[data-testid="turn-work-segment-guide"]')
        ?.click(),
    );
    expect(segment()?.getAttribute('data-open')).toBe('false');
  });

  it('keeps older segments unmounted until asked for', () => {
    act(() => root.render(renderThread(settledChain(45))));
    openFold();

    expect(container.querySelectorAll('[data-testid="turn-work-segment"]')).toHaveLength(40);
    const earlier = container.querySelector<HTMLButtonElement>(
      '[data-testid="turn-work-segment-earlier"]',
    );
    expect(earlier?.textContent).toContain('5');
    act(() => earlier?.click());
    expect(container.querySelectorAll('[data-testid="turn-work-segment"]')).toHaveLength(45);
    expect(container.querySelector('[data-testid="turn-work-segment-earlier"]')).toBeNull();
  });
});
