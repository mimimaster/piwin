// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { SessionSummary } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { SubagentInlineSession } from './subagent-inline-session';
import {
  SubagentInspectorProvider,
  type SubagentInspectorPanelData,
} from './subagent-inspector-context';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const child: SessionSummary = {
  id: 'child-1',
  scope: { kind: 'project', projectPath: '/tmp/project' },
  workingDirectory: '/tmp/worktree',
  projectPath: '/tmp/project',
  name: 'Review changes',
  updatedAt: '2026-08-12T00:00:00.000Z',
  messageCount: 2,
  parentSessionId: 'parent-1',
  kind: 'subagent',
  subagentStatus: 'done',
  subagentExecutionStatus: 'completed',
  subagentIntegrationStatus: 'retained',
  subagentMode: 'worktree',
  worktreePath: '/tmp/worktree',
};

describe('SubagentInlineSession', () => {
  const mountedRoots: Array<{ root: Root; container: HTMLElement }> = [];

  afterEach(() => {
    for (const mountedRoot of mountedRoots.splice(0)) {
      act(() => mountedRoot.root.unmount());
      mountedRoot.container.remove();
    }
    document.body.replaceChildren();
  });

  function renderPanel(overrides: Partial<SubagentInspectorPanelData> = {}): void {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    const panel: SubagentInspectorPanelData = {
      status: 'completed',
      messages: [],
      liveTail: null,
      loading: false,
      error: null,
      child,
      projectPath: child.projectPath,
      onOpenFullSession: vi.fn(),
      onRetry: vi.fn(),
      onClose: vi.fn(),
      onWorktreeAction: async () => undefined,
      artifactInlineEnabled: true,
      ...overrides,
    };
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentInspectorProvider
            toggle={{
              selection: {
                childSessionId: child.id,
                displayName: child.name ?? 'Subagent',
                taskSummary: 'Review the implementation',
                anchorId: 'tool-1',
              },
              toggle: vi.fn(),
            }}
            panel={panel}
          >
            <SubagentInlineSession />
          </SubagentInspectorProvider>
        </PiwinUiProvider>,
      );
    });
  }

  it('renders as an observation-only panel without a follow-up composer', () => {
    renderPanel();

    expect(document.querySelector('[data-testid="subagent-inline-session"]')).not.toBeNull();
    // The parent agent owns the conversation with its subagents: the panel
    // must never offer a user-facing continuation input.
    expect(document.querySelector('[data-testid="subagent-follow-up-input"]')).toBeNull();
    expect(document.querySelector('[data-testid="subagent-session-composer"]')).toBeNull();
  });

  it('shows the proto-13 detail box from Host data', () => {
    renderPanel({
      invocation: {
        id: 'inv-1',
        parentSessionId: 'parent-1',
        runId: 'run-1',
        taskId: 'task-1',
        task: 'Review the implementation',
        childSessionId: child.id,
        status: 'completed',
        activity: { kind: 'completed', summary: '没有发现回归' },
        usage: { toolCalls: 6, totalTokens: 14_000, requests: 3 },
        revision: 4,
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:30.000Z',
      },
    });
    const text = (testId: string) =>
      document.querySelector(`[data-testid="${testId}"]`)?.textContent ?? null;
    expect(text('subagent-inline-step')).toBe('step 6 · 已完成');
    expect(text('subagent-inline-conclusion')).toBe('已完成：没有发现回归');
    expect(text('subagent-inline-steps-toggle')).toBe('6 次工具调用 · 保留最近 20 步');
    expect(text('subagent-open-full-session')).toBe('打开完整会话 →');
  });

  it('hides the counters for an older Host without inventing them', () => {
    renderPanel();
    expect(document.querySelector('[data-testid="subagent-inline-step"]')?.textContent).toBe('已完成');
    expect(document.querySelector('[data-testid="subagent-inline-steps-toggle"]')?.textContent).toBe(
      '保留最近 20 步',
    );
  });

  it('promotes the box to the full session view', () => {
    const onOpenFullSession = vi.fn();
    renderPanel({ onOpenFullSession });

    act(() => {
      document
        .querySelector<HTMLElement>('[data-testid="subagent-open-full-session"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onOpenFullSession).toHaveBeenCalledTimes(1);
  });

  it('folds the recent steps until asked, keeping only the latest 20 messages', () => {
    const messages = Array.from({ length: 24 }, (_, index) => ({
      id: `m-${index}`,
      role: 'assistant' as const,
      text: `step text ${index}`,
      thinking: '',
      tools: [],
      attachments: [],
      status: 'done' as const,
    }));
    renderPanel({ messages });
    expect(document.querySelector('[data-testid="subagent-inline-steps"]')).toBeNull();

    act(() => {
      document
        .querySelector<HTMLElement>('[data-testid="subagent-inline-steps-toggle"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const steps = document.querySelector('[data-testid="subagent-inline-steps"]');
    expect(steps).not.toBeNull();
    expect(steps?.textContent).toContain('step text 23');
    expect(steps?.textContent).toContain('step text 4');
    expect(steps?.textContent).not.toContain('step text 3');
  });

  it('does not show the apply/retain/discard bar for a completed worktree child', () => {
    renderPanel();
    expect(document.querySelector('[data-testid="subagent-worktree-actions"]')).toBeNull();
    expect(document.querySelector('[data-testid="subagent-worktree-apply"]')).toBeNull();
    expect(document.querySelector('[data-testid="subagent-worktree-retain"]')).toBeNull();
    expect(document.querySelector('[data-testid="subagent-worktree-discard"]')).toBeNull();
    expect(
      document.querySelector('[data-testid="subagent-inline-session"]')?.getAttribute('data-result-id'),
    ).toBe('child-1');
  });
});
