// @vitest-environment happy-dom
/**
 * Composer plus-menu: attachments, Skills, and session-level MCP Connectors.
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
    mcpServers: [
      { id: 'filesystem', name: 'Filesystem', status: 'running', toolCount: 12, globallyDisabled: false },
      { id: 'linear', name: 'linear', status: 'error', globallyDisabled: false },
      { id: 'postgres', name: 'postgres', status: 'disabled', globallyDisabled: true },
    ],
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

  it('renders skills and connectors — no modes, image, orchestration, or knowledge', () => {
    render(createBaseProps(), root);

    const menu = queryMenu();
    expect(menu).not.toBeNull();
    expect(document.querySelector('[data-testid="plus-menu-skills"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="plus-menu-connectors"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="plus-menu-mode-agent"]')).toBeNull();
    expect(document.querySelector('[data-testid="plus-menu-image"]')).toBeNull();
    expect(document.querySelector('[data-testid="plus-menu-orchestration"]')).toBeNull();
    expect(document.querySelector('[data-testid="plus-menu-knowledge"]')).toBeNull();
    expect(document.querySelector('[data-testid="plus-menu-open-flashcards"]')).toBeNull();
    expect(menu?.textContent).toContain('连接器');
  });

  it('keeps only attachments in Conversation chat', () => {
    render(createBaseProps({ hideAgentExtras: true, onAttachFile: vi.fn() }), root);

    expect(document.querySelector('[data-testid="plus-menu-file"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="plus-menu-skills"]')).toBeNull();
    expect(document.querySelector('[data-testid="plus-menu-connectors"]')).toBeNull();
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

  it('lists connectors read-only when the Host cannot scope MCP to a session', () => {
    const onOpenMcpPanel = vi.fn();
    render(createBaseProps({ submenu: 'connectors', onOpenMcpPanel }), root);

    const flyout = document.querySelector('[aria-label="Connectors"]');
    expect(flyout?.textContent).toContain('Filesystem');
    expect(flyout?.textContent).toContain('12 个工具');
    expect(flyout?.textContent).toContain('出错');
    expect(document.querySelector('[data-testid="plus-menu-connector-filesystem"]')).toBeNull();

    clickItem('plus-menu-open-mcp');
    expect(onOpenMcpPanel).toHaveBeenCalledTimes(1);
  });

  it('switches a connector off for this session and keeps the flyout open', () => {
    const setServerEnabled = vi.fn();
    render(
      createBaseProps({
        submenu: 'connectors',
        mcpSwitches: {
          supported: true,
          disabledServerIds: ['linear'],
          error: null,
          setServerEnabled,
        },
      }),
      root,
    );

    const filesystem = document.querySelector('[data-testid="plus-menu-connector-filesystem"]');
    const linear = document.querySelector('[data-testid="plus-menu-connector-linear"]');
    const postgres = document.querySelector('[data-testid="plus-menu-connector-postgres"]');
    expect(filesystem?.getAttribute('role')).toBe('menuitemcheckbox');
    expect(filesystem?.getAttribute('aria-checked')).toBe('true');
    expect(linear?.getAttribute('aria-checked')).toBe('false');
    expect(postgres?.getAttribute('aria-checked')).toBe('false');
    expect(postgres?.hasAttribute('data-disabled')).toBe(true);
    expect(postgres?.textContent).toContain('全局已停用');
    // Only servers still on for the session count on the trigger.
    expect(
      document.querySelector('[data-testid="plus-menu-connectors"] .plus-menu-count')?.textContent,
    ).toBe('1');

    clickItem('plus-menu-connector-filesystem');
    expect(setServerEnabled).toHaveBeenCalledWith('filesystem', false);
    expect(document.querySelector('[aria-label="Connectors"]')).not.toBeNull();

    clickItem('plus-menu-connector-linear');
    expect(setServerEnabled).toHaveBeenCalledWith('linear', true);
  });

  it('shows empty copy when no skills or servers exist', () => {
    render(createBaseProps({ submenu: 'skills', skills: [] }), root);
    expect(document.querySelector('[aria-label="Skills"]')?.textContent).toContain(
      '未加载任何技能',
    );

    render(createBaseProps({ submenu: 'connectors', mcpServers: [] }), root);
    expect(document.querySelector('[aria-label="Connectors"]')?.textContent).toContain(
      '未配置任何服务器',
    );
  });
});
