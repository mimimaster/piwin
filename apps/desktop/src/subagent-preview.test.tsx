// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { SubagentInvocation } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import type { ChatMessageUi, SubagentStreamState } from './chat-reducer';
import { SubagentPreview } from './subagent-preview';
import {
  SubagentInspectorProvider,
  type SubagentInspectorPanelData,
} from './subagent-inspector-context';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const invocation: SubagentInvocation = {
  id: 'inv-1',
  parentSessionId: 'parent-1',
  runId: 'run-1',
  taskId: 'task-1',
  task: 'Find every refreshToken call site',
  role: 'scout',
  childSessionId: 'child-1',
  status: 'completed',
  activity: { kind: 'completed', summary: 'short' },
  usage: { toolCalls: 2, totalTokens: 4_200, requests: 1 },
  revision: 3,
  createdAt: '2026-10-14T10:00:00.000Z',
  updatedAt: '2026-10-14T10:00:42.000Z',
};

const history: ChatMessageUi[] = [
  {
    id: 'm1',
    role: 'assistant',
    text: '# Report\n**7 call sites**, 2 bypass the interceptor.',
    thinking: '',
    tools: [
      {
        toolCallId: 't1',
        toolName: 'read',
        status: 'done',
        output: 'file body that must not render',
        presentation: { kind: 'filesystem', title: 'Read', targetPaths: ['src/auth.ts'] },
      },
    ],
    attachments: [],
    status: 'done',
  },
];

describe('SubagentPreview', () => {
  const mounted: Array<{ root: Root; container: HTMLElement }> = [];

  afterEach(() => {
    for (const entry of mounted.splice(0)) {
      act(() => entry.root.unmount());
      entry.container.remove();
    }
  });

  function renderPreview(overrides: Partial<SubagentInspectorPanelData> = {}): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    const panel: SubagentInspectorPanelData = {
      status: 'completed',
      messages: history,
      liveTail: null,
      loading: false,
      error: null,
      invocation,
      onRetry: vi.fn(),
      onClose: vi.fn(),
      ...overrides,
    };
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentInspectorProvider
            toggle={{
              selection: {
                childSessionId: 'child-1',
                displayName: 'Scout',
                taskSummary: 'fallback task',
                anchorId: 'inv-1',
              },
              toggle: vi.fn(),
            }}
            panel={panel}
          >
            <SubagentPreview />
          </SubagentInspectorProvider>
        </PiwinUiProvider>,
      );
    });
    return container;
  }

  it('renders plain step lines and the plain-text report, never transcript chrome', () => {
    const container = renderPreview();
    expect(container.querySelector('[data-testid="subagent-preview-meta"]')?.textContent).toContain(
      'scout2 次工具调用4.2k tok42s已完成',
    );
    expect(container.querySelector('[data-testid="subagent-preview-task"]')?.textContent).toContain(
      'Find every refreshToken call site',
    );
    const lines = [...container.querySelectorAll('.subagent-preview-line')].map(
      (line) => line.textContent,
    );
    expect(lines).toEqual(['说# Report', 'readsrc/auth.ts']);
    const outcome = container.querySelector('[data-testid="subagent-preview-outcome"]');
    expect(outcome?.textContent).toContain('**7 call sites**');
    // No Markdown, tool output, or navigation into the child session.
    expect(container.querySelector('h1, strong, .markdown-view')).toBeNull();
    expect(container.textContent).not.toContain('file body that must not render');
    expect(container.querySelector('[data-testid="subagent-open-full-session"]')).toBeNull();
  });

  it('keeps the pending permission gate actionable', () => {
    const onPermission = vi.fn();
    const prompt = {
      requestId: 'req-1',
      sessionId: 'child-1',
      action: 'bash',
      detail: 'git stash list',
      defaultDecision: 'ask' as const,
    };
    const liveTail: SubagentStreamState = {
      childSessionId: 'child-1',
      completedSegments: [],
      completionRevision: 0,
      text: '',
      thinking: '',
      tools: [],
      streaming: true,
      currentMessageId: null,
      permissionPrompt: prompt,
    };
    const container = renderPreview({
      status: 'running',
      liveTail,
      invocation: { ...invocation, status: 'running', activity: { kind: 'permission', action: 'bash' } },
      onPermission,
    });
    const gate = container.querySelector('[data-testid="subagent-preview-permission"]');
    expect(gate?.textContent).toContain('bash  git stash list');
    const buttons = [...(gate?.querySelectorAll('button') ?? [])];
    act(() => buttons[1]?.click());
    expect(onPermission).toHaveBeenCalledWith(prompt, 'allow', 'session');
    act(() => buttons[2]?.click());
    expect(onPermission).toHaveBeenLastCalledWith(prompt, 'deny');
    expect(container.querySelector('[data-testid="subagent-preview-outcome"]')).toBeNull();
  });

  it('offers a retry when history fails to load', () => {
    const onRetry = vi.fn();
    const container = renderPreview({ messages: [], error: 'boom', onRetry });
    const error = container.querySelector('[data-testid="subagent-preview-error"]');
    expect(error?.textContent).toContain('boom');
    act(() => error?.querySelector('button')?.click());
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
