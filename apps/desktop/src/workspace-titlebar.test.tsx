// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { WorkspaceTitlebar } from './workspace-titlebar';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('WorkspaceTitlebar identity', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders project and session as separate nodes without string-split', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WorkspaceTitlebar projectName="piwin" sessionName="Auth / OAuth fix" />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('.titlebar-project-name')?.textContent).toBe('piwin');
    expect(container.querySelector('.titlebar-session-name')?.textContent).toBe('Auth / OAuth fix');
    // Must NOT treat "Auth" as project because of internal " / "
    expect(container.querySelectorAll('.titlebar-sep')).toHaveLength(1);
  });

  it('sets tooltip to full project / session', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WorkspaceTitlebar projectName="piwin" sessionName="Walkthrough 交付文档" />
        </PiwinUiProvider>,
      );
    });
    const identity = container.querySelector('.titlebar-session-identity');
    expect(identity?.getAttribute('title')).toBe('piwin / Walkthrough 交付文档');
  });

  it('renders session only when no project', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WorkspaceTitlebar sessionName="General chat" />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('.titlebar-project-name')).toBeNull();
    expect(container.querySelector('.titlebar-session-name')?.textContent).toBe('General chat');
  });

  it('shows theme toggle and invokes onToggleAppearance', () => {
    const onToggleAppearance = vi.fn();
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WorkspaceTitlebar
            appearanceMode="dark"
            onToggleAppearance={onToggleAppearance}
            locale="zh-CN"
          />
        </PiwinUiProvider>,
      );
    });
    const toggle = container.querySelector(
      '[data-testid="titlebar-theme-toggle"]',
    ) as HTMLButtonElement | null;
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute('title')).toBe('切换到浅色主题');
    act(() => {
      toggle?.click();
    });
    expect(onToggleAppearance).toHaveBeenCalledTimes(1);
  });

  it('shows moon icon affordance when already in light mode', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WorkspaceTitlebar
            appearanceMode="light"
            onToggleAppearance={() => undefined}
            locale="en"
          />
        </PiwinUiProvider>,
      );
    });
    const toggle = container.querySelector('[data-testid="titlebar-theme-toggle"]');
    expect(toggle?.getAttribute('title')).toBe('Switch to dark theme');
  });
});
