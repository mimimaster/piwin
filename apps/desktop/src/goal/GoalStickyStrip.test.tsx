// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from '../appearance-tokens';
import { DesktopLocaleProvider } from '../desktop-locale-context';
import { GoalStickyStrip } from './GoalStickyStrip';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderStrip(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
        <DesktopLocaleProvider locale="en">{node}</DesktopLocaleProvider>
      </PiwinUiProvider>,
    );
  });
  return { container, root };
}

describe('GoalStickyStrip run controls', () => {
  let container: HTMLElement;
  let root: Root;

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders a styled pause pill while running', () => {
    const onPause = vi.fn();
    ({ container, root } = renderStrip(
      <GoalStickyStrip goalTitle="Ship feature" status="running" onPause={onPause} />,
    ));

    const pauseBtn = container.querySelector('[data-testid="goal-pause-btn"]') as HTMLButtonElement;
    expect(pauseBtn).not.toBeNull();
    expect(pauseBtn.className).toContain('goal-run-control--pause');
    expect(pauseBtn.textContent).toContain('Pause');
    expect(pauseBtn.querySelector('svg')).not.toBeNull();

    act(() => {
      pauseBtn.click();
    });
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it('renders a styled resume pill while paused', () => {
    const onResume = vi.fn();
    ({ container, root } = renderStrip(
      <GoalStickyStrip goalTitle="Ship feature" status="paused" onResume={onResume} />,
    ));

    const resumeBtn = container.querySelector('[data-testid="goal-resume-btn"]') as HTMLButtonElement;
    expect(resumeBtn).not.toBeNull();
    expect(resumeBtn.className).toContain('goal-run-control--resume');
    expect(resumeBtn.textContent).toContain('Resume');

    act(() => {
      resumeBtn.click();
    });
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});
