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

describe('WorkspaceTitlebar session title', () => {
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

  it('renders a display-only session title without project breadcrumb or badges', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WorkspaceTitlebar sessionName="Auth / OAuth fix" />
        </PiwinUiProvider>,
      );
    });
    const title = container.querySelector('[data-testid="titlebar-session-title"]');
    expect(title).not.toBeNull();
    expect(title?.textContent).toBe('Auth / OAuth fix');
    expect(title?.querySelector('.titlebar-session-icon')).not.toBeNull();
    expect(container.querySelector('.titlebar-project-name')).toBeNull();
    expect(container.querySelector('.titlebar-sep')).toBeNull();
    expect(container.querySelector('[data-testid="titlebar-mode-badge"]')).toBeNull();
    expect(container.querySelector('.titlebar-scope-pill')).toBeNull();
  });

  it('sets tooltip to the full session name for truncated titles', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WorkspaceTitlebar sessionName="Walkthrough 交付文档" />
        </PiwinUiProvider>,
      );
    });
    const title = container.querySelector('[data-testid="titlebar-session-title"]');
    expect(title?.getAttribute('title')).toBe('Walkthrough 交付文档');
  });

  it('hides the title when session name is empty', () => {
    act(() => {
      root.render(
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
          <WorkspaceTitlebar sessionName="  " />
        </PiwinUiProvider>,
      );
    });
    expect(container.querySelector('[data-testid="titlebar-session-title"]')).toBeNull();
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
