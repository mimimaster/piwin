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
      artifactPreviewEnabled: true,
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
    expect(document.querySelector('[data-testid="subagent-open-full-session"]')).not.toBeNull();
  });

  it('collapses through the header button without destroying the child', () => {
    const onClose = vi.fn();
    renderPanel({ onClose });

    act(() => {
      document
        .querySelector<HTMLElement>('[data-testid="subagent-inline-collapse"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('promotes the preview to the full session view', () => {
    const onOpenFullSession = vi.fn();
    renderPanel({ onOpenFullSession });

    act(() => {
      document
        .querySelector<HTMLElement>('[data-testid="subagent-open-full-session"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onOpenFullSession).toHaveBeenCalledTimes(1);
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
