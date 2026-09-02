// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PiwinUiProvider } from '@piwin/ui-kit';
import { PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { ComposerDock, type ComposerDockProps } from './composer-dock';
import { DesktopLocaleProvider } from './desktop-locale-context';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseProps: ComposerDockProps = {
  layoutMode: 'docked',
  projectPath: '/p',
  projectTrusted: true,
  activeSessionId: 'session-1',
  streaming: false,
  runPhase: 'idle',
  compacting: false,
  composer: '',
  onComposerChange: vi.fn(),
  agentMode: 'agent',
  onAgentModeChange: vi.fn(),
  pendingAttachments: [],
  onRemoveAttachment: vi.fn(),
  dropActive: false,
  onDropActiveChange: vi.fn(),
  plusMenuOpen: false,
  onPlusMenuOpenChange: vi.fn(),
  plusSubmenu: 'none',
  onPlusSubmenuChange: vi.fn(),
  modelOptions: [],
  selectedModelKey: 'default',
  onSelectModel: vi.fn(),
  menuSkills: [],
  menuMcp: [],
  onRefreshComposerMenus: vi.fn(),
  onOpenSkillsPanel: vi.fn(),
  onOpenMcpPanel: vi.fn(),
  onAttachFile: vi.fn(),
  onAttachImage: vi.fn(),
  onPaste: vi.fn(),
  onDrop: vi.fn(),
  onSend: vi.fn(),
  onPause: vi.fn(),
  onAbort: vi.fn(),
  onCompact: vi.fn(),
  contextUsage: null,
};

function renderDock(node: ReactElement): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <DesktopLocaleProvider locale="en" onLocaleChange={() => undefined}>
        <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>{node}</PiwinUiProvider>
      </DesktopLocaleProvider>,
    );
  });
  return { container, root };
}

describe('composer @ mention menu', () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    if (container && container.parentNode) {
      container.parentNode.removeChild(container);
    }
    root = null;
    container = null;
  });

  it('keeps the menu open with an empty state when the query matches nothing', () => {
    const rendered = renderDock(<ComposerDock {...baseProps} composer="@src/nope" />);
    root = rendered.root;
    container = rendered.container;

    const menu = container.querySelector('[data-testid="composer-at-menu"]');
    expect(menu).not.toBeNull();
    expect(menu?.textContent).toContain('No context matches');
  });

  it('lists indexed files and folders and turns a file pick into a context ref', () => {
    const onAddContextRef = vi.fn();
    const onComposerChange = vi.fn();
    const rendered = renderDock(
      <ComposerDock
        {...baseProps}
        composer="@src"
        onAddContextRef={onAddContextRef}
        onComposerChange={onComposerChange}
        atWorkspaceFiles={[
          { relativePath: 'src', kind: 'directory' },
          { relativePath: 'src/App.tsx', kind: 'file' },
        ]}
      />,
    );
    root = rendered.root;
    container = rendered.container;

    expect(container.querySelector('[data-testid="at-item-file-src/App.tsx"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="at-item-folder-src"]')).not.toBeNull();

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="at-item-file-src/App.tsx"]')
        ?.click();
    });
    expect(onAddContextRef).toHaveBeenCalledWith({
      kind: 'file',
      projectPath: '/p',
      relativePath: 'src/App.tsx',
      label: 'src/App.tsx',
    });
    expect(onComposerChange).toHaveBeenCalledWith('@src/App.tsx ');
  });
});
