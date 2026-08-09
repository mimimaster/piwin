// @vitest-environment happy-dom
/**
 * Composer plus-menu: Skills + MCP only.
 * Same happy-dom + createRoot harness as context-bar.test.tsx; the menu is
 * portaled by Radix, so assertions read from document, not the container.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens.js';
import { ComposerPlusMenu, type ComposerPlusMenuProps } from './composer-plus-menu.js';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

function createBaseProps(overrides: Partial<ComposerPlusMenuProps> = {}): ComposerPlusMenuProps {
  return {
    trigger: <button type="button">+</button>,
    open: true,
    onOpenChange: vi.fn(),
    submenu: 'none',
    onSubmenu: vi.fn(),
    skills: [{ id: 'skill-a', name: 'Review', enabled: true }],
    onOpenSkillsPanel: vi.fn(),
    mcpServers: [{ id: 'mcp-a', name: 'Filesystem', running: true }],
    onOpenMcpPanel: vi.fn(),
    ...overrides,
  };
}

function render(props: ComposerPlusMenuProps, root: Root): void {
  const tree: ReactElement = (
    <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <div className="plus-anchor">
        <ComposerPlusMenu {...props} />
      </div>
    </PiwinUiProvider>
  );
  act(() => {
    root.render(tree);
  });
}

function queryMenu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="composer-plus-menu"]');
}

function clickItem(testId: string): void {
  const item = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!item) {
    throw new Error(`${testId} not rendered`);
  }
  // Radix menu items commit their onSelect from a `click` handler.
  act(() => {
    item.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('ComposerPlusMenu', () => {
  let container: HTMLElement;
  let root: Root;
  let previousActEnvironment: boolean | undefined;

  beforeEach(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it('renders nothing while closed', () => {
    render(createBaseProps({ open: false }), root);

    expect(queryMenu()).toBeNull();
  });

  it('renders skills and MCP only — no modes, image, or orchestration', () => {
    render(createBaseProps(), root);

    const menu = queryMenu();
    expect(menu).not.toBeNull();
    expect(document.querySelector('[data-testid="plus-menu-skills"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="plus-menu-mcp"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="plus-menu-mode-agent"]')).toBeNull();
    expect(document.querySelector('[data-testid="plus-menu-mode-plan"]')).toBeNull();
    expect(document.querySelector('[data-testid="plus-menu-mode-ask"]')).toBeNull();
    expect(document.querySelector('[data-testid="plus-menu-image"]')).toBeNull();
    expect(document.querySelector('[data-testid="plus-menu-orchestration"]')).toBeNull();
    expect(menu?.textContent).toContain('Skills & MCP');
  });

  it('exposes separate file and image attachment actions when wired', () => {
    const onAttachFile = vi.fn();
    const onAttachImage = vi.fn();
    render(createBaseProps({ onAttachFile, onAttachImage }), root);

    clickItem('plus-menu-file');
    clickItem('plus-menu-image');
    expect(onAttachFile).toHaveBeenCalledTimes(1);
    expect(onAttachImage).toHaveBeenCalledTimes(1);
  });

  it('renders skill entries and the manage action when the skills flyout is open', () => {
    const onOpenSkillsPanel = vi.fn();
    render(createBaseProps({ submenu: 'skills', onOpenSkillsPanel }), root);

    const flyout = document.querySelector('[aria-label="Skills"]');
    expect(flyout).not.toBeNull();
    expect(flyout?.textContent).toContain('Review');

    clickItem('plus-menu-manage-skills');
    expect(onOpenSkillsPanel).toHaveBeenCalledTimes(1);
  });

  it('renders MCP servers and the settings action when the MCP flyout is open', () => {
    const onOpenMcpPanel = vi.fn();
    render(createBaseProps({ submenu: 'mcp', onOpenMcpPanel }), root);

    const flyout = document.querySelector('[aria-label="MCP Servers"]');
    expect(flyout).not.toBeNull();
    expect(flyout?.textContent).toContain('Filesystem');

    clickItem('plus-menu-open-mcp');
    expect(onOpenMcpPanel).toHaveBeenCalledTimes(1);
  });

  it('shows empty copy when no skills or servers exist', () => {
    render(createBaseProps({ submenu: 'skills', skills: [] }), root);
    expect(document.querySelector('[aria-label="Skills"]')?.textContent).toContain(
      'No skills loaded',
    );

    render(createBaseProps({ submenu: 'mcp', mcpServers: [] }), root);
    expect(document.querySelector('[aria-label="MCP Servers"]')?.textContent).toContain(
      'No servers configured',
    );
  });
});
