// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { GoalDisplayPayload } from '@piwin/contracts';
import type { ToolCardUi } from '../chat-reducer';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens';
import { DesktopLocaleProvider } from '../desktop-locale-context';
import { TurnToolGroup, type TurnToolGroupProps } from '../turn-tool-group';
import { GoalActionsProvider, type GoalActions } from './goal-actions-context';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function goalTool(
  toolName: string,
  options: { goal?: GoalDisplayPayload; status?: ToolCardUi['status']; output?: string } = {},
): ToolCardUi {
  return {
    toolCallId: `call-${toolName}`,
    toolName,
    status: options.status ?? 'done',
    output: options.output ?? '',
    ...(options.goal
      ? { presentation: { kind: 'other' as const, title: toolName, goal: options.goal } }
      : {}),
  };
}

describe('Goal cards in the tool sequence', () => {
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

  function renderGroup(props: TurnToolGroupProps, actions?: GoalActions): void {
    const tree = (
      <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <TurnToolGroup {...props} />
        </PiwinUiProvider>
      </DesktopLocaleProvider>
    );
    act(() => {
      root.render(
        actions ? <GoalActionsProvider actions={actions}>{tree}</GoalActionsProvider> : tree,
      );
    });
  }

  it('renders verification and artifacts from the structured completed signal', () => {
    const onOpenFile = vi.fn();
    renderGroup({
      tools: [
        goalTool('goal_complete', {
          goal: {
            phase: 'completed',
            summary: 'Auth tests pass',
            verification: 'pnpm test -- auth (5/5)',
            artifacts: ['packages/auth/src/index.ts'],
          },
        }),
      ],
      onOpenFile,
    });

    const card = container.querySelector('[data-testid="goal-delivery-card"]');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('data-tool-call-id')).toBe('call-goal_complete');
    expect(container.querySelector('[data-testid="goal-verification"]')?.textContent).toContain(
      'pnpm test -- auth (5/5)',
    );
    const artifactButton = container.querySelector<HTMLButtonElement>('.goal-artifact-link');
    expect(artifactButton?.textContent).toContain('packages/auth/src/index.ts');
    act(() => {
      artifactButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpenFile).toHaveBeenCalledWith('packages/auth/src/index.ts');
  });

  it('renders the unblock action and leaves Goal mode on demand', () => {
    const leaveGoalMode = vi.fn();
    const focusComposer = vi.fn();
    renderGroup(
      {
        tools: [
          goalTool('goal_blocked', {
            goal: {
              phase: 'blocked',
              reason: 'Two auth strategies are viable',
              unblockAction: 'Choose JWT or session cookies',
            },
          }),
        ],
      },
      { focusComposer, leaveGoalMode },
    );

    expect(container.querySelector('[data-testid="goal-unblock-action"]')?.textContent).toContain(
      'Choose JWT or session cookies',
    );
    const leaveButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="goal-switch-to-agent-btn"]',
    );
    act(() => {
      leaveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(leaveGoalMode).toHaveBeenCalledTimes(1);

    const answerButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="goal-provide-input-btn"]',
    );
    act(() => {
      answerButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(focusComposer).toHaveBeenCalledTimes(1);
  });

  it('renders a settled wait row with its duration', () => {
    renderGroup({
      tools: [
        goalTool('goal_wait', {
          goal: { phase: 'waited', reason: 'CI queue', durationSeconds: 90 },
        }),
      ],
    });

    const waitCard = container.querySelector('[data-testid="goal-wait-card"]');
    expect(waitCard?.getAttribute('data-running')).toBe('false');
    expect(waitCard?.textContent).toContain('CI queue');
    expect(container.querySelector('[data-testid="goal-wait-duration"]')?.textContent).toBe(
      '1m 30s',
    );
  });

  it('renders an in-flight wait row for a running goal_wait', () => {
    renderGroup({
      tools: [goalTool('goal_wait', { status: 'running', output: 'server spin-up' })],
    });

    const waitCard = container.querySelector('[data-testid="goal-wait-card"]');
    expect(waitCard?.getAttribute('data-running')).toBe('true');
    expect(waitCard?.textContent).toContain('server spin-up');
  });

  it('falls back to the text output for legacy goal tools with no payload', () => {
    renderGroup({
      tools: [goalTool('goal_complete', { output: 'Goal Complete: shipped' })],
    });

    const card = container.querySelector('[data-testid="goal-delivery-card"]');
    expect(card?.textContent).toContain('Goal Complete: shipped');
    expect(container.querySelector('[data-testid="goal-verification"]')).toBeNull();
    expect(container.querySelector('[data-testid="goal-artifacts"]')).toBeNull();
  });

  it('omits the review action when no review surface is wired', () => {
    renderGroup({
      tools: [
        goalTool('goal_complete', { goal: { phase: 'completed', summary: 'done' } }),
      ],
    });

    expect(container.querySelector('.goal-delivery-actions')).toBeNull();
  });
});
