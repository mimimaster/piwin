// @vitest-environment happy-dom
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PiwinUiProvider } from '@piwin/ui-kit';
import type { ThemeManifest } from '@piwin/contracts';
import {
  PIWIN_APPEARANCE_INKSTONE_INK,
  PIWIN_APPEARANCE_INKSTONE_PAPER,
} from '../theme/appearance-tokens.js';
import { INSTALLED_DARK_THEME, INSTALLED_LIGHT_THEME } from '../theme/installed-theme-fixtures.js';
import { FilePanelEmptyFallback } from './file-panel-empty-fallback.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

describe('FilePanelEmptyFallback', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    delete document.documentElement.dataset.themeId;
    delete document.documentElement.dataset.themeVisualStyle;
  });

  function renderFallback(element: ReactElement, theme: ThemeManifest = INSTALLED_DARK_THEME) {
    act(() => {
      root.render(<PiwinUiProvider manifest={theme}>{element}</PiwinUiProvider>);
    });
  }

  it('renders Inkstone Paper theme with seal and classical title', () => {
    const onOpen = vi.fn();
    renderFallback(
      <FilePanelEmptyFallback
        locale="zh-CN"
        activeTheme={PIWIN_APPEARANCE_INKSTONE_PAPER}
        onOpenWorkspace={onOpen}
      />,
      PIWIN_APPEARANCE_INKSTONE_PAPER,
    );

    const seal = container.querySelector('[data-testid="file-tree-empty-seal"]');
    expect(seal).not.toBeNull();
    expect(seal?.textContent).toBe('牍');

    const title = container.querySelector('[data-testid="file-tree-empty-title"]');
    expect(title?.textContent).toBe('案头尚无文牍');

    const desc = container.querySelector('[data-testid="file-tree-empty-desc"]');
    expect(desc?.textContent).toContain('生成或打开文件后');

    const btn = container.querySelector('[data-testid="file-tree-empty-open-btn"]');
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toContain('打开文件夹');

    act(() => {
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('renders Inkstone Ink theme with dark seal and title', () => {
    renderFallback(
      <FilePanelEmptyFallback
        locale="zh-CN"
        activeTheme={PIWIN_APPEARANCE_INKSTONE_INK}
      />,
      PIWIN_APPEARANCE_INKSTONE_INK,
    );

    const seal = container.querySelector('[data-testid="file-tree-empty-seal"]');
    expect(seal).not.toBeNull();
    expect(seal?.textContent).toBe('墨');

    const title = container.querySelector('[data-testid="file-tree-empty-title"]');
    expect(title?.textContent).toBe('砚案静候新章');
  });

  it('renders an installed dark theme with geometric SVG icon instead of seal', () => {
    renderFallback(
      <FilePanelEmptyFallback
        locale="zh-CN"
        activeTheme={INSTALLED_DARK_THEME}
      />,
      INSTALLED_DARK_THEME,
    );

    const seal = container.querySelector('[data-testid="file-tree-empty-seal"]');
    expect(seal).toBeNull();

    const modernIcon = container.querySelector('.file-tree-empty-modern-icon');
    expect(modernIcon).not.toBeNull();

    const title = container.querySelector('[data-testid="file-tree-empty-title"]');
    expect(title?.textContent).toBe('暂无文件');
  });

  it('renders English copy properly for an installed light theme', () => {
    renderFallback(
      <FilePanelEmptyFallback
        locale="en"
        activeTheme={INSTALLED_LIGHT_THEME}
        onOpenWorkspace={vi.fn()}
      />,
      INSTALLED_LIGHT_THEME,
    );

    const title = container.querySelector('[data-testid="file-tree-empty-title"]');
    expect(title?.textContent).toBe('No files');

    const desc = container.querySelector('[data-testid="file-tree-empty-desc"]');
    expect(desc?.textContent).toContain('Generated or opened files can be browsed');

    const btn = container.querySelector('[data-testid="file-tree-empty-open-btn"]');
    expect(btn?.textContent).toContain('Open Folder');
  });

  it('omits button when onOpenWorkspace is not provided', () => {
    renderFallback(<FilePanelEmptyFallback locale="en" />);
    expect(container.querySelector('[data-testid="file-tree-empty-open-btn"]')).toBeNull();
  });
});
