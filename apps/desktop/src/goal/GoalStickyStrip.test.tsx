// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens';
import type { ChatMessageUi } from '../chat-ui-types';
import { DesktopLocaleProvider } from '../desktop-locale-context';
import { GoalStickyStrip } from './GoalStickyStrip';
import type { GoalSessionView } from './goal-session-model';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const OBJECTIVE: ChatMessageUi = {
  id: 'user-ship',
  role: 'user',
  text: 'ship the auth fix',
  thinking: '',
  tools: [],
  attachments: [],
  status: 'done',
  agentMode: 'goal',
};

function view(phase: GoalSessionView['phase'], extra: Partial<GoalSessionView> = {}): GoalSessionView {
  return {
    phase,
    objective: 'ship the auth fix',
    roundCount: 1,
    latest: null,
    latestToolCallId: null,
    objectiveIndex: 0,
    ...extra,
  };
}

describe('GoalStickyStrip', () => {
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
    document.querySelector('[data-testid="goal-timeline-popover"]')?.remove();
  });

  function renderStrip(phase: GoalSessionView['phase'], extra?: Partial<GoalSessionView>): void {
    const onAbort = vi.fn();
    const onExit = vi.fn();
    act(() => {
      root.render(
        <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
          <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
            <GoalStickyStrip
              view={view(phase, extra)}
              messages={[OBJECTIVE]}
              onAbort={onAbort}
              onExit={onExit}
            />
          </PiwinUiProvider>
        </DesktopLocaleProvider>,
      );
    });
  }

  it('renders the phase label and matching dot class', () => {
    renderStrip('running');
    const strip = container.querySelector('[data-testid="goal-sticky-strip"]');
    expect(strip?.getAttribute('data-status')).toBe('running');
    expect(strip?.querySelector('.dot-running')).not.toBeNull();
    expect(strip?.textContent).toContain('Goal running');
  });

  it('has no Pause or Resume controls', () => {
    renderStrip('running');
    expect(container.textContent).not.toMatch(/Pause|Resume|暂停|继续/);
  });

  it('hides Abort once the goal is completed and always shows Exit', () => {
    renderStrip('completed', {
      latest: { phase: 'completed', summary: 'done' },
      latestToolCallId: 'call-c',
    });
    expect(container.querySelector('[data-testid="goal-abort-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="goal-exit-btn"]')).not.toBeNull();
  });

  it('opens the timeline from the round pill', () => {
    renderStrip('running');
    const pill = container.querySelector<HTMLButtonElement>('[data-testid="goal-round-pill"]');
    expect(pill).not.toBeNull();
    act(() => {
      pill?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const timeline = document.querySelector('[data-testid="goal-timeline"]');
    expect(timeline).not.toBeNull();
    expect(timeline?.querySelector('[data-kind="objective"]')?.textContent).toContain(
      'ship the auth fix',
    );
  });
});
