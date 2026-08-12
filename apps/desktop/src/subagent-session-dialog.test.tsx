// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { SessionSummary } from '@piwin/contracts';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { SubagentSessionDialog } from './subagent-session-dialog';

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

describe('SubagentSessionDialog worktree actions', () => {
  const mountedRoots: Array<{ root: Root; container: HTMLElement }> = [];

  afterEach(() => {
    for (const mountedRoot of mountedRoots.splice(0)) {
      act(() => mountedRoot.root.unmount());
      mountedRoot.container.remove();
    }
    document.body.replaceChildren();
  });

  function renderDialog(
    onWorktreeAction: (
      childSessionId: string,
      action: 'apply' | 'retain' | 'discard',
    ) => Promise<void>,
  ): void {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <SubagentSessionDialog
            open
            selection={{
              childSessionId: child.id,
              displayName: child.name ?? 'Subagent',
              taskSummary: 'Review the implementation',
            }}
            child={child}
            status="completed"
            messages={[]}
            liveTail={null}
            loading={false}
            error={null}
            onOpenChange={() => undefined}
            onOpenFullSession={() => undefined}
            onRetry={() => undefined}
            onContinue={async () => undefined}
            onWorktreeAction={onWorktreeAction}
          />
        </PiwinUiProvider>,
      );
    });
  }

  it('applies retained changes from the child-session window', async () => {
    const actions: string[] = [];
    renderDialog(async (childSessionId, action) => {
      actions.push(`${childSessionId}:${action}`);
    });

    const applyButton = document.querySelector<HTMLElement>(
      '[data-testid="subagent-worktree-apply"]',
    );
    await act(async () => {
      applyButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(actions).toEqual(['child-1:apply']);
  });

  it('confirms before permanently discarding the retained worktree', async () => {
    const actions: string[] = [];
    renderDialog(async (childSessionId, action) => {
      actions.push(`${childSessionId}:${action}`);
    });

    act(() => {
      document
        .querySelector<HTMLElement>('[data-testid="subagent-worktree-discard"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(document.querySelector('[data-testid="subagent-worktree-discard-confirm"]')).not.toBeNull();
    expect(actions).toEqual([]);

    await act(async () => {
      document
        .querySelector<HTMLElement>('[data-testid="confirm-dialog-confirm"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(actions).toEqual(['child-1:discard']);
  });
});
